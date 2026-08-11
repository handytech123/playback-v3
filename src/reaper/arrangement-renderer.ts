import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ArrangementMediaItem,ArrangementVersion } from "./arrangement.js";

export interface RenderedArrangementStem {readonly role:string;readonly sourcePath:string;readonly durationSeconds:number;readonly rendered:boolean;}
const excludedTrack=/^(click|cue|slides|bc mix)$/i,excludedPad=/^pad(?:\s|$)/i;
export async function renderArrangementTracks(arrangement:ArrangementVersion,outputDirectory:string,ffmpegPath="ffmpeg"):Promise<readonly RenderedArrangementStem[]>{
  await mkdir(outputDirectory,{recursive:true});const groups=new Map<string,ArrangementMediaItem[]>();for(const item of arrangement.mediaItems){if(!item.sourcePath||excludedTrack.test(item.trackName)||excludedPad.test(item.trackName))continue;const list=groups.get(item.trackName)??[];list.push(item);groups.set(item.trackName,list);}
  const stems:RenderedArrangementStem[]=[];for(const[trackName,items]of groups){const sorted=[...items].sort((a,b)=>a.positionSeconds-b.positionSeconds),single=sorted.length===1?sorted[0]:null;if(single&&extname(single.sourcePath!).toLowerCase()===".wav"&&near(single.positionSeconds,0)&&near(single.lengthSeconds,arrangement.durationSeconds)&&near(single.sourceOffsetSeconds,0)&&near(single.playRate,1)){stems.push({role:trackName,sourcePath:single.sourcePath!,durationSeconds:arrangement.durationSeconds,rendered:false});continue;}
    const output=join(outputDirectory,`${safe(trackName)}.wav`),args:string[]=["-hide_banner","-loglevel","error","-y"];for(const item of sorted)args.push("-i",item.sourcePath!);const filters=sorted.map((item,index)=>`[${index}:a]atrim=start=${item.sourceOffsetSeconds}:duration=${item.lengthSeconds*item.playRate},asetpts=PTS-STARTPTS${near(item.playRate,1)?"":`,atempo=${item.playRate}`},adelay=${Math.round(item.positionSeconds*1000)}:all=1[a${index}]`),inputs=sorted.map((_,index)=>`[a${index}]`).join("");filters.push(`${inputs}amix=inputs=${sorted.length}:duration=longest:normalize=0,apad=whole_dur=${arrangement.durationSeconds},atrim=duration=${arrangement.durationSeconds}[out]`);args.push("-filter_complex",filters.join(";"),"-map","[out]","-c:a","pcm_s24le",output);await run(ffmpegPath,args);stems.push({role:trackName,sourcePath:output,durationSeconds:arrangement.durationSeconds,rendered:true});}
  if(!stems.length)throw new Error("Arrangement has no musical tracks to render");return stems;
}
function run(command:string,args:string[]):Promise<void>{return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:["ignore","ignore","pipe"]});let stderr="";child.stderr.on("data",chunk=>stderr+=chunk);child.once("error",reject);child.once("exit",code=>code===0?resolve():reject(new Error(`Arrangement render failed (${code}): ${stderr.trim()}`)));});}
function safe(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"track";}
function near(a:number,b:number){return Math.abs(a-b)<.001;}
