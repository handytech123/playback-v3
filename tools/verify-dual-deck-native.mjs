import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const executable=resolve(process.argv[2]??join(root,"native","build-local","PlaybackEngineProbe_artefacts","Release","PlaybackEngineProbe.exe"));
if(!existsSync(executable))throw new Error(`Native A/B executable is missing: ${executable}`);
const manifestPath=resolve(process.argv[3]??latestConfirmedManifest());
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
if(!Array.isArray(manifest.songs)||manifest.songs.length<2)throw new Error("A/B verification requires at least two confirmed songs");
const device=process.argv[4]?{type:process.argv[4],name:process.argv[5],outputs:Number(process.argv[6])}:firstWindowsOutput();
if(!device.name||!Number.isFinite(device.outputs)||device.outputs<2)throw new Error("Explicit A/B verification device is invalid");
const midiOutput=process.argv[7]??null;
const child=spawn(executable,[manifestPath,"--interactive","--song-index","0",...(midiOutput?["--midi-output",midiOutput]:["--disable-midi"]),"--disable-midi-input","--audio-device-type",device.type,"--audio-device-name",device.name,"--output-count",String(device.outputs)],{stdio:["pipe","pipe","pipe"]});
const lines=[];let buffer="",errorBuffer="";
child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
child.stdout.on("data",chunk=>{buffer+=chunk;const parts=buffer.split(/\r?\n/);buffer=parts.pop()??"";for(const line of parts)lines.push(line);});
child.stderr.on("data",chunk=>{errorBuffer+=chunk;});
await waitFor(line=>line.startsWith("READY "),20000);
send("play");
// Exercise pause/resume and cancellation before accepting the first promotion.
send("transition_song 1 crossfade 1 1");await delay(150);send("pause");await delay(80);send("play");send("cancel_transition");const cancelled=await pollFor(line=>{if(!line.startsWith("DECKS "))return false;const value=parseFields(line);return value.transition==="0"&&(!midiOutput||value.midi_owner==="A");},10000);assert(cancelled.includes("active=A"),"Cancellation did not preserve outgoing Deck A");
let expectedDeck="B";
for(let index=1;index<manifest.songs.length;index++){
  const transitionSeconds=index===1?5:0.2;
  if(index===1){send(`seek ${Math.max(0,manifest.songs[0].durationSeconds-transitionSeconds)}`);await delay(80);}
  const transitionLineStart=lines.length;send(`transition_song ${index} crossfade ${transitionSeconds} 1`);
  if(index===1){await delay(1500);send("status");const mid=await waitForSince(transitionLineStart,line=>{if(!line.startsWith("DECKS ")||!line.includes("transition=1"))return false;const value=parseFields(line),a=Number(value.a_gain),b=Number(value.b_gain);return a>.1&&a<.9&&b>.1&&b<.9;},2000);const value=parseFields(mid);assert(Math.abs(Number(value.a_gain)+Number(value.b_gain)-1)<.08,"A/B timeline lost complementary deck gains");if(midiOutput)assert(value.midi_owner==="B","Incoming Deck B did not take MIDI ownership at transition start");}
  const complete=await pollFor(line=>line.startsWith(`TRANSITION_COMPLETE index=${index} `),15000);
  const fields=parseFields(complete);const song=manifest.songs[index];
  assert(fields.deck===expectedDeck,`song ${index+1} promoted deck ${fields.deck}, expected ${expectedDeck}`);
  if(index===1)assert(Number(fields.elapsed_seconds)>=4.8,`full crossfade advanced incoming deck only ${fields.elapsed_seconds}s`);
  assert(Number(fields.stems)===song.stems.length,`song ${index+1} stem count mismatch`);
  assert(Number(fields.click_events)===(song.liveAssets?.click?.events?.length??0),`song ${index+1} click count mismatch`);
  assert(Number(fields.cue_events)===((song.liveAssets?.cues?.length??0)+(song.liveAssets?.countIn?.length??0)),`song ${index+1} cue count mismatch`);
  assert(fields.pad_key===(song.liveAssets?.pad?.key??""),`song ${index+1} pad key mismatch`);
  assert(Number(fields.midi_events)===(song.control?.proPresenterMidi?.length??song.arrangement?.proPresenterMidi?.length??0),`song ${index+1} MIDI count mismatch`);
  const normalizationStart=lines.length;send("status");const normalized=await waitForSince(normalizationStart,line=>line.startsWith("STATE "),2000),actualGain=Number(parseFields(normalized).music_gain_target),expectedGain=Math.pow(10,Number(song.loudnessNormalization?.appliedGainDb??0)/20);assert(Math.abs(actualGain-expectedGain)<.002,`song ${index+1} normalization gain ${actualGain} did not match ${expectedGain}`);
  if(index+1<manifest.songs.length)assert(fields.next_ready==="1"&&Number(fields.next_index)===index+1,`song ${index+1} did not preload song ${index+2}`);
  expectedDeck=expectedDeck==="B"?"A":"B";
}
send("stop");send("status");const stopped=await waitFor(line=>line.startsWith("STATE state=paused position_seconds=0"),5000);send("quit");
await new Promise((resolveExit,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error("Native engine did not exit after verification"));},5000);child.once("exit",code=>{clearTimeout(timer);code===0?resolveExit():reject(new Error(`Native engine exited ${code}: ${errorBuffer}`));});});
const health=lines.filter(line=>line.startsWith("HEALTH ")).map(parseFields);assert(health.length>0,"A/B verification captured no audio health telemetry");assert(health.every(item=>item.device_error==="0"),"Audio device reported an error during A/B verification");assert(health.every(item=>Number(item.xruns)===0),"Audio device reported an xrun during A/B verification");
console.log(`A/B VERIFIED songs=${manifest.songs.length} decks=A/B device="${device.name}" final="${stopped}"`);

