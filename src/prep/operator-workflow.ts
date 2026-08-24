import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { confirmSet, type SongPreparationInput } from "../confirmed-set/prepare.js";
import { DEFAULT_SHOW_STATE, type ConfirmedSetManifest, type ConfirmedSetShowState } from "../confirmed-set/manifest.js";
import type { PreparedSong, StemMixSetting } from "../domain/song.js";
import { DEFAULT_SONG_TRANSITION, transitionDuration, type SongTransitionSettings, type SongTransitionType } from "../live/song-transition.js";

export interface PreparedLibraryChoice { readonly id:string;readonly songId:string;readonly title:string;readonly artist:string;readonly arrangement:string;readonly key:string;readonly bpm:number;readonly manifestPath:string;readonly songIndex:number; }
export interface OperatorSetlistItem extends PreparedLibraryChoice { readonly itemId:string;readonly transitionToNext?:{readonly type:SongTransitionType;readonly continuePad:boolean};readonly stemMix?:readonly StemMixSetting[]; }
export interface OperatorSetlist { readonly schemaVersion:1;readonly id:string;readonly name:string;readonly items:readonly OperatorSetlistItem[];readonly updatedAt:string; }

export function createOperatorSetlist(name="Sunday Set"):OperatorSetlist{return{schemaVersion:1,id:`set-${randomUUID()}`,name,items:[],updatedAt:new Date().toISOString()};}
export function addPreparedSong(setlist:OperatorSetlist,choice:PreparedLibraryChoice,index=setlist.items.length):OperatorSetlist{if(index<0||index>setlist.items.length)throw new Error("Setlist insertion index is outside the list");const item={...choice,itemId:randomUUID(),transitionToNext:{...DEFAULT_SONG_TRANSITION}},items=[...setlist.items];items.splice(index,0,item);return touch(setlist,items);}
export function movePreparedSong(setlist:OperatorSetlist,itemId:string,direction:-1|1):OperatorSetlist{const from=setlist.items.findIndex(item=>item.itemId===itemId),to=from+direction;if(from<0)throw new Error("Setlist item was not found");if(to<0||to>=setlist.items.length)return setlist;const items=[...setlist.items],[item]=items.splice(from,1);items.splice(to,0,item!);return touch(setlist,items);}
export function reorderPreparedSong(setlist:OperatorSetlist,itemId:string,beforeItemId:string|null):OperatorSetlist{const from=setlist.items.findIndex(item=>item.itemId===itemId);if(from<0)throw new Error("Setlist item was not found");if(beforeItemId===itemId)return setlist;const items=[...setlist.items],[item]=items.splice(from,1);const destination=beforeItemId===null?items.length:items.findIndex(candidate=>candidate.itemId===beforeItemId);if(destination<0)throw new Error("Setlist destination was not found");items.splice(destination,0,item!);return touch(setlist,items);}
export function removePreparedSong(setlist:OperatorSetlist,itemId:string):OperatorSetlist{const items=setlist.items.filter(item=>item.itemId!==itemId);if(items.length===setlist.items.length)throw new Error("Setlist item was not found");return touch(setlist,items);}
export function replacePreparedSong(setlist:OperatorSetlist,itemId:string,choice:PreparedLibraryChoice):OperatorSetlist{const index=setlist.items.findIndex(item=>item.itemId===itemId);if(index<0)throw new Error("Setlist item was not found");const items=[...setlist.items],transitionToNext=items[index]!.transitionToNext;items[index]={...choice,itemId,...(transitionToNext?{transitionToNext}:{})};return touch(setlist,items);}
export function renameOperatorSetlist(setlist:OperatorSetlist,name:string):OperatorSetlist{if(!name.trim())throw new Error("Setlist name is required");return{...setlist,name:name.trim(),updatedAt:new Date().toISOString()};}
export function setOperatorSetTransition(setlist:OperatorSetlist,itemId:string,type:SongTransitionType,continuePad=true):OperatorSetlist{const index=setlist.items.findIndex(item=>item.itemId===itemId);if(index<0)throw new Error("Setlist item was not found");if(index>=setlist.items.length-1)throw new Error("The final song does not have a following transition");const items=[...setlist.items];items[index]={...items[index]!,transitionToNext:{type,continuePad}};return touch(setlist,items);}

