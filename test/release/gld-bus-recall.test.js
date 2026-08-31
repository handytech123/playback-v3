import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {createMixerState} from '../../dist/src/live/performance-session.js';
import {GldBusRecall,sendTcpBytes} from '../../dist/src/control/mixers/gld-bus-recall.js';
import {ExclusiveGldRecall,externalOutputs} from '../../dist/src/control/mixers/gld-exclusive-recall.js';
import {SurfaceGldRecall} from '../../dist/src/control/mixers/gld-surface-recall.js';
import {GldMidiFeedback,gldDbFromFaderValue} from '../../dist/src/control/mixers/gld-midi-feedback.js';
import {PLAYBACK_RETURNS,validateConfig,captureBusMix,busIntents,applyBusMix} from '../../dist/src/control/mixers/gld-bus-mix.js';
const config={transport:'midi',midiChannel:2,midiOutputName:'test',host:'127.0.0.1',port:51325,mapping:{pad:33}};
test('shipped Performance UI lets buses toggle IEM independently and retains click/cue locks',async()=>{
 const bundle=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 const start=bundle.indexOf('const controlsLocked = group.controlsLocked;',bundle.indexOf('function qo()'));
 assert.ok(start>=0);
 const end=bundle.indexOf('const fader = strip.querySelector("[data-mixer-fader]")',start);
 assert.ok(end>start);
 const bind=runInNewContext(`(group,strip,Yt,E,jn)=>{${bundle.slice(start,end)}}`);
 for(const id of ['drums','bass','acoustic','electric','keys','strings','vocals','other','pad','dynamic-click','dynamic-cue']) {
  const locked=id==='dynamic-click'||id==='dynamic-cue';
  const group={id,label:id,className:id==='pad'?'pad':'bus',controlsLocked:locked,muted:true,solo:false,iem:true};
  const buttons=['muted','solo','iem'].map(key=>({dataset:{mixerSwitch:key},title:key}));
  const sent=[];
  bind(group,{querySelectorAll:()=>buttons},()=>[group],{mixer:{}},(_group,patch)=>{sent.push(patch);Object.assign(group,patch);});
  assert.equal(buttons[2].disabled,locked,id);
  buttons[2].onclick();
  if(locked){assert.equal(sent.length,0);continue;}
  assert.equal(group.iem,false,id);assert.equal(group.muted,true);assert.equal(group.solo,false);
  buttons[2].onclick();assert.equal(group.iem,true,id);
  buttons[0].onclick();assert.equal(group.muted,false);assert.equal(group.iem,true);
 }
 assert.ok(bundle.includes('PB_IEM PRE-FADER - INDEPENDENT SENDS'));
});
const song={song:{id:'song1',title:'Song one'},stems:[{role:'acoustic'},{role:'electric'}]};
const mixer={channels:[{kind:'stem',index:0,gain:.5,muted:false,solo:true,iem:true},{kind:'stem',index:1,gain:1,muted:true,solo:false,iem:false},{kind:'pad',index:2,gain:.8,muted:false},{kind:'click',index:3,gain:1,muted:false},{kind:'cue',index:4,gain:1,muted:false}]};
async function setup(overrides={}) {
 const sent=[];const root=await mkdtemp(join(tmpdir(),'playback-gld-test-'));
 const service=new GldBusRecall({root,defaults:config,sendMidi:async(name,bytes)=>sent.push({name,bytes}),testMidi:async()=>{},...overrides});
 await service.load();return {service,sent,root};
}
async function approvePad(service) {const response=await service.testBus({mix:33,db:-20,confirmation:'TEST RETURN 33'});service.acknowledge(response.test.id);service.arm();}
test('save all captures every confirmed song mix for Performance recall',async()=>{
 const {service,root}=await setup();
 const second={...song,song:{id:'song2',title:'Song two'}};
 const secondMixer={channels:mixer.channels.map(channel=>({...channel,gain:channel.kind==='pad'?.25:channel.gain}))};
 const result=await service.saveAll([{song,mixer},{song:second,mixer:secondMixer}]);
 assert.equal(result.savedCount,2);assert.equal(service.songs.song1.buses.pad.gain,.8);assert.equal(service.songs.song2.buses.pad.gain,.25);
 const persisted=JSON.parse(await readFile(join(root,'gld-bus-recall.json'),'utf8'));
 assert.deepEqual(Object.keys(persisted.songs).sort(),['song1','song2']);assert.match(service.status,/Saved mixes for 2 songs from Edit\/Arrange/);
});
async function exclusiveSetup(overrides={}) {
 const events=[];let stopped=true;
 const root=await mkdtemp(join(tmpdir(),'gld-exclusive-test-'));
 const service=new ExclusiveGldRecall({root,defaults:config,sendMidi:async(_name,bytes)=>events.push(['midi',bytes]),testMidi:async()=>{},
  isStopped:()=>stopped,stopAudio:()=>{events.push(['stop']);stopped=true;},resolveOutputs:()=>[8],
  setExternalOutputs:async outputs=>events.push(['native',outputs]),...overrides});
 await service.load();
 const result=await service.testBus({mix:33,db:-20,confirmation:'TEST RETURN 33'});await service.acknowledge(result.test.id);
 events.length=0;
 return {service,events,setStopped:value=>{stopped=value;}};
}
test('exclusive arm sends console levels before native unity, and never arms while playing',async()=>{
 const {service,events,setStopped}=await exclusiveSetup();
 setStopped(false);await assert.rejects(service.arm(song,mixer),/Stop playback/);assert.equal(events.length,0);
 setStopped(true);await service.arm(song,mixer);
 assert.deepEqual(events.map(e=>e[0]),['midi','native']);assert.deepEqual(events[1][1],[8]);
 assert.equal(service.state().ownershipReady,true);service.assertPlayable();
 service.disarm();assert.throws(()=>service.assertPlayable(),/not ready/);
 assert.deepEqual(service.ownedOutputs,[8]);assert.equal(events.at(-1)[0],'stop');
 assert.equal(events.filter(e=>e[0]==='native').length,1,'disarm must not automatically switch gain stages');
});
test('exclusive live moves and saved song recalls send once; IEM remains out of console commands',async()=>{
 const {service,events}=await exclusiveSetup();await service.save(song,mixer);await service.arm(song,mixer);events.length=0;
 const changed={channels:mixer.channels.map(c=>({...c,gain:c.kind==='pad'?.1:c.gain,iem:false}))};
 await service.live(song,changed);assert.equal(events.length,1);assert.equal(events[0][1].length,15);
 assert.equal(service.songs.song1.buses.pad.gain,.8,'live movement must not overwrite the saved song');
 await service.save(song,changed);assert.equal(service.songs.song1.buses.pad.gain,.1);
 await service.recall(song);assert.equal(events.length,3);
});
test('exclusive send failure stops playback and latches native gain ownership; no silent local fallback',async()=>{
 const {service,events}=await exclusiveSetup();await service.arm(song,mixer);events.length=0;
 service.sendMidi=async()=>{throw Error('cable lost');};await assert.rejects(service.live(song,mixer),/cable lost/);
 assert.equal(service.armed,false);assert.equal(service.ownershipReady,false);assert.deepEqual(service.ownedOutputs,[8]);
 assert.deepEqual(events.map(e=>e[0]),['stop']);assert.throws(()=>service.assertPlayable(),/not ready/);
});
test('exclusive recall holds unsaved songs and resumes saved mixes without rearming',async()=>{
 const {service,events}=await exclusiveSetup();
 const second={...song,song:{id:'second',title:'Second saved song'}};
 const unsaved={...song,song:{id:'missing',title:'Unsaved'}};
 await service.save(song,mixer);
 await service.save(second,{channels:mixer.channels.map(c=>({...c,gain:.25}))});
 await service.arm(song,mixer);events.length=0;
 await service.recall(song);const firstBytes=events[0][1];events.length=0;
 await service.recall(unsaved);await service.recall(unsaved);
 assert.deepEqual(events,[],'Missing mixes must not send faders/mutes, stop audio, or change native ownership');
 assert.equal(service.armed,true);assert.equal(service.ownershipReady,true);
 assert.deepEqual(service.ownedOutputs,[8]);service.assertPlayable();
 assert.match(service.status,/No saved mix.*keeping current GLD levels.*still armed/);
 assert.equal(service.songs.missing,undefined);
 await service.recall(second);assert.equal(events.length,1);assert.equal(events[0][0],'midi');
 assert.notDeepEqual(events[0][1],firstBytes);assert.equal(service.armed,true);
 events.length=0;await service.live(unsaved,mixer);assert.equal(events[0][0],'midi');
 await service.save(unsaved,mixer);assert.ok(service.songs.missing);assert.equal(service.armed,true);
});

