import { spawn } from "node:child_process";
import type { StemMixSetting } from "../domain/song.js";

export const PERFORMANCE_LOUDNESS_TARGET_LUFS = -18;
export const PERFORMANCE_TRUE_PEAK_CEILING_DBTP = -3;
export const PERFORMANCE_MAX_NORMALIZATION_DB = 6;
export const PERFORMANCE_LOUDNESS_VERSION = 1;

export interface SongLoudnessNormalization {
  readonly version: typeof PERFORMANCE_LOUDNESS_VERSION;
  readonly targetLufs: number;
  readonly measuredLufs: number;
  readonly measuredTruePeakDbtp: number;
  readonly automaticGainDb: number;
  readonly appliedGainDb: number;
}

export function calculateSafeNormalizationGain(measuredLufs:number,measuredTruePeakDbtp:number):number {
  if(!Number.isFinite(measuredLufs)||!Number.isFinite(measuredTruePeakDbtp))return 0;
  const desired=PERFORMANCE_LOUDNESS_TARGET_LUFS-measuredLufs;
  // Attenuation always improves headroom. Only a positive correction needs
  // to be constrained by the measured peak ceiling.
  if(desired<=0)return round(Math.max(-PERFORMANCE_MAX_NORMALIZATION_DB,desired));
  const peakLimited=PERFORMANCE_TRUE_PEAK_CEILING_DBTP-measuredTruePeakDbtp;
  return round(Math.max(0,Math.min(PERFORMANCE_MAX_NORMALIZATION_DB,desired,peakLimited)));
}

export async function measureSongLoudness(input:{readonly stemPaths:readonly string[];readonly stemMix?:readonly StemMixSetting[];readonly ffmpegPath?:string}):Promise<SongLoudnessNormalization> {
  const audible=input.stemPaths.map((path,index)=>({path,index,mix:input.stemMix?.find(item=>item.index===index)})),
    anySolo=audible.some(item=>item.mix?.solo),
    selected=audible.filter(item=>!item.mix?.muted&&(!anySolo||item.mix?.solo));
  if(!selected.length)throw new Error("Song loudness cannot be measured because every stem is muted");
  const args=["-hide_banner","-nostats"];
  for(const item of selected)args.push("-i",item.path);
  const chains=selected.map((item,index)=>`[${index}:a]volume=${finiteGain(item.mix?.gain)}[s${index}]`),
    inputs=selected.map((_,index)=>`[s${index}]`).join("");
  chains.push(`${inputs}amix=inputs=${selected.length}:duration=longest:normalize=0,loudnorm=I=${PERFORMANCE_LOUDNESS_TARGET_LUFS}:TP=${PERFORMANCE_TRUE_PEAK_CEILING_DBTP}:LRA=11:print_format=json[out]`);
  args.push("-filter_complex",chains.join(";"),"-map","[out]","-f","null","-");
  const stderr=await run(input.ffmpegPath??"ffmpeg",args),match=stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
  if(!match)throw new Error("FFmpeg did not return a song loudness measurement");
  const report=JSON.parse(match) as Record<string,string>,measuredLufs=Number(report.input_i),measuredTruePeakDbtp=Number(report.input_tp);
  if(!Number.isFinite(measuredLufs)||!Number.isFinite(measuredTruePeakDbtp))return{version:PERFORMANCE_LOUDNESS_VERSION,targetLufs:PERFORMANCE_LOUDNESS_TARGET_LUFS,measuredLufs:-70,measuredTruePeakDbtp:-70,automaticGainDb:0,appliedGainDb:0};
  const gain=calculateSafeNormalizationGain(measuredLufs,measuredTruePeakDbtp);
  return{version:PERFORMANCE_LOUDNESS_VERSION,targetLufs:PERFORMANCE_LOUDNESS_TARGET_LUFS,measuredLufs:round(measuredLufs),measuredTruePeakDbtp:round(measuredTruePeakDbtp),automaticGainDb:gain,appliedGainDb:gain};
}

function finiteGain(value:number|undefined){return Number.isFinite(value)?Math.max(0,Math.min(1.25,value!)):1;}
function round(value:number){return Math.round(value*100)/100;}
function run(command:string,args:readonly string[]):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(command,[...args],{stdio:["ignore","ignore","pipe"]});let stderr="";child.stderr.on("data",chunk=>stderr+=chunk);child.once("error",reject);child.once("exit",code=>code===0?resolve(stderr):reject(new Error(`Song loudness analysis failed (${code}): ${stderr.trim()}`)));});}
