import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const root=path.resolve("."),manifestPath=path.join(root,".playback-cache","engine-v3-silent-test","confirmed-set.json"),enginePath=path.join(root,"native","build-local","PlaybackEngineProbe_artefacts","Release","PlaybackEngineProbe.exe");
const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
const outputByRole={drums:5,bass:6,acoustic:7,electric:8,keys:9,strings:10,vocals:11,music:12,other:12,misc:12};
const routingFor=(song)=>({stems:song.stems.map(stem=>outputByRole[String(stem.role).toLowerCase()]??12),stemChannels:song.stems.map(()=>1),click:1,clickChannels:1,cue:2,cueChannels:1,pad:4,padChannels:1,iem:3,iemChannels:1});
const engine=new NativeEngineClient(),loads=[],commandLatencies=[],healthSamples=[];
const status=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Native status timeout")),2500),onTransport=(transport)=>{clearTimeout(timeout);engine.off("transport",onTransport);resolve(transport);};engine.on("transport",onTransport);engine.requestStatus();});
const health=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Native health timeout")),2500),onHealth=(value)=>{clearTimeout(timeout);engine.off("health",onHealth);resolve(value);};engine.on("health",onHealth);engine.requestStatus();});

try{
  const start=performance.now(),ready=await engine.start(enginePath,manifestPath,0,null,{type:"ASIO",name:"Dante Virtual Soundcard (x64)",outputChannels:32},null,routingFor(manifest.songs[0]));loads.push({song:0,milliseconds:performance.now()-start,armMilliseconds:ready.armMs});
  if(ready.outputChannels!==32||!ready.routingReady||!ready.iemReady)throw new Error("DVS did not arm the complete 32-channel route");
  for(let index=0;index<20;index++){const began=performance.now();await status();commandLatencies.push(performance.now()-began);}
  engine.play();await delay(10000);const playing=await status();if(playing.state!=="playing"||playing.positionSeconds<9.5||playing.positionSeconds>10.8)throw new Error(`Audio clock drifted during production run: ${playing.positionSeconds}`);healthSamples.push(await health());
  engine.pause();const paused=await status();await delay(500);const held=await status();if(Math.abs(held.positionSeconds-paused.positionSeconds)>.001)throw new Error("Pause allowed the audio clock to move");
  engine.play();await delay(2000);engine.stop();const stopped=await status();if(stopped.positionSeconds!==0)throw new Error("Stop did not return to zero");
  for(let cycle=0;cycle<100;cycle++){engine.play();engine.pause();}engine.stop();
  for(let index=1;index<manifest.songs.length;index++){await engine.setRouting(routingFor(manifest.songs[index]));const began=performance.now(),selected=await engine.selectSong(index);loads.push({song:index,milliseconds:performance.now()-began,armMilliseconds:selected.armMs});if(selected.stems!==manifest.songs[index].stems.length)throw new Error(`Song ${index+1} armed the wrong stem count`);healthSamples.push(await health());}
  const finalHealth=await health();healthSamples.push(finalHealth);
  for(const sample of healthSamples)if(sample.sampleRate!==48000||sample.blockFrames!==512||sample.xruns!==0||sample.deadlineMisses!==0||sample.deviceError||sample.iemClips!==0)throw new Error(`Production health failure: ${JSON.stringify(sample)}`);
  commandLatencies.sort((a,b)=>a-b);const sortedLoads=loads.map(item=>item.milliseconds).sort((a,b)=>a-b),percentile=(values,p)=>values[Math.min(values.length-1,Math.floor(values.length*p))];
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),result:"pass",device:"Dante Virtual Soundcard (x64)",sampleRate:finalHealth.sampleRate,blockFrames:finalHealth.blockFrames,xruns:finalHealth.xruns,deadlineMisses:finalHealth.deadlineMisses,iemClips:finalHealth.iemClips,commandLatencyMs:{median:percentile(commandLatencies,.5),p95:percentile(commandLatencies,.95),maximum:commandLatencies.at(-1)},songLoadLatencyMs:{median:percentile(sortedLoads,.5),maximum:sortedLoads.at(-1),songs:loads},rapidTransportCommands:200,clockRunSeconds:10};
  await mkdir(path.join(root,"artifacts"),{recursive:true});await writeFile(path.join(root,"artifacts","stabilization-production-report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await engine.closeAndWait();}
