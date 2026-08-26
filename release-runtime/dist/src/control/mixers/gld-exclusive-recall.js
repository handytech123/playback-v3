import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {GldBusRecall} from './gld-bus-recall.js';
import {captureBusMix,busIntents,validateConfig} from './gld-bus-mix.js';

// Audio ownership is never switched back automatically after a failed MIDI send.
// Stop first; the native bypass remains latched until an explicit stopped setup.
export class ExclusiveGldRecall extends GldBusRecall {
    constructor(options) {
        super(options);
        this.isStopped=options.isStopped;
        this.stopAudio=options.stopAudio;
        this.resolveOutputs=options.resolveOutputs;
        this.setExternalOutputs=options.setExternalOutputs;
        this.ownedOutputs=null;
        this.ownershipReady=false;
        this.setupBusy=false;
    }
    connectionKey() {const c=this.config;return JSON.stringify(c.transport==='midi'?[c.transport,c.midiOutputName,c.midiChannel]:[c.transport,c.host,c.port,c.midiChannel]);}
    async restoreConnectionApproval() {
        try {
            const approval=JSON.parse(await readFile(join(this.root,'gld-verified-connection.json'),'utf8'));
            if(approval.connectionKey===this.connectionKey() && Object.values(this.config.mapping).includes(approval.testedReturn))this.approved.add(approval.testedReturn);
        } catch(error) {if(error.code!=='ENOENT')this.status='Connection approval unavailable; test a mapped return before arming';}
    }
    async load() {await super.load();await this.restoreConnectionApproval();}
    async acknowledge(testId) {
        const result=super.acknowledge(testId);
        const testedReturn=result.approved.at(-1);
        await writeFile(join(this.root,'gld-verified-connection.json'),JSON.stringify({connectionKey:this.connectionKey(),testedReturn,confirmedAt:new Date().toISOString()},null,2));
        return result;
    }
    enabled() {return this.config.exclusiveEnabled!==false && Object.keys(this.config.mapping).length>0;}
    state() {return {...super.state(),exclusiveEnabled:this.enabled(),ownershipReady:this.ownershipReady};}
    requireStopped() {if(!this.isStopped())throw Error('Stop playback before changing GLD gain ownership');}
    requireIdle() {if(this.setupBusy)throw Error('GLD setup is still in progress');}
    disarm(reason='GLD recall disarmed; stop and re-arm before playback') {
        if(this.ownedOutputs || this.armed)this.stopAudio();
        this.ownershipReady=false;
        super.disarm(reason);
    }
    assertPlayable() {
        if(!this.enabled())return;
        if(!this.armed||!this.ownershipReady)throw Error('GLD-only levels are not ready. Test and arm GLD RETURNS, or disable GLD-only mode while stopped.');
        if(JSON.stringify(this.resolveOutputs(this.config.mapping))!==JSON.stringify(this.ownedOutputs)) {
            this.disarm('Audio routing changed; re-arm GLD RETURNS');
            throw Error(this.status);
        }
    }
    async configure(value) {
        this.requireIdle();this.requireStopped();
        // Validate before altering ownership or persisted configuration.
        validateConfig(value);
        this.setupBusy=true;
        try {
            this.disarm();
            await this.queue.catch(()=>{});
            await this.setExternalOutputs([]);
            this.ownedOutputs=null;
            await super.configure(value);await this.restoreConnectionApproval();return this.state();
        } finally {this.setupBusy=false;}
    }
    async testBus(value) {this.requireIdle();this.requireStopped();return super.testBus(value);}
    async arm(song,mixer) {
        this.requireIdle();this.requireStopped();
        if(!this.enabled())throw Error('Enable GLD-only levels and select at least one return');
        if(!Object.values(this.config.mapping).some(input=>this.approved.has(input)))throw Error('Confirm one physical return on this connection, then review the enabled mapping before arming');
        const outputs=this.resolveOutputs(this.config.mapping);
        const buses=this.completeBuses(captureBusMix(song,mixer));
        this.requireComplete(buses);
        this.setupBusy=true;this.ownershipReady=false;
        try {
            super.arm();const epoch=this.epoch;
            await this.queue.catch(()=>{});
            if(epoch!==this.epoch||!this.armed)throw Error('GLD arming cancelled');
            // Console first, native unity second, while transport is stopped.
            await this.transmit(busIntents(buses,this.config.mapping));
            if(epoch!==this.epoch||!this.armed)throw Error('GLD arming cancelled');
            await this.setExternalOutputs(outputs);
            this.ownedOutputs=outputs;
            if(epoch!==this.epoch||!this.armed)throw Error('GLD arming cancelled');
            this.ownershipReady=true;this.status='GLD-ONLY ARMED: mapped faders send live; Save Mix stores this song';
            return this.state();
        } catch(error) {this.disarm(`GLD arming failed: ${error.message}`);throw error;}
        finally {this.setupBusy=false;}
    }
    completeBuses(buses) {
        return {...Object.fromEntries(Object.keys(this.config.mapping).map(id=>[id,{gain:0,muted:true}])),...buses};
    }
    requireComplete(buses) {
        for(const id of Object.keys(this.config.mapping))if(!buses[id])throw Error(`No ${id} bus mix for this song; save its mix before recall`);
    }
    async restoreNativeOwnership() {
        this.assertPlayable();
        if(this.enabled()) {
            try {await this.setExternalOutputs(this.ownedOutputs);}
            catch(error) {this.disarm(`Native GLD ownership failed: ${error.message}`);throw error;}
        }
    }
    queueBuses(song,buses,label) {
        this.assertPlayable();buses=this.completeBuses(buses);this.requireComplete(buses);
        const intents=busIntents(buses,this.config.mapping),config=structuredClone(this.config),epoch=this.epoch;
        const generation=(this.recallGeneration??0)+1;this.recallGeneration=generation;
        const next=this.queue.catch(()=>{}).then(async()=>{
            if(epoch!==this.epoch||!this.armed||generation!==this.recallGeneration)return;
            try {await this.transmit(intents,config);this.status=`GLD-only ${label}: ${song.song.title}`;}
            catch(error) {this.disarm(`GLD send failed; playback stopped: ${error.message}`);throw error;}
        });
        this.queue=next;return next;
    }
    recall(song) {
        if(!this.enabled()||!this.armed)return Promise.resolve();
        const saved=this.songs[song.song.id];
        try {
            if(saved)return this.queueBuses(song,saved.buses,'recalled');
            this.assertPlayable();
            // An unsaved song holds the console's current levels. Cancel stale
            // queued recalls, but retain gain ownership and readiness for the
            // next saved song. Never invent or persist a default console mix.
            const epoch=this.epoch,generation=(this.recallGeneration??0)+1;
            this.recallGeneration=generation;
            const next=this.queue.catch(()=>{}).then(()=>{
                if(epoch!==this.epoch||!this.armed||generation!==this.recallGeneration)return;
                this.status=`No saved mix for ${song.song.title}; keeping current GLD levels, recall still armed`;
            });
            this.queue=next;return next;
        }
        catch(error) {this.disarm(error.message);return Promise.reject(error);}
    }
    live(song,mixer) {
        if(!this.enabled()||!this.armed)return Promise.resolve();
        try {return this.queueBuses(song,captureBusMix(song,mixer),'live');}
        catch(error) {this.disarm(error.message);return Promise.reject(error);}
    }
}

