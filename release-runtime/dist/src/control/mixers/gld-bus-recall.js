import {Socket} from 'node:net';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {encodeGldIntent} from './gld112.js';
import {busIntents,captureBusMix,validateConfig,PLAYBACK_RETURNS} from './gld-bus-mix.js';

export async function sendTcpBytes(config, bytes) {
    await new Promise((resolve,reject)=>{
        const socket=new Socket();let done=false;
        const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
        const timer=setTimeout(()=>finish(Error('GLD network send timed out')),2000);
        socket.once('error',finish);
        socket.connect(config.port,config.host,()=>socket.write(Buffer.from(bytes),error=>finish(error)));
    });
}
export class GldBusRecall {
    constructor({root,defaults,sendMidi,testMidi,isEnabled=()=>true,tcpSend=sendTcpBytes}) {
        this.root=root;this.config={transport:'midi',host:'',port:51325,midiChannel:2,midiOutputName:'',mapping:{},...defaults};
        this.sendMidi=sendMidi;this.testMidi=testMidi;this.tcpSend=tcpSend;this.isEnabled=isEnabled;
        this.songs={};this.approved=new Set();this.armed=false;this.pendingTest=null;this.status='GLD recall disarmed';this.queue=Promise.resolve();this.epoch=0;
    }
    async load() {
        try {const data=JSON.parse(await readFile(join(this.root,'gld-bus-recall.json'),'utf8'));if(data.schemaVersion!==1)throw Error('Unsupported GLD settings');this.config=validateConfig(data.config);this.songs=data.songs??{};}
        catch(error){if(error.code!=='ENOENT')throw error;}
    }
    async persist() {
        await mkdir(this.root,{recursive:true});const file=join(this.root,'gld-bus-recall.json');
        const temporary=file+'.'+randomUUID()+'.tmp';
        await writeFile(temporary,JSON.stringify({schemaVersion:1,config:this.config,songs:this.songs},null,2));await rename(temporary,file);
    }
    state() {return {config:structuredClone(this.config),armed:this.armed,approved:[...this.approved],status:this.status};}
    disarm(reason='GLD recall disarmed') {this.epoch++;this.armed=false;this.status=reason;}
    async configure(value) {
        const next=validateConfig(value);
        this.disarm('Settings saved; test a mapped return and review the full mapping before arming');this.approved.clear();this.pendingTest=null;
        this.config=next;await this.persist();return this.state();
    }
    prepare(song) {song.gldSavedBusMix=this.songs[song.song.id]?.buses;return song;}
    preview(song,mixer) {return busIntents(captureBusMix(song,mixer),this.config.mapping).map(intent=>encodeGldIntent(intent,this.config.midiChannel));}
    async transportTest() {
        if(this.config.transport==='midi')await this.testMidi(this.config.midiOutputName);
        else await this.tcpSend(this.config,[]);
        this.status='Connection opened; no MIDI data sent. Bus movement still unverified.';return this.state();
    }
    async transmit(intents,config=this.config) {
        if(!this.isEnabled())throw Error('Surface Mixer is off');
        const bytes=intents.flatMap(intent=>{
            if(intent.strip?.kind!=='input'||(!Object.values(PLAYBACK_RETURNS).includes(intent.strip.number)||!Object.values(config.mapping).includes(intent.strip.number))||!['fader','mute','color'].includes(intent.type))throw Error('Only verified Playback return fader/mute/color commands are allowed');
            return encodeGldIntent(intent,config.midiChannel).bytes;
        });
        if(!bytes.length)return;
        if(config.transport==='midi')await this.sendMidi(config.midiOutputName,bytes);else await this.tcpSend(config,bytes);
    }
    async testBus({mix,db,confirmation}) {
        if(!Object.values(this.config.mapping).includes(mix))throw Error('Test bus must be explicitly mapped');
        if(confirmation!==`TEST RETURN ${mix}`)throw Error('Explicit single-bus test confirmation required');
        if(db!=='-inf'&&(!Number.isFinite(db)||db< -40||db>10))throw Error('Test level must be -40 to +10 dB or -inf');
        this.disarm();this.pendingTest=null;
        const config=structuredClone(this.config),epoch=this.epoch;
        await this.queue;
        if(epoch!==this.epoch)throw Error('Test cancelled because settings changed');
        await this.transmit([{type:'fader',strip:{kind:'input',number:mix},db}],config);
        if(epoch!==this.epoch)throw Error('Test invalidated because settings changed');
        this.pendingTest={id:randomUUID(),mix};this.status=`Test sent to Playback return ${mix}; confirm the correct physical fader moved. Mute unchanged.`;
        return {...this.state(),test:structuredClone(this.pendingTest)};
    }
    acknowledge(testId) {
        if(!this.pendingTest||this.pendingTest.id!==testId)throw Error('No matching physical test');
        this.approved.add(this.pendingTest.mix);this.pendingTest=null;this.status='Physical test acknowledged';return this.state();
    }
    arm() {
        if(!this.isEnabled())throw Error('Surface Mixer is off');
        const targets=Object.values(this.config.mapping);
        if(!targets.length||!targets.some(mix=>this.approved.has(mix)))throw Error('Physically test and confirm a mapped return first');
        this.armed=true;this.status='ARMED: Save Mix and song changes send mapped bus levels/mutes';return this.state();
    }
    async save(song,mixer) {
        const buses=captureBusMix(song,mixer);
        this.songs[song.song.id]={songId:song.song.id,title:song.song.title,buses,savedAt:new Date().toISOString()};
        await this.persist();this.prepare(song);
        this.status=`Saved ${song.song.title}${this.armed?' locally; sending GLD buses':' locally; GLD disarmed'}`;
        await this.recall(song);return this.state();
    }
    recall(song) {
        const generation=(this.recallGeneration??0)+1;this.recallGeneration=generation;
        const saved=this.songs[song.song.id];
        if(!this.armed||!this.isEnabled())return Promise.resolve();
        if(!saved){this.status=`No saved GLD mix for ${song.song.title}; console unchanged`;return Promise.resolve();}
        const config=structuredClone(this.config),epoch=this.epoch;
        const intents=busIntents(saved.buses,config.mapping);
        this.queue=this.queue.then(async()=>{
            if(!this.armed||epoch!==this.epoch||generation!==this.recallGeneration||!this.isEnabled())return;
            try {await this.transmit(intents,config);this.status=`Sent saved buses: ${song.song.title}`;}
            catch(error){this.disarm(`GLD send failed; recall disarmed: ${error.message}`);}
        });
        return this.queue;
    }
}