test('unsaved selection cancels queued stale recalls and waits for an in-flight send',async()=>{
 const {service,events}=await exclusiveSetup();await service.save(song,mixer);await service.arm(song,mixer);events.length=0;
 const unsaved={...song,song:{id:'missing',title:'Unsaved'}};
 await Promise.all([service.recall(song),service.recall(unsaved)]);
 assert.deepEqual(events,[]);assert.match(service.status,/No saved mix/);
 let finish,started;
 const sending=new Promise(resolve=>{started=resolve});
 service.sendMidi=async()=>{started();await new Promise(resolve=>{finish=resolve});};
 const inFlight=service.recall(song);await sending;
 const held=service.recall(unsaved);finish();await Promise.all([inFlight,held]);
 assert.equal(service.armed,true);assert.match(service.status,/No saved mix/);
});

test('unsaved songs do not mask a send failure or bypass changed audio routing',async()=>{
 const {service}=await exclusiveSetup();await service.save(song,mixer);await service.arm(song,mixer);
 const unsaved={...song,song:{id:'missing',title:'Unsaved'}};
 let fail,started;const sending=new Promise(resolve=>{started=resolve});
 service.sendMidi=async()=>{started();await new Promise((_resolve,reject)=>{fail=reject});};
 const inFlight=service.recall(song);const rejected=assert.rejects(inFlight,/cable lost/);await sending;
 const held=service.recall(unsaved);fail(Error('cable lost'));await rejected;await held;
 assert.equal(service.armed,false);assert.match(service.status,/send failed/);
 const routed=await exclusiveSetup();await routed.service.arm(song,mixer);
 routed.service.resolveOutputs=()=>[9];
 await assert.rejects(routed.service.recall(unsaved),/routing changed/);assert.equal(routed.service.armed,false);
});

