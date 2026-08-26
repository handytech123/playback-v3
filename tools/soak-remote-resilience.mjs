// Isolated loopback soak. All playback/MIDI/audio effects are mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {connect} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RemoteControlServer} from '../dist/src/control/remote-server.js';
import {PlaybackCommandBus} from '../dist/src/control/command-bus.js';
import {PerformanceSession} from '../dist/src/live/performance-session.js';

const durationSeconds=Number(process.argv[2]||900);
if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>3600)throw Error('Choose a soak duration from 1 to 3600 seconds.');
const token='isolated-soak-test-token-only',headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'};
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'playback-remote-soak-'));
const effects={play(){counters.play++;},pause(){counters.pause++;},stop(){counters.stop++;},seek(){},panic(){},setBus(){},announceRecovery(){},cancelTransition(){},recover(){},async selectSong(){}};
const counters={play:0,pause:0,stop:0,requests:0,restarts:0,aborts:0,sseReconnects:0};
const songs=[];
for(let index=0;index<6;index++){
 const waveformPath=path.join(temporary,index+'.json');
 await fs.writeFile(waveformPath,JSON.stringify({buckets:Array.from({length:2400},()=>({min:-.25,max:.3})),durationSeconds:180}));
 songs.push({song:{id:String(index),title:'Mock song '+index,artist:'Test'},selectedKey:'C',selectedBpm:120,timeSignature:{numerator:4,denominator:4},durationSeconds:180,stems:[{role:'music',sourcePath:'mock-only.wav',durationSeconds:180}],regions:[{id:'verse',name:'Verse',startSeconds:0,endSeconds:180}],cues:[],cacheFingerprint:'soak',waveformPath});
}
const session=new PerformanceSession({schemaVersion:1,id:'soak',name:'Isolated remote soak',confirmedAt:'now',songs},effects);
const bus=new PlaybackCommandBus(session,'Isolated remote soak');
const server=new RemoteControlServer(bus,{token,enableOsc:false,limits:{commandBodyTimeoutMs:100,eventDrainTimeoutMs:250,maxCachedWaveforms:3}});
let address=await server.start(),base='http://127.0.0.1:'+address.httpPort;
const started=Date.now(),deadline=started+durationSeconds*1000;
let cycle=0,lastReport=started,warmHeap=null,peakHeap=0;
const samples=[];
async function request(route,options={},status=200){const response=await fetch(base+route,{headers,...options});counters.requests++;assert.equal(response.status,status);return response;}
const codeHashes={};for(const name of ['dist/src/control/remote-server.js','dist/src/control/command-bus.js'])codeHashes[name]=crypto.createHash('sha256').update(await fs.readFile(name)).digest('hex');
console.log(JSON.stringify({event:'started',durationSeconds,isolated:true,codeHashes}));
try{
 while(Date.now()<deadline){
  const cycleStarted=Date.now();cycle++;
  await Promise.all([request('/api/state'),request('/api/waveform?index='+(cycle%6)),request('/api/waveform?index='+(cycle%6))].map(async pending=>(await pending).arrayBuffer()));
  await (await request('/api/command',{method:'POST',body:JSON.stringify({type:'transport.play'})})).arrayBuffer();
  await (await request('/api/command',{method:'POST',body:JSON.stringify({type:'transport.pause'})})).arrayBuffer();
  const stream=await request('/api/events'),reader=stream.body.getReader();assert.equal((await reader.read()).done,false);await reader.cancel();counters.sseReconnects++;
  if(cycle%10===0){await (await request('/api/command',{method:'POST',body:'{'},400)).arrayBuffer();}
  if(cycle%20===0){
   const socket=connect(address.httpPort,address.host);socket.on('error',()=>{});await once(socket,'connect');
   socket.write('POST /api/command HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer '+token+'\r\nContent-Length: 1000\r\n\r\n{');
   await delay(2);socket.destroy();counters.aborts++;
  }
  if(cycle%100===0){
   const before=session.snapshot.playing;await server.close();
   assert.equal(session.snapshot.playing,before);assert.equal(server.connections.size,0);assert.equal(server.streams.size,0);assert.equal(server.waveformCache.size,0);
   address=await server.start();base='http://127.0.0.1:'+address.httpPort;counters.restarts++;
  }
  assert.equal(counters.play,cycle);assert.equal(counters.pause,cycle);assert.equal(counters.stop,0);
  assert.ok(server.waveformCache.size<=3);assert.ok(server.streams.size<=2);assert.equal(server.pendingCommands,0);
  if(Date.now()-lastReport>=30000){
   global.gc?.();const heap=process.memoryUsage().heapUsed;peakHeap=Math.max(peakHeap,heap);warmHeap??=heap;
   assert.ok(heap-warmHeap<64*1024*1024,'Heap growth exceeded 64 MiB after warmup');
   const sample={seconds:Math.round((Date.now()-started)/1000),cycles:cycle,...counters,heapMiB:Math.round(heap/1048576),cacheEntries:server.waveformCache.size,streams:server.streams.size};
   samples.push(sample);console.log(JSON.stringify(sample));lastReport=Date.now();
  }
  await delay(Math.max(1,100-(Date.now()-cycleStarted)));
 }
 await server.close();
 const result={passed:true,elapsedSeconds:(Date.now()-started)/1000,cycles:cycle,...counters,peakHeapMiB:Math.round(peakHeap/1048576),codeHashes,samples};
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/remote-soak-report.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({event:'passed',...result,samples:undefined}));
}finally{
 await server.close();const relative=path.relative(os.tmpdir(),temporary);if(relative.startsWith('playback-remote-soak-')&&!relative.includes(path.sep))await fs.rm(temporary,{recursive:true,force:true});
}
