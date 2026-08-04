import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { PreparedSong, Region, SongId } from "../domain/song.js";
import { normalizeRegions } from "../edit/song-map.js";
import type { ArrangementCue, ArrangementImportPreview, ArrangementMediaItem, ArrangementVersion, ProPresenterMidiEvent, ReaperMarker } from "./arrangement.js";

interface Node { tag:string;args:string[];lines:string[][];children:Node[]; }
const words=(line:string):string[]=>[...line.matchAll(/"((?:\\.|[^"])*)"|(\S+)/g)].map((m)=>m[1]??m[2]!);
const value=(node:Node,name:string)=>node.lines.find((line)=>line[0]===name)?.slice(1);
const children=(node:Node,name:string)=>node.children.filter((child)=>child.tag===name);

export async function importReaperProject(path:string,songId:SongId,original?:PreparedSong):Promise<ArrangementImportPreview>{
  const text=await readFile(path,"utf8"),root=parseRpp(text),project=root.children.find((node)=>node.tag==="REAPER_PROJECT");
  if(!project)throw new Error("RPP has no REAPER_PROJECT root");
  const tempoLine=value(project,"TEMPO");if(!tempoLine)throw new Error("RPP has no project tempo");
  const bpm=Number(tempoLine[0]),numerator=Number(tempoLine[1]),denominator=Number(tempoLine[2]);
  if(!Number.isFinite(bpm)||bpm<=0||!Number.isInteger(numerator)||!Number.isInteger(denominator))throw new Error("RPP project tempo is invalid");
  const warnings:string[]=[],tempoEnvelope=children(project,"TEMPOENVEX")[0],tempoPoints=tempoEnvelope?.lines.filter((line)=>line[0]==="PT")??[];if(tempoPoints.length)warnings.push("Tempo changes detected; constant project tempo used for this import preview");
  const markerLines=project.lines.filter((line)=>line[0]==="MARKER");
  const parsedMarkers=markerLines.map(parseMarker).filter((item):item is ParsedMarker=>item!==null);
  const regionStarts=parsedMarkers.filter((item)=>item.isRegion&&item.name.length>0),regionEnds=parsedMarkers.filter((item)=>item.isRegion&&!item.name);
  let rawRegions=regionStarts.map((start,ordinal)=>{const end=regionEnds.find((item)=>item.index===start.index&&item.atSeconds>start.atSeconds);if(!end)throw new Error(`Reaper region ${start.name} has no end`);return{id:`reaper-region-${String(ordinal+1).padStart(4,"0")}`,name:start.name,startSeconds:start.atSeconds,endSeconds:end.atSeconds};});
  let normalized=normalizeRegions(rawRegions);
  let regions:Region[]=normalized.map((region)=>({id:region.id,name:region.name,startSeconds:region.startSeconds,endSeconds:region.endSeconds}));
  let regionByIndex=new Map(regionStarts.map((start,index)=>[start.index,regions[index]!]));
  const markers:ReaperMarker[]=parsedMarkers.filter((item)=>!item.isRegion).map((item)=>({index:item.index,name:item.name,atSeconds:item.atSeconds}));
  let cueMarkers:ArrangementCue[]=markers.filter((marker)=>marker.name&&regionByIndex.has(marker.index)&&regionByIndex.get(marker.index)!.name!=="Other").map((marker)=>({phrase:regionByIndex.get(marker.index)!.name,atSeconds:marker.atSeconds,targetRegionId:regionByIndex.get(marker.index)!.id}));
  if(!cueMarkers.length&&regions[0])cueMarkers=[{phrase:"Intro",atSeconds:0,targetRegionId:regions[0].id}];
  const tracks=children(project,"TRACK"),slides=tracks.find((track)=>(value(track,"NAME")?.join(" ")??"").trim().toLowerCase()==="slides");
  const mediaItems:ArrangementMediaItem[]=[];for(const track of tracks){const trackName=(value(track,"NAME")?.join(" ")??"").trim();for(const item of children(track,"ITEM")){const source=item.children.find((child)=>child.tag==="SOURCE");if(source?.args[0]==="MIDI")continue;const rawSource=value(source??emptyNode(),"FILE")?.[0]??null,sourcePath=rawSource?(isAbsolute(rawSource)?rawSource:resolve(dirname(path),rawSource)):null;mediaItems.push({trackName,positionSeconds:num(value(item,"POSITION")?.[0],0),lengthSeconds:num(value(item,"LENGTH")?.[0],0),sourcePath,sourceOffsetSeconds:num(value(item,"SOFFS")?.[0],0),playRate:num(value(item,"PLAYRATE")?.[0],1)});}}
  const proPresenterMidi=slides?decodeSlides(slides,bpm):[];if(!slides)warnings.push("No Slides track found; no ProPresenter MIDI imported");
  const durationSeconds=Math.max(0,...regions.map((item)=>item.endSeconds),...mediaItems.map((item)=>item.positionSeconds+item.lengthSeconds));
  const measureSeconds=numerator*(60/bpm)*(4/denominator),lastMappedEnd=Math.max(0,...rawRegions.map(region=>region.endSeconds));
  const inferredStarts=markers.filter(marker=>marker.name&&!regionByIndex.has(marker.index)).map(marker=>({marker,startSeconds:marker.atSeconds+measureSeconds})).filter(item=>item.startSeconds>=lastMappedEnd-.05&&item.startSeconds<durationSeconds-.05).sort((a,b)=>a.startSeconds-b.startSeconds);
  if(inferredStarts.length){rawRegions=[...rawRegions,...inferredStarts.map((item,index)=>({id:`reaper-region-${String(rawRegions.length+index+1).padStart(4,"0")}`,name:item.marker.name,startSeconds:item.startSeconds,endSeconds:inferredStarts[index+1]?.startSeconds??durationSeconds}))];normalized=normalizeRegions(rawRegions);regions=normalized.map(region=>({id:region.id,name:region.name,startSeconds:region.startSeconds,endSeconds:region.endSeconds}));const indexed=[...regionStarts.map(start=>start.index),...inferredStarts.map(item=>item.marker.index)];regionByIndex=new Map(indexed.map((index,position)=>[index,regions[position]!]));cueMarkers=markers.filter(marker=>marker.name&&regionByIndex.has(marker.index)&&regionByIndex.get(marker.index)!.name!=="Other").map(marker=>({phrase:regionByIndex.get(marker.index)!.name,atSeconds:marker.atSeconds,targetRegionId:regionByIndex.get(marker.index)!.id}));}
  const identity=inferArrangementIdentity(path,bpm),hash=createHash("sha256").update(text).digest("hex");
  const arrangement:ArrangementVersion={schemaVersion:1,id:`reaper-${hash.slice(0,12)}`,songId,name:reaperTitle(identity.name),sourceType:"reaper-import",sourcePath:path,sourceSha256:hash,importedAt:new Date().toISOString(),selectedKey:identity.key??original?.selectedKey??null,selectedBpm:bpm,timeSignature:{numerator,denominator},durationSeconds,regions,cueMarkers,markers,mediaItems,proPresenterMidi,slidesTrackName:slides?"Slides":null,warnings};
  const differences=[];if(original){if(original.selectedKey!==arrangement.selectedKey)differences.push({field:"selectedKey",original:original.selectedKey,arrangement:arrangement.selectedKey});if(original.selectedBpm!==bpm)differences.push({field:"selectedBpm",original:original.selectedBpm,arrangement:bpm});if(JSON.stringify(original.timeSignature)!==JSON.stringify(arrangement.timeSignature))differences.push({field:"timeSignature",original:original.timeSignature,arrangement:arrangement.timeSignature});if(JSON.stringify(original.regions.map((x)=>x.name))!==JSON.stringify(regions.map((x)=>x.name)))differences.push({field:"regionStructure",original:original.regions.map((x)=>x.name),arrangement:regions.map((x)=>x.name)});}
  return{arrangement,differences,defaultAction:"import-as-new-version"};
}