// Outputs are Playback/Dante output numbers, NOT GLD input-strip numbers.
export function externalOutputs(mapping,routing) {
    const reserved=new Set();
    for(const id of ['click','cue','iem'])for(let n=0;n<(routing[id+'Channels']??1);n++)if(routing[id]>0)reserved.add(routing[id]+n);
    const selected=new Set();
    for(const id of Object.keys(mapping)) {
        const route=id==='pad'?{output:routing.pad,channels:routing.padChannels}:routing.busRoutes?.find(r=>r.bus===id);
        if(!route||!Number.isInteger(route.output)||route.output<1||!Number.isInteger(route.channels)||route.channels<1||route.channels>2||route.output+route.channels-1>32)
            throw Error(`Assign a dedicated audio output for ${id} before arming GLD-only levels`);
        for(let n=0;n<route.channels;n++) {
            const output=route.output+n;
            if(reserved.has(output)||selected.has(output))throw Error('GLD return outputs must not overlap Click, Cue, IEM, or another return');
            selected.add(output);
        }
    }
    for(const route of routing.busRoutes??[])if(!Object.hasOwn(mapping,route.bus))
        for(let n=0;n<route.channels;n++)if(selected.has(route.output+n))throw Error('Mapped and unmapped buses must use separate audio outputs');
    if(!Object.hasOwn(mapping,'pad'))for(let n=0;n<routing.padChannels;n++)if(selected.has(routing.pad+n))throw Error('Mapped returns overlap unmapped Dynamic Pad');
    return [...selected].sort((a,b)=>a-b);
}