test('exclusive arming still requires acknowledgment from native audio',async()=>{
 const failed=await exclusiveSetup({setExternalOutputs:async()=>{throw Error('native missing');}});
 await assert.rejects(failed.service.arm(song,mixer),/native missing/);assert.equal(failed.service.ownershipReady,false);
});
test('disabling exclusive mode is stopped-only and sends no further GLD mix commands',async()=>{
 const {service,events,setStopped}=await exclusiveSetup();await service.arm(song,mixer);
 setStopped(false);await assert.rejects(service.configure({...config,exclusiveEnabled:false}),/Stop playback/);
 setStopped(true);await service.configure({...config,exclusiveEnabled:false});assert.equal(service.enabled(),false);
 assert.deepEqual(events.at(-1),['native',[]]);events.length=0;
 await service.save(song,mixer);await service.live(song,mixer);assert.equal(events.length,0);service.assertPlayable();
});
test('exclusive outputs use audio routing, reject IEM/Click/Cue and shared/unassigned outputs',()=>{
 const routing={pad:8,padChannels:2,iem:3,iemChannels:1,click:1,clickChannels:1,cue:2,cueChannels:1,busRoutes:[{bus:'drums',output:10,channels:2}]};
 assert.deepEqual(externalOutputs({pad:33},routing),[8,9]);
 for(const pad of [0,1,2,3,32])assert.throws(()=>externalOutputs({pad:33},{...routing,pad}));
 assert.throws(()=>externalOutputs({pad:33},{...routing,busRoutes:[{bus:'drums',output:8,channels:1}]}),/separate/);
 assert.deepEqual(externalOutputs({drums:10},routing),[10,11]);
});
test('native routing changes revoke playback readiness instead of bypassing a different return',async()=>{
 let outputs=[8];const {service}=await exclusiveSetup({resolveOutputs:()=>outputs});await service.arm(song,mixer);
 outputs=[9];assert.throws(()=>service.assertPlayable(),/routing changed/);assert.equal(service.armed,false);
});
test('bulk enablement retains only the real connection approval and safely mutes absent buses',async()=>{
 const {ExclusiveGldRecall:BulkRecall}=await import('../../../gld-all/dist/src/control/mixers/gld-exclusive-recall.js');
 const {writeFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'gld-bulk-'));const sent=[];
 const all={...config,mapping:PLAYBACK_RETURNS};
 await writeFile(join(root,'gld-verified-connection.json'),JSON.stringify({connectionKey:JSON.stringify(['midi','test',2]),testedReturn:33}));
 const service=new BulkRecall({root,defaults:all,sendMidi:async(_name,bytes)=>sent.push(bytes),testMidi:async()=>{},isStopped:()=>true,stopAudio:()=>{},resolveOutputs:()=>[4,5,6,7,8,9,10,11,12],setExternalOutputs:async()=>{}});
 await service.load();assert.equal(service.armed,false);assert.deepEqual([...service.approved],[33]);
 await service.arm(song,mixer);assert.equal(service.armed,true);assert.equal(sent[0].length,9*15);
 // Drums are absent in this fixture: muted, then fader at -infinity.
 assert.deepEqual(sent[0].slice(0,3),[0x91,0x29,0x7f]);assert.equal(sent[0][14],0);
 await service.configure(all);assert.deepEqual([...service.approved],[33]);
 await service.configure({...all,midiChannel:1});assert.equal(service.approved.size,0);
 await assert.rejects(service.arm(song,mixer),/Confirm one physical return/);
});
test('mapping allows only the verified Playback returns; Click, IEM, DCA and Main are excluded',()=>{
 assert.deepEqual(validateConfig({...config,mapping:PLAYBACK_RETURNS}).mapping,PLAYBACK_RETURNS);
 for(const bad of [{pad:30},{pad:32},{pad:1},{drums:33},{dca:9}])assert.throws(()=>validateConfig({...config,mapping:bad}),/verified/);
 assert.throws(()=>validateConfig({...config,midiChannel:17}),/MIDI channel/);
});
test('capture excludes click/cue and solo; restore preserves independent IEM sends',()=>{
 const buses=captureBusMix(song,mixer);assert.deepEqual(Object.keys(buses),['acoustic','electric','pad']);
 assert.deepEqual(buses.acoustic,{gain:.5,muted:false});
 const channels=applyBusMix(song,mixer.channels,{acoustic:{gain:.7,muted:true}});
 assert.equal(channels[0].gain,.7);assert.equal(channels[0].iem,true);assert.equal(channels[0].solo,true);
 assert.equal(channels[3],mixer.channels[3]);
 const intents=busIntents(buses,PLAYBACK_RETURNS);
 assert.ok(intents.every(i=>i.strip.kind==='input'&&Object.values(PLAYBACK_RETURNS).includes(i.strip.number)));
 assert.equal(intents.find(i=>i.type==='fader'&&i.strip.number===14).db,20*Math.log10(.5));
});
test('saving while disarmed persists without sending; restarts stay disarmed',async()=>{
 const {service,sent,root}=await setup();await service.save(song,mixer);assert.equal(sent.length,0);
 const persisted=JSON.parse(await readFile(join(root,'gld-bus-recall.json'),'utf8'));assert.equal(persisted.songs.song1.buses.pad.gain,.8);
 const second=new GldBusRecall({root,defaults:config});await second.load();assert.equal(second.armed,false);assert.equal(second.approved.size,0);
 assert.equal(second.prepare(song).gldSavedBusMix.pad.gain,.8);
});
test('hardware test requires exact approval and only sends one fader; arm needs acknowledgment',async()=>{
 const {service,sent}=await setup();assert.throws(()=>service.arm(),/Physically test/);
 await assert.rejects(service.testBus({mix:33,db:-20,confirmation:'yes'}),/confirmation/);
 await assert.rejects(service.testBus({mix:30,db:-20,confirmation:'TEST RETURN 30'}),/mapped/);
 await approvePad(service);
 assert.deepEqual(sent[0].bytes,[0xB1,0x63,0x40,0xB1,0x62,0x17,0xB1,0x06,0x43]);
 await service.save(song,mixer);assert.equal(sent.length,2);
 assert.equal(sent[1].bytes[2],0x40);assert.equal(sent[1].bytes.length,15);
});
test('configuration changes revoke approval; disabled Surface Mixer prevents sends',async()=>{
 let enabled=true;const {service,sent}=await setup({isEnabled:()=>enabled});await approvePad(service);
 enabled=false;await service.save(song,mixer);assert.equal(sent.length,1);
 await assert.rejects(service.testBus({mix:33,db:-20,confirmation:'TEST RETURN 33'}),/Surface Mixer/);
 enabled=true;await service.configure(config);assert.equal(service.approved.size,0);assert.equal(service.armed,false);
});
test('send errors disarm and do not replay; unsaved songs leave console unchanged',async()=>{
 const {service,sent}=await setup();await approvePad(service);await service.recall(song);assert.equal(sent.length,1);
 service.sendMidi=async()=>{throw Error('device lost');};await service.save(song,mixer);
 assert.equal(service.armed,false);assert.match(service.status,/device lost/);
 await service.recall(song);assert.equal(sent.length,1);
});
test('song reloading restores saved Performance bus levels without changing IEM or click',async()=>{
 const {service}=await setup();await service.save(song,mixer);
 const restored=structuredClone(song);restored.stemMix=[{index:0,gain:1,muted:false,iem:true}];
 service.prepare(restored);const state=createMixerState(restored);
 assert.equal(state.channels[0].gain,.5);assert.equal(state.channels[0].iem,true);
 assert.equal(state.channels[1].muted,true);
 assert.equal(state.channels.find(c=>c.kind==='pad').gain,.8);
 assert.equal(state.channels.find(c=>c.kind==='click').gain,1);
});
test('rapid song changes discard an obsolete queued recall',async()=>{
 const {service,sent}=await setup();await service.save(song,mixer);const next={...song,song:{id:'song2',title:'Song two'}};
 await service.save(next,{channels:mixer.channels.map(c=>({...c,gain:.3}))});await approvePad(service);
 await Promise.all([service.recall(song),service.recall(next)]);
 assert.equal(sent.length,2);assert.match(service.status,/Song two/);
});
test('TCP transport sends the exact same MIDI bytes to a local test server',async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const received=new Promise(resolve=>server.once('connection',socket=>{const chunks=[];socket.on('data',b=>chunks.push(b));socket.on('close',()=>resolve(Buffer.concat(chunks)));}));
 try {await sendTcpBytes({...config,port:server.address().port},[0xB1,0x63,0x40]);assert.deepEqual([...await received],[0xB1,0x63,0x40]);}
 finally {server.close();}
});

