import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { validateConfirmedSet } from "../confirmed-set/manifest.js";
import { buildDynamicClickEvents } from "../domain/grid.js";
import { requiredDefaultClickTemplate } from "../domain/click-templates.js";
import type { OriginalSongFacts } from "../domain/song.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import { prepareAudioSource } from "../prep/audio-source.js";
import type { ArrangementVersion } from "./arrangement.js";
import type { RenderedArrangementStem } from "./arrangement-renderer.js";

export interface ArrangementConfirmInput {
  readonly arrangement: ArrangementVersion; readonly stems: readonly RenderedArrangementStem[]; readonly originalSong: OriginalSongFacts;
  readonly outputDirectory: string; readonly cueDirectory: string; readonly clickRegularPath: string; readonly clickAccentPath: string;
  readonly padPath: string; readonly ffmpegPath?: string; readonly midiOutputName?: string | null;
}

export async function confirmArrangement(input: ArrangementConfirmInput): Promise<{manifestPath:string;manifest:ConfirmedSetManifest}> {
  if (!input.arrangement.selectedKey) throw new Error("Arrangement key must be approved before confirmation");
  await mkdir(input.outputDirectory,{recursive:true});
  const assets=join(input.outputDirectory,"live-assets"),cueOutput=join(assets,"cues"),stemOutput=join(input.outputDirectory,"performance-stems");await Promise.all([mkdir(cueOutput,{recursive:true}),mkdir(stemOutput,{recursive:true})]);
  const ffmpegPath=input.ffmpegPath??"ffmpeg",performanceStems=[];
  for(const[index,stem]of input.stems.entries()){const destination=join(stemOutput,`${String(index+1).padStart(2,"0")}-${safe(stem.displayName??stem.role)}.wav`);if(!(await exists(destination)))await prepareAudioSource(stem.sourcePath,destination,ffmpegPath);performanceStems.push({...stem,sourcePath:destination,rendered:true});}
  const regular=join(assets,"click-regular.wav"),accent=join(assets,"click-accent.wav"),pad=join(assets,`pad-${input.arrangement.selectedKey}.wav`),repeat=join(cueOutput,"repeat.wav");
  const copies: readonly (readonly [string,string])[]=[[input.clickRegularPath,regular],[input.clickAccentPath,accent],[input.padPath,pad],[join(input.cueDirectory,"REPEAT.wav"),repeat]];
  await Promise.all(copies.map(async([source,destination])=>{if(!(await exists(destination)))await prepareAudioSource(source,destination,ffmpegPath);}));
  const cues=[];for(const cue of input.arrangement.cueMarkers){const phrase=spokenCuePhrase(cue.phrase),output=join(cueOutput,`${safe(phrase)}.wav`),sourcePath=await resolveCueSource(input.cueDirectory,phrase);await writeCountedCue({sourcePath,destinationPath:output,numberDirectory:input.cueDirectory,bpm:input.arrangement.selectedBpm,meter:input.arrangement.timeSignature,ffmpegPath:input.ffmpegPath??"ffmpeg"});cues.push({...(cue.position?{position:cue.position}:{}),atSeconds:cue.atSeconds,label:phrase,audioPath:output,targetRegionId:cue.targetRegionId});}
  const waveformPath=join(input.outputDirectory,"waveform.json"),proxy=join(input.outputDirectory,"waveform-source.wav");if(!(await exists(waveformPath))){await run(input.ffmpegPath??"ffmpeg",["-hide_banner","-loglevel","error","-y","-i",input.stems[0]!.sourcePath,"-ac","1","-c:a","pcm_s16le",proxy]);const {writeWaveformSummary}=await import("../prep/wav-waveform.js");await writeWaveformSummary(proxy,waveformPath);}
  const fingerprint=createHash("sha256").update(input.arrangement.sourceSha256).update(JSON.stringify(performanceStems.map(x=>[x.role,x.sourcePath]))).digest("hex");
  const templateId=input.arrangement.clickTemplateId??requiredDefaultClickTemplate(input.arrangement.timeSignature);
  const manifest:ConfirmedSetManifest={schemaVersion:1,id:`confirmed-${input.arrangement.id}`,name:input.arrangement.name,confirmedAt:new Date().toISOString(),songs:[{song:input.originalSong,selectedKey:input.arrangement.selectedKey,selectedBpm:input.arrangement.selectedBpm,timeSignature:input.arrangement.timeSignature,durationSeconds:input.arrangement.durationSeconds,stems:performanceStems.map(({role,sourcePath,durationSeconds,displayName})=>({role,sourcePath,durationSeconds,...(displayName?{displayName}:{})})),...(input.arrangement.stemMix?{stemMix:input.arrangement.stemMix}:{}),regions:input.arrangement.regions,cues:input.arrangement.cueMarkers,cacheFingerprint:`sha256:${fingerprint}`,waveformPath,liveAssets:{click:{regularPath:regular,accentPath:accent,events:buildDynamicClickEvents(input.arrangement.selectedBpm,input.arrangement.timeSignature,input.arrangement.durationSeconds,templateId),templateId},cues,cueCountVersion:2,repeatCuePath:repeat,pad:{key:input.arrangement.selectedKey,audioPath:pad}},arrangement:{id:input.arrangement.id,name:input.arrangement.name,sourceType:input.arrangement.sourceType,sourceSha256:input.arrangement.sourceSha256,proPresenterMidi:input.arrangement.proPresenterMidi.map(x=>({...(x.position?{position:x.position}:{}),atSeconds:x.atSeconds,status:x.status,data1:x.data1,data2:x.data2})),midiOutputName:input.midiOutputName??null}}]};
  const readiness=validateConfirmedSet(manifest);if(!readiness.ready)throw new Error(readiness.issues.map(x=>x.message).join("; "));const manifestPath=join(input.outputDirectory,"confirmed-set.json");await writeFile(manifestPath,JSON.stringify(manifest,null,2));return{manifestPath,manifest};
}

export function spokenCuePhrase(label:string){return normalizeCueFileLabel(label).replace(/\s+\d+$/," ").replace(/\s+/g," ").trim();}
async function resolveCueSource(directory:string,label:string){const normalized=normalizeCueFileLabel(label),aliases:Record<string,string>={START:"CountIn.wav","COUNT OFF":"CountIn.wav"},names=[aliases[normalized.toUpperCase()]??`${normalized.toUpperCase()}.wav`,`${normalized.toUpperCase().replace(/\s+/g,"")}.wav`];for(const name of names){const candidate=join(directory,name);if(await exists(candidate))return candidate;}throw new Error(`No cue audio for ${label}`);}
function normalizeCueFileLabel(label:string){return label.trim().replace(/([A-Za-z])([0-9])$/,"$1 $2").replace(/^Turn\s*Arround/i,"Turn Around").replace(/^Turnaround/i,"Turn Around").replace(/-/g," ").replace(/\s+/g," ");}
function run(command:string,args:string[]):Promise<void>{return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:["ignore","ignore","pipe"]});let error="";child.stderr.on("data",x=>error+=x);child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(new Error(`${command} failed (${code}): ${error}`)));});}
async function exists(path:string){try{return(await stat(path)).isFile();}catch{return false;}}
function safe(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"cue";}