function latestConfirmedManifest(){const base=join(process.env.APPDATA??"", "playback-v3",".playback-cache","confirmed-sets");const files=readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>join(base,entry.name,"confirmed-set.json")).filter(existsSync).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);if(!files[0])throw new Error("No confirmed set is available for A/B verification");return files[0];}
function firstWindowsOutput(){const result=spawnSync(executable,["--list-audio-devices"],{encoding:"utf8"});if(result.status!==0)throw new Error(result.stderr||"Could not list audio devices");for(const line of result.stdout.split(/\r?\n/)){const[type,name,count]=line.split("\t"),outputs=Number(count);if(type==="Windows Audio"&&outputs>=2)return{type,name,outputs};}throw new Error("No Windows Audio output is available for isolated A/B verification");}
function send(command){child.stdin.write(`${command}\n`);}
function delay(ms){return new Promise(resolveDelay=>setTimeout(resolveDelay,ms));}
async function pollFor(predicate,timeout){const deadline=Date.now()+timeout;while(Date.now()<deadline){send("status");try{return await waitFor(predicate,250);}catch{}await delay(30);}throw new Error(`Timed out waiting for A/B result. Last lines:\n${lines.slice(-12).join("\n")}\n${errorBuffer}`);}
function waitFor(predicate,timeout){const existing=lines.find(predicate);if(existing)return Promise.resolve(existing);return new Promise((resolveWait,reject)=>{const deadline=Date.now()+timeout;const timer=setInterval(()=>{const found=lines.find(predicate);if(found){clearInterval(timer);resolveWait(found);}else if(Date.now()>=deadline){clearInterval(timer);reject(new Error("Native output timeout"));}},10);});}
function waitForSince(start,predicate,timeout){const existing=lines.slice(start).find(predicate);if(existing)return Promise.resolve(existing);return new Promise((resolveWait,reject)=>{const deadline=Date.now()+timeout;const timer=setInterval(()=>{const found=lines.slice(start).find(predicate);if(found){clearInterval(timer);resolveWait(found);}else if(Date.now()>=deadline){clearInterval(timer);reject(new Error(`Native output timeout:\n${lines.slice(start).join("\n")}`));}},10);});}
function parseFields(line){return Object.fromEntries(line.trim().split(/\s+/).slice(1).map(part=>{const at=part.indexOf("=");return[part.slice(0,at),part.slice(at+1)];}));}
function assert(condition,message){if(!condition)throw new Error(message);}