test('GLD MIDI feedback decodes mapped faders and mutes without accepting other console controls',()=>{
 const received=[],feedback=new GldMidiFeedback({midiChannel:2,midiInputName:'M-Audio MIDISPORT Uno',mapping:{pad:33,drums:10},onFeedback:value=>received.push(value)});
 assert.equal(feedback.handle({status:0xb1,data1:0x63,data2:0x40},1000),null); // input 33
 assert.equal(feedback.handle({status:0xb1,data1:0x62,data2:0x17},1001),null);
 const fader=feedback.handle({status:0xb1,data1:0x06,data2:0x6b},1002);
 assert.equal(fader.bus,'pad');assert.equal(fader.input,33);assert.equal(fader.db,0);assert.equal(fader.gain,1);
 const mute=feedback.handle({status:0x91,data1:0x29,data2:0x7f},1003); // input 10
 assert.equal(mute.bus,'drums');assert.equal(mute.muted,true);
 assert.equal(feedback.handle({status:0x91,data1:0x29,data2:0},1004),null); // note release
 assert.equal(feedback.handle({status:0x90,data1:0x29,data2:0x3f},1005),null); // wrong MIDI channel
 assert.equal(feedback.handle({status:0x91,data1:0x20,data2:0x7f},1006),null); // unmapped input 1
 assert.equal(feedback.state().received,2);assert.equal(received.length,2);
});