interface ParsedMarker{index:number;atSeconds:number;name:string;isRegion:boolean}
function parseMarker(parts:string[]):ParsedMarker|null{const index=Number(parts[1]),atSeconds=Number(parts[2]),flags=Number(parts[4]);if(!Number.isFinite(index)||!Number.isFinite(atSeconds))return null;return{index,atSeconds,name:parts[3]??"",isRegion:Number.isInteger(flags)&&(flags&1)===1};}
function parseRpp(text:string):Node{const root:Node={tag:"ROOT",args:[],lines:[],children:[]},stack=[root];for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line)continue;if(line===">"){if(stack.length===1)throw new Error("Unexpected RPP block close");stack.pop();continue;}if(line.startsWith("<")){const tokens=words(line.slice(1)),node:Node={tag:tokens[0]??"",args:tokens.slice(1),lines:[],children:[]};stack.at(-1)!.children.push(node);stack.push(node);continue;}stack.at(-1)!.lines.push(words(line));}if(stack.length!==1)throw new Error("Unclosed RPP block");return root;}
function decodeSlides(track:Node,bpm:number):ProPresenterMidiEvent[]{const result:ProPresenterMidiEvent[]=[];for(const item of children(track,"ITEM")){const source=item.children.find((node)=>node.tag==="SOURCE"&&node.args[0]==="MIDI");if(!source)continue;const ppq=num(value(source,"HASDATA")?.[1],960),position=num(value(item,"POSITION")?.[0],0),rate=num(value(item,"PLAYRATE")?.[0],1);let ticks=0;for(const event of source.lines.filter((line)=>line[0]?.toLowerCase()==="e")){ticks+=num(event[1],0);const status=parseInt(event[2]??"0",16),data1=parseInt(event[3]??"0",16),data2=parseInt(event[4]??"0",16),type=status&0xf0;result.push({atSeconds:position+(ticks/ppq)*(60/bpm)/rate,status,channel:(status&0x0f)+1,data1,data2,kind:type===0x90&&data2>0?"note-on":type===0x80||type===0x90?"note-off":type===0xb0?"control-change":"other"});}}return result.sort((a,b)=>a.atSeconds-b.atSeconds);}
function inferArrangementIdentity(path:string,bpm:number){const folder=basename(dirname(path)),file=basename(path).replace(/\.rpp$/i,"");const candidate=file||folder;const match=candidate.match(/(?:^|[\s_-])([A-G](?:#|b)?)(?=[\s_-]|$)/i),raw=match?.[1];return{name:candidate,key:raw?`${raw[0]!.toUpperCase()}${raw.slice(1)}`:null,bpm};}
export function reaperTitle(value:string):string{const cleaned=value.trim().replace(/^reaper\s*[·:|\-]\s*/i,"");return `REAPER · ${cleaned||"Imported Arrangement"}`;}
function num(raw:string|undefined,fallback:number){const result=Number(raw);return Number.isFinite(result)?result:fallback;}
function emptyNode():Node{return{tag:"",args:[],lines:[],children:[]};}
