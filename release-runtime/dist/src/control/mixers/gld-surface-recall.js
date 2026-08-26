import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ExclusiveGldRecall} from './gld-exclusive-recall.js';
import {GldBusRecall} from './gld-bus-recall.js';
import {captureBusMix,busIntents,busColorIntents} from './gld-bus-mix.js';

// The console owns these audio returns in GLD-only mode regardless of the
// Surface switch. The switch gates MIDI writes only; it never changes audio
// gain ownership or transport. A lost MIDI connection freezes console levels.
export class SurfaceGldRecall extends ExclusiveGldRecall {
    constructor(options) {
        super(options);
        this.surfaceEnabled=false;
        this.surfaceRequested=true;
        this.onSurfaceState=options.onSurfaceState??(()=>{});
        this.isEnabled=()=>this.surfaceEnabled;
        this.preferenceQueue=Promise.resolve();
    }
    state() {return {...super.state(),surfaceEnabled:this.surfaceEnabled,surfaceRequested:this.surfaceRequested};}
    async load() {
        await super.load();
        try {this.surfaceRequested=JSON.parse(await readFile(join(this.root,'gld-surface-state.json'),'utf8')).enabled===true;}
        catch(error) {if(error.code!=='ENOENT'){this.surfaceRequested=false;this.status='Surface Mixer OFF: saved switch setting could not be read';}}
        this.onSurfaceState(false);
    }
    persistSurface(enabled) {
        const next=this.preferenceQueue.catch(()=>{}).then(async()=>{
            await mkdir(this.root,{recursive:true});
            const file=join(this.root,'gld-surface-state.json'),temp=file+'.'+randomUUID()+'.tmp';
            await writeFile(temp,JSON.stringify({enabled}));await rename(temp,file);
        });
        this.preferenceQueue=next;return next;
    }
    disarm(reason='Surface Mixer OFF; keeping current GLD levels') {
        // Cancel pending sends without stopping transport or clearing native
        // return ownership. MIDI readiness and audio readiness are independent.
        this.epoch++;this.armed=false;this.surfaceEnabled=false;this.surfaceRequested=false;
        this.status=reason.replaceAll('playback stopped','playback continues').replaceAll('re-arm GLD RETURNS','turn Surface Mixer ON');
        this.onSurfaceState(false);
        void this.persistSurface(false).catch(error=>{this.status+=`; switch setting could not be saved: ${error.message}`;this.onSurfaceState(false);});
    }
    nativeFault() {
        this.ownershipReady=false;
        this.disarm('Audio engine unavailable; restore audio, then turn Surface Mixer ON');
    }
    assertPlayable() {
        if(!this.enabled())return;
        if(!this.ownershipReady || JSON.stringify(this.resolveOutputs(this.config.mapping))!==JSON.stringify(this.ownedOutputs))
            throw Error('GLD audio return routing is not ready; check the audio device and output mapping');
    }
    async restoreNativeOwnership() {
        if(!this.enabled())return;
        try {
            const outputs=this.resolveOutputs(this.config.mapping);
            await this.setExternalOutputs(outputs);
            this.ownedOutputs=outputs;this.ownershipReady=true;
        } catch(error) {this.ownershipReady=false;this.disarm(`GLD audio return setup failed: ${error.message}`);throw error;}
    }
    async resumeSurface(song,mixer) {
        if(this.surfaceRequested&&!this.armed) {
            // MIDI failure must not prevent a song loading or transitioning.
            try {await this.setSurfaceEnabled(true,song,mixer);} catch {}
        }
    }
    async arm(song,mixer) {return this.setSurfaceEnabled(true,song,mixer);}
    async setSurfaceEnabled(enabled,song,mixer) {
        if(!enabled){this.disarm();await this.preferenceQueue;return this.state();}
        this.requireIdle();
        if(this.armed&&this.surfaceEnabled){this.assertPlayable();return this.state();}
        this.setupBusy=true;
        try {
            if(!this.enabled())throw Error('Enable GLD-only levels and choose Playback returns in GLD RETURNS first');
            this.assertPlayable();
            if(!Object.values(this.config.mapping).some(input=>this.approved.has(input)))throw Error('Confirm one physical return for this connection in GLD RETURNS first');
            const buses=this.completeBuses(captureBusMix(song,mixer));
            this.surfaceRequested=true;this.surfaceEnabled=true;
            GldBusRecall.prototype.arm.call(this);
            const epoch=this.epoch;
            await this.queue.catch(()=>{});
            if(epoch!==this.epoch||!this.surfaceEnabled)throw Error('Surface Mixer ON cancelled');
            await this.transmit([...busColorIntents(this.config.mapping),...busIntents(buses,this.config.mapping)]);
            if(epoch!==this.epoch||!this.surfaceEnabled)throw Error('Surface Mixer ON cancelled');
            this.status='Surface Mixer ON: GLD recall armed; faders send live';
            await this.persistSurface(true);
            if(epoch!==this.epoch||!this.surfaceEnabled)throw Error('Surface Mixer ON cancelled');
            this.onSurfaceState(true);return this.state();
        } catch(error) {this.disarm(`Surface Mixer OFF: ${error.message}`);await this.preferenceQueue;throw error;}
        finally {this.setupBusy=false;}
    }
    queueBuses(song,buses,label) {
        this.assertPlayable();
        const intents=[...(label==='recalled'?busColorIntents(this.config.mapping):[]),...busIntents(this.completeBuses(buses),this.config.mapping)],config=structuredClone(this.config),epoch=this.epoch;
        const generation=(this.recallGeneration??0)+1;this.recallGeneration=generation;
        const next=this.queue.catch(()=>{}).then(async()=>{
            if(epoch!==this.epoch||!this.surfaceEnabled||!this.armed||generation!==this.recallGeneration)return;
            try {
                await this.transmit(intents,config);
                if(epoch===this.epoch&&this.armed)this.status=`Surface Mixer ON: GLD ${label}: ${song.song.title}`;
            } catch(error) {
                this.disarm(`Surface Mixer OFF: GLD send failed (${error.message}); keeping console levels, playback continues`);
            }
        });
        this.queue=next;return next;
    }
}