test('GLD feedback rejects incomplete and stale NRPN while preserving the full console scale',()=>{
 const feedback=new GldMidiFeedback({midiChannel:2,midiInputName:'Uno',mapping:{pad:33}});
 feedback.handle({status:0xb1,data1:0x63,data2:0x40},1000);
 feedback.handle({status:0xb1,data1:0x62,data2:0x17},1001);
 assert.equal(feedback.handle({status:0xb1,data1:0x06,data2:0x7f},1600),null);
 assert.equal(gldDbFromFaderValue(0),'-inf');assert.equal(gldDbFromFaderValue(0x1b),-40);assert.equal(gldDbFromFaderValue(0x6b),0);assert.equal(gldDbFromFaderValue(0x7f),10);
 assert.throws(()=>gldDbFromFaderValue(128));
 feedback.configure({midiChannel:3,midiInputName:'Uno',mapping:{pad:33}});
 assert.equal(feedback.handle({status:0xb1,data1:0x63,data2:0x40},2000),null);
 assert.equal(feedback.state().midiChannel,3);
});

test('shipped desktop reserves the matching GLD input and suppresses MIDI feedback echo',async()=>{
 const main=await readFile(new URL('../../release-runtime/dist/src/desktop/main.js',import.meta.url),'utf8');
 const setup=main.indexOf('const gldInputs=await listMidiInputs()'),initialArm=main.indexOf('void armSourceSong(manifestPath, selectedSongIndex)');
 assert.ok(setup>0&&initialArm>setup,'GLD input must be selected before the native engine is initially armed');
 assert.match(main,/selectedMidiInput=gldInputName;await saveDeviceSettings/);
 assert.match(main,/if\(!applyingGldFeedback && gldRecall\.config\.mapping/);
 assert.match(main,/handleGldMidiFeedback=event=>/);
 const panel=await readFile(new URL('../../release-runtime/ui-dist/gld-bus-panel.js',import.meta.url),'utf8');
 assert.match(panel,/TWO-WAY MIDI/);assert.match(panel,/MIDI FEEDBACK OFF/);assert.match(panel,/SAVE ALL SONG MIXES/);assert.match(panel,/MutationObserver/);
 assert.doesNotMatch(panel,/save\.textContent='SAVE MIX'/);
});

async function surfaceSetup(root=undefined) {
 const events=[];root??=await mkdtemp(join(tmpdir(),'gld-surface-'));
 const service=new SurfaceGldRecall({root,defaults:config,
  sendMidi:async(_name,bytes)=>events.push(['midi',bytes]),testMidi:async()=>{},
  isStopped:()=>false,stopAudio:()=>events.push(['STOP']),resolveOutputs:()=>[8],
  setExternalOutputs:async outputs=>events.push(['native',outputs]),onSurfaceState:enabled=>events.push(['surface',enabled])});
 await service.load();service.approved.add(33);await service.restoreNativeOwnership();events.length=0;
 return {service,events,root};
}
test('Surface ON automatically arms during playback and OFF only gates MIDI, with fixed audio ownership',async()=>{
 const {service,events}=await surfaceSetup();
 await service.resumeSurface(song,mixer);assert.equal(service.armed,true);assert.equal(service.surfaceEnabled,true);
 assert.deepEqual(events.map(e=>e[0]),['midi','surface']);events.length=0;
 await service.setSurfaceEnabled(false);await service.live(song,mixer);await service.recall(song);
 assert.equal(service.armed,false);assert.equal(service.ownershipReady,true);service.assertPlayable();
 assert.deepEqual(service.ownedOutputs,[8]);assert.deepEqual(events,[['surface',false]]);
 events.length=0;await service.setSurfaceEnabled(true,song,mixer);
 assert.equal(service.armed,true);assert.deepEqual(events.map(e=>e[0]),['midi','surface']);
});
test('Surface switch preferences restore ON automatically and keep OFF across restarts',async()=>{
 const first=await surfaceSetup();await first.service.resumeSurface(song,mixer);
 const next=await surfaceSetup(first.root);await next.service.resumeSurface(song,mixer);assert.equal(next.service.armed,true);
 await next.service.setSurfaceEnabled(false);
 const off=await surfaceSetup(first.root);await off.service.resumeSurface(song,mixer);
 assert.equal(off.service.armed,false);assert.deepEqual(off.events,[]);off.service.assertPlayable();
});
test('Surface MIDI failure freezes levels without stopping playback or blocking the next song',async()=>{
 const {service,events}=await surfaceSetup();await service.save(song,mixer);await service.resumeSurface(song,mixer);events.length=0;
 service.sendMidi=async()=>{throw Error('cable lost');};
 await service.recall(song);await service.preferenceQueue;
 assert.equal(service.armed,false);assert.equal(service.surfaceEnabled,false);assert.equal(service.ownershipReady,true);
 service.assertPlayable();await service.recall({...song,song:{id:'next',title:'Next'}});
 assert.deepEqual(events,[['surface',false]]);assert.match(service.status,/playback continues/);
});
test('Surface unsaved songs hold levels and saved songs still recall',async()=>{
 const {service,events}=await surfaceSetup();await service.save(song,mixer);await service.resumeSurface(song,mixer);events.length=0;
 await service.recall({...song,song:{id:'missing',title:'Missing'}});
 assert.equal(service.surfaceEnabled,true);assert.equal(service.armed,true);assert.deepEqual(events,[]);
 await service.recall(song);assert.deepEqual(events.map(e=>e[0]),['midi']);
});
test('Surface OFF cancels stale queued sends and cannot be overwritten by an in-flight send status',async()=>{
 const {service,events}=await surfaceSetup();await service.save(song,mixer);await service.resumeSurface(song,mixer);events.length=0;
 await Promise.all([service.recall(song),service.setSurfaceEnabled(false)]);
 assert.deepEqual(events,[['surface',false]]);
 await service.setSurfaceEnabled(true,song,mixer);events.length=0;
 let finish,started;const startedSend=new Promise(resolve=>{started=resolve});
 service.sendMidi=async()=>{started();await new Promise(resolve=>{finish=resolve});};
 const sending=service.recall(song);await startedSend;
 await service.setSurfaceEnabled(false);finish();await sending;
 assert.equal(service.surfaceEnabled,false);assert.match(service.status,/Surface Mixer OFF/);
 assert.deepEqual(events,[['surface',false]]);
});
test('Surface ON failure reports OFF but leaves audio running and ownership intact',async()=>{
 const {service,events}=await surfaceSetup();service.sendMidi=async()=>{throw Error('unplugged');};
 await assert.rejects(service.setSurfaceEnabled(true,song,mixer),/unplugged/);
 assert.equal(service.surfaceEnabled,false);assert.equal(service.armed,false);service.assertPlayable();
 assert.deepEqual(events,[['surface',false]]);
});
test('Surface does not falsely turn ON when an audio fault occurs during arming',async()=>{
 const {service,events}=await surfaceSetup();let finish,started;const sending=new Promise(resolve=>{started=resolve});
 service.sendMidi=async()=>{started();await new Promise(resolve=>{finish=resolve});};
 const enabling=service.setSurfaceEnabled(true,song,mixer);const rejected=assert.rejects(enabling,/cancelled/);
 await sending;service.nativeFault();finish();await rejected;
 assert.equal(service.surfaceEnabled,false);assert.equal(service.ownershipReady,false);
 assert.ok(events.every(e=>e[0]==='surface'&&e[1]===false));
});

test('full GLD range preserves old saved gains and recalls +10 dB without changing IEM',async()=>{
 const {gainDb}=await import('../../dist/src/control/mixers/gld-bus-mix.js');
 const max=Math.pow(10,.5),saved={pad:{gain:max,muted:false},acoustic:{gain:.5,muted:false}};
 assert.equal(gainDb(max),10);assert.equal(gainDb(0),'-inf');assert.equal(gainDb(.5),20*Math.log10(.5));
 assert.throws(()=>gainDb(max+.01),/Invalid/);assert.throws(()=>gainDb(NaN),/Invalid/);
 const before=JSON.stringify(saved),channels=applyBusMix(song,mixer.channels,saved);
 assert.equal(JSON.stringify(saved),before);assert.equal(channels.find(c=>c.kind==='pad').gain,max);
 assert.equal(channels[0].iem,mixer.channels[0].iem);
 assert.equal(createMixerState({...song,gldSavedBusMix:saved}).channels.find(c=>c.kind==='pad').gain,max);
 const {service,sent}=await setup();await approvePad(service);sent.length=0;
 await service.save(song,{channels});assert.ok(sent[0].bytes.includes(0x7f));
 assert.equal(service.songs.song1.buses.pad.gain,max);
});
test('bus colors use GLD SysEx and only explicitly mapped input returns',async()=>{
 const {busColorIntents,GLD_BUS_COLORS}=await import('../../dist/src/control/mixers/gld-bus-mix.js');
 const {encodeGldIntent}=await import('../../dist/src/control/mixers/gld112.js');
 const intents=busColorIntents(PLAYBACK_RETURNS);assert.equal(intents.length,9);
 assert.deepEqual(encodeGldIntent(intents.find(i=>i.strip.number===10),2).bytes,[240,0,0,26,80,16,1,0,1,6,41,1,247]);
 assert.deepEqual(GLD_BUS_COLORS,{drums:1,bass:2,acoustic:6,electric:5,keys:4,strings:3,vocals:7,other:0,pad:5});
 assert.throws(()=>busColorIntents({click:30}));assert.throws(()=>busColorIntents({pad:32}));
 assert.throws(()=>encodeGldIntent({type:'color',strip:{kind:'input',number:33},color:8},2));
 const {service,sent}=await setup();await service.transmit(busColorIntents(config.mapping));
 assert.equal(sent[0].bytes.length,13);assert.equal(sent[0].bytes[10],0x40);
 await assert.rejects(service.transmit(busColorIntents({drums:10})),/Only verified/);
 service.isEnabled=()=>false;await assert.rejects(service.transmit(busColorIntents(config.mapping)),/off/);
});
test('eight music buses use each GLD choice once and shipped UI matches the GLD RGB palette',async()=>{
 const {GLD_BUS_COLORS}=await import('../../dist/src/control/mixers/gld-bus-mix.js');
 const names={drums:'Drums',bass:'Bass',acoustic:'Acoustic',electric:'Electric',keys:'Keys',strings:'Strings',vocals:'Vocals',other:'Other'};
 const rgb={0:'#202020',1:'#FF0000',2:'#00FF00',3:'#FFFF00',4:'#0000FF',5:'#8C0099',6:'#0066FF',7:'#FFFFFF'};
 assert.deepEqual(Object.keys(names).map(k=>GLD_BUS_COLORS[k]).sort(),[0,1,2,3,4,5,6,7]);
 for(const file of ['../../ui-dist/assets/index-DjlP38JI.js','../../dist/src/ui/main.js']){
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  const anchor=source.indexOf('"bus-acoustic"'),start=source.lastIndexOf('function ',anchor),end=source.indexOf('function ',anchor);
  const fn=source.slice(start,end).replace(/async\s*$/,''),name=fn.match(/^function (\w+)/)[1];
  const spec=runInNewContext(fn+';'+name);
  for(const [bus,label] of Object.entries(names))assert.equal(spec(label,bus).accent,rgb[GLD_BUS_COLORS[bus]],file+':'+bus);
  const pad=source.match(/id:\s*"dynamic-pad"[^}]*accent:\s*"([^"]+)"/);assert.equal(pad[1],rgb[GLD_BUS_COLORS.pad]);
  const colorAnchor=source.lastIndexOf('"#202020"'),colorStart=source.lastIndexOf('function ',colorAnchor),colorEnd=source.indexOf('function ',colorAnchor);
  const colorFn=source.slice(colorStart,colorEnd),colorName=colorFn.match(/^function (\w+)/)[1];
  const stemColor=runInNewContext(colorFn+';'+colorName);
  for(const [bus,label] of Object.entries(names))assert.equal(stemColor(label,bus),rgb[GLD_BUS_COLORS[bus]],file+':expanded-wave-'+bus);
 }
});
test('expanded editor dark waveform outline keeps the actual GLD stroke color',async()=>{
 for(const [file,name,next] of [['../../dist/src/ui/main.js','drawWaveform','formatTime'],['../../ui-dist/assets/index-DjlP38JI.js','Le',null]]){
  const source=await readFile(new URL(file,import.meta.url),'utf8'),start=source.indexOf('function '+name+'('),end=next?source.indexOf('function '+next+'(',start):source.indexOf('function ',start+10);
  const draw=runInNewContext(source.slice(start,end)+';'+name,{devicePixelRatio:1});
  const strokes=[],stack=[],context={scale(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push(this.strokeStyle);},save(){stack.push({strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,globalAlpha:this.globalAlpha,shadowBlur:this.shadowBlur});},restore(){Object.assign(this,stack.pop());}};
  const canvas={id:'',getBoundingClientRect:()=>({width:200,height:90}),getContext:()=>context};
  draw(canvas,[{min:-.2,max:.3}],'#202020',{visualGain:3.4,verticalScale:.96,alpha:.98,lineWidth:2,outline:'#8a98a6'});
  assert.deepEqual(strokes,['#8a98a6','#202020','#202020']);
 }
});
test('arrangement version changes accept waveform results only from the matching manifest',async()=>{
 const desktop=await readFile(new URL('../../release-runtime/dist/src/desktop/main.js',import.meta.url),'utf8');
 const renderer=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 assert.match(desktop,/"editor:waveforms-ready",\s*\{\s*itemId,\s*manifestPath: choice\.manifestPath/);
 assert.match(renderer,/`\$\{e\.itemId\}\|\$\{e\.manifestPath\}`/);
 assert.match(renderer,/playbackLoadedEditorManifestPath===e\.manifestPath/);
 assert.match(renderer,/playbackLoadedEditorManifestPath=n\.manifestPath/);
});
test('loading an editor workspace re-enables Edit transport controls',async()=>{
 const source=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 const start=source.indexOf('function $e()'),end=source.indexOf('function ',start+12),renderEditor=source.slice(start,end);
 assert.match(renderEditor,/ze\(E\.readiness\)/);
 assert.ok(renderEditor.indexOf('ze(E.readiness)')>renderEditor.indexOf('ne()'),'control lock must refresh after the loaded editor is rendered');
});
test('GLD surface mode never blocks Editor transport commands',async()=>{
 const main=await readFile(new URL('../../release-runtime/dist/src/desktop/main.js',import.meta.url),'utf8');
 const start=main.indexOf('ipcMain.on("playback:command"'),end=main.indexOf('await window.loadFile',start),handler=main.slice(start,end);
 assert.ok(start>=0,'shipped desktop must register Editor transport commands');
 assert.doesNotMatch(handler,/gldRecall\.enabled\(\).*\["play","pad_on"\]/);
 assert.doesNotMatch(handler,/Disable GLD-only levels while stopped before editor audition/);
 assert.match(handler,/command === "play"[\s\S]*engine\.play\(\)/);
});
test('restoring Edit mode shows set cards without automatically loading audio',async()=>{
 const renderer=await readFile(new URL('../../src/ui/main.ts',import.meta.url),'utf8');
 const start=renderer.indexOf('async function setMode(edit: boolean)'),end=renderer.indexOf('async function enterPerformanceMode',start),setMode=renderer.slice(start,end);
 assert.match(setMode,/Select a song card to load it into Edit/);
 assert.doesNotMatch(setMode,/await loadEditorItem\(selectedSetItemId\)/);
 assert.match(renderer,/card\.onclick = async \(\) => \{ selectedSetItemId = item\.itemId;.*await loadEditorItem\(item\.itemId\)/);
});
test('Edit arrangement replacement accepts generated Original Song versions',async()=>{
 const main=await readFile(new URL('../../release-runtime/dist/src/desktop/main.js',import.meta.url),'utf8');
 const start=main.indexOf('else if (command.action === "replace")'),end=main.indexOf('else if (command.action === "remove")',start),replace=main.slice(start,end);
 assert.ok(start>=0,'shipped desktop must contain the setlist Replace handler');
 assert.match(main,/preparedChoiceCache = prepared/);
 assert.match(main,/const cached = preparedChoiceCache\.find\(\(item\) => item\.id === choiceId\)/);
 assert.match(replace,/await preparedChoiceById\(command\.choiceId\)/);
 assert.doesNotMatch(replace,/ensureSetlistOriginalVersions/);
});
test('Editor WAV export targets the selected set card instead of Performance song one',async()=>{
 const sourceUi=await readFile(new URL('../../src/ui/main.ts',import.meta.url),'utf8');
 const preload=await readFile(new URL('../../desktop-preload.cjs',import.meta.url),'utf8');
 const main=await readFile(new URL('../../release-runtime/dist/src/desktop/main.js',import.meta.url),'utf8');
 const bundle=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 const start=main.indexOf('ipcMain.handle("performance:export-song"'),end=main.indexOf('ipcMain.handle("set:get-song"',start),handler=main.slice(start,end);
 assert.match(sourceUi,/exportSong\(\s*editMode && selectedSetItemId\s*\? \{ itemId: selectedSetItemId \}/);
 assert.match(preload,/exportSong:\(options\)=>ipcRenderer\.invoke\("performance:export-song",options\)/);
 assert.match(handler,/options\?\.itemId/);
 assert.match(handler,/operatorSetlist\.items\.findIndex/);
 assert.match(handler,/readFile\(item\.manifestPath, "utf8"\)/);
 assert.match(handler,/selectedManifest\.songs\[item\.songIndex\]/);
 assert.match(handler,/exportSetName = operatorSetlist\.name/);
 assert.match(bundle,/exportSong\(Q&&F\?\{itemId:F\}:void 0\)/);
});
test('Surface arming sends colors once; fader moves do not flood color SysEx',async()=>{
 const {service,events}=await surfaceSetup();await service.restoreNativeOwnership();events.length=0;
 await service.setSurfaceEnabled(true,song,mixer);
 assert.ok(events.find(e=>e[0]==='midi')[1].includes(0xf0));events.length=0;
 await service.live(song,mixer);assert.ok(!events.find(e=>e[0]==='midi')[1].includes(0xf0));
 await service.setSurfaceEnabled(false);events.length=0;await service.live(song,mixer);assert.equal(events.length,0);
});
test('shipped dB renderer converts input to gain and keeps switches and local ranges unchanged',async()=>{
 const bundle=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 const helpers=await readFile(new URL('./fixtures/fader-helpers.js',import.meta.url),'utf8');
 const a=bundle.indexOf('function qo()'),b=bundle.indexOf('function ',a+10);
 const group={id:'bus-drums',label:'Drums',sourceChannels:[{index:0}],gain:.5,muted:false,solo:false,iem:true,controlsLocked:false,levelLocked:false};
 const classes={toggle(){},add(){}};const output={value:''},fader={value:'',setAttribute(){}};
 const buttons=['muted','solo','iem'].map(key=>({dataset:{mixerSwitch:key},classList:classes}));
 const strip={dataset:{},style:{setProperty(){}},classList:classes,querySelectorAll:()=>buttons,querySelector:selector=>selector==='output'?output:selector==='[data-mixer-fader]'?fader:buttons.find(b=>selector.includes(b.dataset.mixerSwitch))};
 const container={replaceChildren(){},append(){},querySelector:()=>strip},sent=[];
 const context={globalThis:{playbackGldDisplayConfig:{exclusiveEnabled:true,mapping:{drums:10}}},document:{activeElement:null,createElement:()=>strip},window:{setTimeout(fn){fn();return 1;}},clearTimeout(){},E:{mixer:{channels:[]}},Yt:()=>[group],at:'',tn:[],A:v=>v,Kn:new Map(),jn:(_g,patch)=>sent.push(patch),w:{audio:{iemReady:true}},o:selector=>selector==='#mixerChannels'?container:{classList:classes}};
 runInNewContext(helpers+bundle.slice(a,b)+';qo();',context);
 assert.equal(output.value,'-6.0 dB');assert.equal(fader.max,'1000');
 fader.value='1000';fader.oninput();assert.equal(sent.at(-1).gain,Math.pow(10,.5));assert.equal(output.value,'+10.0 dB');
 fader.value='770';fader.oninput();assert.equal(sent.at(-1).gain,1);
 fader.value='0';fader.oninput();assert.equal(sent.at(-1).gain,0);assert.equal(output.value,'−∞ dB');
 assert.equal(buttons[2].disabled,false);buttons[2].onclick();assert.equal(sent.at(-1).iem,false);
 context.globalThis.playbackGldDisplayConfig.exclusiveEnabled=false;context.qo();assert.equal(fader.max,'1.25');assert.equal(output.value,'50%');
});
