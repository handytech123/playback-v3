import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { validateConfirmedSet } from "../dist/src/confirmed-set/manifest.js";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const root=path.resolve(".");
const setRoot=path.join(root,".playback-cache","milestone-1-cornerstone-performance-v3");
const manifestPath=path.join(setRoot,"confirmed-set.json");
const enginePath=path.join(root,"native","build","PlaybackEngineProbe_artefacts","Release","PlaybackEngineProbe.exe");
const manifest=JSON.parse(await readFile(manifestPath,"utf8")); const report=validateConfirmedSet(manifest);
if(!report.ready)throw new Error(`Readiness failed: ${report.issues.map((issue)=>issue.message).join("; ")}`);
const song=manifest.songs[0]; if(song.song.id!=="songselect:6158927"||song.song.title!=="Cornerstone"||song.selectedKey!=="C"||song.selectedBpm!==72)throw new Error("Production master facts are incorrect");
if(song.stems.some((stem)=>stem.role==="click-reference"||stem.role==="cue-reference"))throw new Error("Vendor click/cue reference stem entered live playback");
const assetPaths=[song.waveformPath,...song.stems.map((stem)=>stem.sourcePath),song.liveAssets.click.regularPath,song.liveAssets.click.accentPath,song.liveAssets.pad.audioPath,...song.liveAssets.cues.map((cue)=>cue.audioPath)];
for(const assetPath of new Set(assetPaths)){const relative=path.relative(setRoot,assetPath);if(relative.startsWith("..")||path.isAbsolute(relative))throw new Error(`Live path escaped confirmed cache: ${assetPath}`);await access(assetPath);}
const waveform=JSON.parse(await readFile(song.waveformPath,"utf8"));if(waveform.buckets.length!==2400||Math.abs(waveform.durationSeconds-song.durationSeconds)>.001)throw new Error("Waveform cache does not match song");
if(song.liveAssets.click.events[0].atSeconds!==0||song.liveAssets.click.events.length!==493)throw new Error("Click plan is invalid");
const regionIds=new Set(song.regions.map((region)=>region.id));if(song.liveAssets.cues.length!==20||song.liveAssets.cues.some((cue)=>!regionIds.has(cue.targetRegionId)))throw new Error("Cue plan is invalid");

const engine=new NativeEngineClient(); const ready=await engine.start(enginePath,manifestPath); if(ready.stems!==9||ready.clickEvents!==493||ready.cueEvents!==20||ready.padKey!=="C")throw new Error("Native engine did not arm the complete live asset plan");
const status=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Native state timeout")),2000);engine.once("transport",(state)=>{clearTimeout(timeout);resolve(state);});engine.requestStatus();});
let state=await status(); if(state.positionSeconds!==0)throw new Error("Initial clock is not zero");
engine.play(); await delay(900); state=await status(); if(state.state!=="playing"||state.positionSeconds<.7||state.positionSeconds>1.2)throw new Error(`Audio clock did not advance correctly: ${state.positionSeconds}`);if(typeof state.startLatencyMs!=="number"||state.startLatencyMs>50)throw new Error(`Audio start latency is too high: ${state.startLatencyMs}`);
engine.pause(); const paused=await status(); await delay(250); state=await status(); if(Math.abs(state.positionSeconds-paused.positionSeconds)>.001)throw new Error("Paused clock moved");
engine.seek(30); state=await status(); if(Math.abs(state.positionSeconds-30)>.001)throw new Error("Seek was not exact");
for(let index=0;index<100;index+=1){engine.play();engine.pause();}
engine.stop(); state=await status(); if(state.positionSeconds!==0)throw new Error("Stop did not reset to zero"); engine.close();
console.log(JSON.stringify({ready:true,sourceIdentity:song.song.id,stems:song.stems.length,regions:song.regions.length,waveformBuckets:waveform.buckets.length,clickEvents:song.liveAssets.click.events.length,cueEvents:song.liveAssets.cues.length,padKey:song.liveAssets.pad.key,deviceOpenMs:ready.deviceOpenMs,armMs:ready.armMs,audioStartLatencyMs:state.startLatencyMs,transportStressCycles:100,cacheIsolated:true},null,2));
