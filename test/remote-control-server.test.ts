import test from "node:test";
import assert from "node:assert/strict";
import { RemoteControlServer } from "../src/control/remote-server.js";
import { PlaybackCommandBus } from "../src/control/command-bus.js";
import { PerformanceSession, type PerformanceEffects } from "../src/live/performance-session.js";
import type { ConfirmedSetManifest } from "../src/confirmed-set/manifest.js";
import { songId } from "../src/domain/song.js";
import { createSocket } from "node:dgram";
import { encodeOscMessage } from "../src/control/osc.js";

test("remote server requires a token and returns command/state acknowledgements", async () => {
  const calls: string[] = [], effects: PerformanceEffects = { play: () => calls.push("play"), pause: () => {}, stop: () => calls.push("stop"), seek: () => {}, panic: () => {}, announceRecovery: () => {}, cancelTransition: () => {}, recover: () => {}, setBus: () => {}, selectSong: async () => {} };
  const manifest: ConfirmedSetManifest = { schemaVersion: 1, id: "set", name: "Sunday", confirmedAt: "now", songs: [{ song: { id: songId("song"), title: "Song", artist: "Artist", vendor: "Vendor", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } }, selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 4, stems: [{ role: "music", sourcePath: "cache/audio.wav", durationSeconds: 4 }], regions: [{ id: "verse", name: "Verse", startSeconds: 0, endSeconds: 4 }], cues: [], cacheFingerprint: "hash", liveAssets: { click: { regularPath: "click", accentPath: "accent", events: [{ atSeconds: 0, accent: true }] }, repeatCuePath: "repeat", cues: [], pad: { key: "C", audioPath: "pad" } } }] };
  const bus = new PlaybackCommandBus(new PerformanceSession(manifest, effects), manifest.name), server = new RemoteControlServer(bus, { token: "0123456789abcdef", enableOsc: false }); const address = await server.start(), base = `http://${address.host}:${address.httpPort}`;
  try { assert.equal((await fetch(`${base}/api/state`)).status, 401); const page = await fetch(`${base}/?token=0123456789abcdef`); assert.equal(page.status, 200); assert.match(await page.text(), /Double-tap a region/); const headers = { Authorization: "Bearer 0123456789abcdef", "Content-Type": "application/json" }; const response = await fetch(`${base}/api/command`, { method: "POST", headers, body: JSON.stringify({ type: "transport.play" }) }); assert.equal(response.status, 200); const result = await response.json() as { ok: boolean; state: { playing: boolean } }; assert.equal(result.ok, true); assert.equal(result.state.playing, true); const state = await (await fetch(`${base}/api/state`, { headers })).json() as { revision: number; performance: { playing: boolean } }; assert.equal(state.revision, 1); assert.equal(state.performance.playing, true); assert.deepEqual(calls, ["play"]); } finally { await server.close(); }
});

test("OSC dispatches through the command bus and requires its token on LAN", async () => {
  const calls:string[]=[],effects:PerformanceEffects={play:()=>calls.push("play"),pause:()=>{},stop:()=>{},seek:()=>{},panic:()=>{},announceRecovery:()=>{},cancelTransition:()=>{},recover:()=>{},setBus:()=>{},selectSong:async()=>{}};
  const manifest:ConfirmedSetManifest={schemaVersion:1,id:"set",name:"Set",confirmedAt:"now",songs:[{song:{id:songId("s"),title:"S",artist:"A",vendor:"V",originalKey:"C",originalBpm:120,originalTimeSignature:{numerator:4,denominator:4}},selectedKey:"C",selectedBpm:120,timeSignature:{numerator:4,denominator:4},durationSeconds:1,stems:[{role:"music",sourcePath:"x",durationSeconds:1}],regions:[{id:"r",name:"R",startSeconds:0,endSeconds:1}],cues:[],cacheFingerprint:"x",liveAssets:{click:{regularPath:"x",accentPath:"x",events:[{atSeconds:0,accent:true}]},repeatCuePath:"x",cues:[],pad:{key:"C",audioPath:"x"}}}]};
  const bus=new PlaybackCommandBus(new PerformanceSession(manifest,effects),"Set"),server=new RemoteControlServer(bus,{token:"0123456789abcdef",enableOsc:true,oscTokenRequired:true});const address=await server.start(),socket=createSocket("udp4");
  try{await send(socket,encodeOscMessage({address:"/playback/play",args:[]}),address.oscPort!);await delay(20);assert.deepEqual(calls,[]);const done=new Promise<void>(resolve=>{const off=bus.onResult(()=>{off();resolve();});});await send(socket,encodeOscMessage({address:"/playback/play",args:["0123456789abcdef"]}),address.oscPort!);await done;assert.deepEqual(calls,["play"]);}finally{socket.close();await server.close();}
});

function send(socket:ReturnType<typeof createSocket>,packet:Buffer,port:number):Promise<void>{return new Promise((resolve,reject)=>socket.send(packet,port,"127.0.0.1",error=>error?reject(error):resolve()));}
function delay(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