export async function discoverPreparedLibrary(manifestPaths:readonly string[]):Promise<PreparedLibraryChoice[]>{const result:PreparedLibraryChoice[]=[];for(const manifestPath of [...new Set(manifestPaths.map(path=>resolve(path)))]){try{const manifest=JSON.parse(await readFile(manifestPath,"utf8")) as ConfirmedSetManifest;for(const[songIndex,song]of manifest.songs.entries()){const arrangement=song.arrangement?.name??"Original Song";if(arrangement!=="Original Song"&&!song.regions.length)continue;result.push({id:`${manifestPath}:${songIndex}`,songId:String(song.song.id),title:song.song.title,artist:song.song.artist,arrangement,key:song.selectedKey,bpm:song.selectedBpm,manifestPath,songIndex});}}catch{}}return result.sort((a,b)=>a.title.localeCompare(b.title)||arrangementSortRank(a)-arrangementSortRank(b)||a.arrangement.localeCompare(b.arrangement));}
export async function loadOperatorSetlist(path:string):Promise<OperatorSetlist>{try{const parsed=JSON.parse(await readFile(path,"utf8")) as OperatorSetlist;if(parsed.schemaVersion!==1||!Array.isArray(parsed.items))throw new Error("Unsupported setlist");return parsed;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return createOperatorSetlist();}}
export async function saveOperatorSetlist(path:string,setlist:OperatorSetlist):Promise<void>{await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${process.pid}.tmp`;await writeFile(temporary,`${JSON.stringify(setlist,null,2)}\n`,"utf8");await rename(temporary,path);}

export async function confirmOperatorSet(input:{readonly setlist:OperatorSetlist;readonly cacheRoot:string;readonly show?:ConfirmedSetShowState;readonly ffmpegPath?:string;readonly transitionSettings?:SongTransitionSettings;readonly clickRegularPath?:string;readonly clickAccentPath?:string;readonly onProgress?:(status:{progress:number;label:string})=>void}){if(!input.setlist.items.length)throw new Error("Add at least one prepared song before Confirm Set");const songs:SongPreparationInput[]=[];input.onProgress?.({progress:2,label:"Checking prepared song sources"});for(const[index,item]of input.setlist.items.entries()){input.onProgress?.({progress:Math.round(4+(index/input.setlist.items.length)*20),label:`Checking ${item.title}`});const manifest=JSON.parse(await readFile(item.manifestPath,"utf8")) as ConfirmedSetManifest,sourceSong=manifest.songs[item.songIndex],review=(manifest as any).review;if(!sourceSong||String(sourceSong.song.id)!==item.songId)throw new Error(`${item.title} no longer matches its prepared source`);const song:PreparedSong=item.stemMix?{...sourceSong,stemMix:item.stemMix}:sourceSong;if(review&&review.performanceEligible!==true){const issues=autoApprovalIssues(song);if(issues.length)throw new Error(`${item.title} is Analyzer review metadata and cannot be auto-approved: ${issues.join("; ")}`);input.onProgress?.({progress:Math.round(4+(index/input.setlist.items.length)*20),label:`Auto-approving ${item.title}`});}const stems=[];for(const stem of song.stems)stems.push({relativePath:basename(stem.sourcePath),sourcePath:stem.sourcePath,role:stem.role,durationSeconds:stem.durationSeconds,sha256:await sha256(stem.sourcePath)});if(!song.liveAssets)throw new Error(`${item.title} has no prepared live assets`);if(!song.liveAssets.click.templateId||!song.liveAssets.click.events.length)throw new Error(`${item.title} is missing Analyzer click event metadata`);songs.push({preparedSong:song,sourceFolder:dirname(song.stems[0]!.sourcePath),stems,liveAssets:{click:{regularPath:input.clickRegularPath??song.liveAssets.click.regularPath,accentPath:input.clickAccentPath??song.liveAssets.click.accentPath,events:song.liveAssets.click.events,templateId:song.liveAssets.click.templateId},cues:song.liveAssets.cues.map(cue=>({...("position" in cue&&cue.position?{position:cue.position}:{}),atSeconds:cue.atSeconds,label:cue.label,sourcePath:cue.audioPath,targetRegionId:cue.targetRegionId})),repeatCuePath:song.liveAssets.repeatCuePath,pad:{key:song.liveAssets.pad.key,sourcePath:song.liveAssets.pad.audioPath}}});}
  const transitions=input.setlist.items.slice(0,-1).map((item,index)=>{const type=item.transitionToNext?.type??DEFAULT_SONG_TRANSITION.type,outgoing=songs[index]!.preparedSong,incoming=songs[index+1]!.preparedSong,last=outgoing.regions.at(-1),first=incoming.regions[0],durationSeconds=transitionDuration(type,last?last.endSeconds-last.startSeconds:5,first?first.endSeconds-first.startSeconds:5,input.transitionSettings);return{fromSongIndex:index,toSongIndex:index+1,type,durationSeconds,continuePad:item.transitionToNext?.continuePad??DEFAULT_SONG_TRANSITION.continuePad};});
  const setId=`confirmed-${slug(input.setlist.name)}-${Date.now()}`,ffmpegPath=input.ffmpegPath??process.env.PLAYBACK_FFMPEG_PATH;return confirmSet({setId,setName:input.setlist.name,cacheRoot:input.cacheRoot,songs,transitions,show:input.show??DEFAULT_SHOW_STATE,onProgress:status=>input.onProgress?.({progress:25+Math.round(status.progress*.75),label:status.label}),...(ffmpegPath?{ffmpegPath}:{})});
}
function touch(setlist:OperatorSetlist,items:readonly OperatorSetlistItem[]):OperatorSetlist{return{...setlist,items,updatedAt:new Date().toISOString()};}
function arrangementSortRank(choice:PreparedLibraryChoice):number{return choice.arrangement==="Original Song"?0:1;}
function slug(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"set";}
async function sha256(path:string){const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);return hash.digest("hex");}

function autoApprovalIssues(song:PreparedSong):string[]{
  const issues:string[]=[];
  if(!song.selectedKey)issues.push("missing key");
  if(!Number.isFinite(song.selectedBpm)||song.selectedBpm<=0)issues.push("missing BPM");
  if(!song.timeSignature?.numerator||!song.timeSignature?.denominator)issues.push("missing time signature");
  if(!Number.isFinite(song.durationSeconds)||song.durationSeconds<=0)issues.push("invalid duration");
  if(!song.stems.length)issues.push("missing playable stems");
  if(song.stems.some(stem=>!stem.sourcePath))issues.push("stem path missing");
  if(!song.regions.length)issues.push("missing regions");
  if(song.regions.some(region=>!region.startPosition||!region.endPosition||region.endSeconds<=region.startSeconds))issues.push("invalid region timing");
  if(!song.cues.length)issues.push("missing cues");
  if(song.cues.some(cue=>!cue.position||!cue.targetRegionId||cue.atSeconds<0||cue.atSeconds>song.durationSeconds))issues.push("invalid cue timing");
  if(!song.liveAssets)issues.push("missing live assets");
  else{
    if(!song.liveAssets.click.templateId||!song.liveAssets.click.events.length)issues.push("missing click template/events");
    if(song.liveAssets.click.events[0]?.atSeconds!==0)issues.push("click does not start at 0");
    if(!song.liveAssets.click.regularPath||!song.liveAssets.click.accentPath)issues.push("missing click audio");
    if(!song.liveAssets.cues.length)issues.push("missing dynamic cue audio");
    if(song.liveAssets.cues.some(cue=>!cue.audioPath||!cue.targetRegionId||cue.atSeconds<0||cue.atSeconds>song.durationSeconds))issues.push("invalid dynamic cue event");
    if(!song.liveAssets.repeatCuePath)issues.push("missing repeat cue");
    if(!song.liveAssets.pad.audioPath)issues.push("missing pad audio");
    if(song.liveAssets.pad.key!==song.selectedKey)issues.push("pad key does not match selected key");
  }
  return issues;
}
