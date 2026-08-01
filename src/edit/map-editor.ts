import { buildZeroBasedGrid } from "../domain/grid.js";
import { renumberRegions, type OriginalSongMap, type SectionType } from "./song-map.js";

export type MapCommand =
  | { readonly type:"set-region-type"; readonly regionId:string; readonly sectionType:SectionType; readonly modifier?:string|null }
  | { readonly type:"set-region-boundary"; readonly rightRegionId:string; readonly atSeconds:number }
  | { readonly type:"add-region-boundary"; readonly containingRegionId:string; readonly newRegionId:string; readonly atSeconds:number; readonly sectionType:SectionType }
  | { readonly type:"remove-region"; readonly regionId:string }
  | { readonly type:"toggle-cue"; readonly cueId:string; readonly enabled:boolean }
  | { readonly type:"retarget-cue"; readonly cueId:string; readonly targetRegionId:string }
  | { readonly type:"move-cue"; readonly cueId:string; readonly atSeconds:number }
  | { readonly type:"approve-map" };

export function applyMapCommand(map:OriginalSongMap,command:MapCommand):OriginalSongMap {
  let regions=[...map.regions], cues=[...map.cues]; let reviewState:OriginalSongMap["reviewState"]="draft";
  if(command.type==="set-region-type")regions=regions.map((region)=>region.id===command.regionId?{...region,sectionType:command.sectionType,modifier:command.modifier===undefined?region.modifier:command.modifier,approved:false}:region);
  else if(command.type==="set-region-boundary"){
    const right=regions.findIndex((region)=>region.id===command.rightRegionId);if(right<=0)throw new Error("Boundary must have regions on both sides");const at=snapToGrid(map,command.atSeconds);if(at<=regions[right-1]!.startSeconds||at>=regions[right]!.endSeconds)throw new Error("Boundary would create an empty region");regions=regions.map((region,index)=>index===right-1?{...region,endSeconds:at,approved:false}:index===right?{...region,startSeconds:at,approved:false}:region);
  } else if(command.type==="add-region-boundary"){
    if(regions.some((region)=>region.id===command.newRegionId))throw new Error("New region ID already exists");const index=regions.findIndex((region)=>region.id===command.containingRegionId);if(index<0)throw new Error("Containing region not found");const current=regions[index]!,at=snapToGrid(map,command.atSeconds);if(at<=current.startSeconds||at>=current.endSeconds)throw new Error("New boundary is outside the selected region");regions.splice(index,1,{...current,endSeconds:at,approved:false},{id:command.newRegionId,name:"",sectionType:command.sectionType,occurrence:1,sourceLabel:"",modifier:null,approved:false,startSeconds:at,endSeconds:current.endSeconds});
  } else if(command.type==="remove-region"){
    if(regions.length===1)throw new Error("Original Song must retain at least one region");const index=regions.findIndex((region)=>region.id===command.regionId);if(index<0)throw new Error("Region not found");if(index>0){const removed=regions[index]!;regions.splice(index-1,2,{...regions[index-1]!,endSeconds:removed.endSeconds,approved:false});}else{const removed=regions[0]!;regions.splice(0,2,{...regions[1]!,startSeconds:removed.startSeconds,approved:false});}cues=cues.filter((cue)=>cue.targetRegionId!==command.regionId);
  } else if(command.type==="toggle-cue")cues=replaceCue(cues,command.cueId,(cue)=>({...cue,enabled:command.enabled}));
  else if(command.type==="retarget-cue"){if(!regions.some((region)=>region.id===command.targetRegionId))throw new Error("Cue target region not found");cues=replaceCue(cues,command.cueId,(cue)=>({...cue,targetRegionId:command.targetRegionId}));}
  else if(command.type==="move-cue")cues=replaceCue(cues,command.cueId,(cue)=>({...cue,atSeconds:snapToGrid(map,command.atSeconds)}));
  else if(command.type==="approve-map"){const issues=validateSongMap(map);if(issues.length)throw new Error(`Map cannot be approved: ${issues.join("; ")}`);regions=regions.map((region)=>({...region,approved:true}));reviewState="approved";}
  const result={...map,revision:map.revision+1,reviewState,regions:renumberRegions(regions),cues};const issues=validateSongMap(result);if(issues.length)throw new Error(`Invalid map edit: ${issues.join("; ")}`);return result;
}

export function validateSongMap(map:OriginalSongMap):readonly string[]{const issues:string[]=[];if(map.regions.length===0)issues.push("No regions");for(let index=0;index<map.regions.length;index+=1){const region=map.regions[index]!;if(region.startSeconds<0||region.endSeconds<=region.startSeconds||region.endSeconds>map.durationSeconds)issues.push(`Invalid region: ${region.name}`);if(index>0&&Math.abs(map.regions[index-1]!.endSeconds-region.startSeconds)>.0001)issues.push(`Gap or overlap before ${region.name}`);}const ids=new Set(map.regions.map((region)=>region.id));if(ids.size!==map.regions.length)issues.push("Duplicate region IDs");for(const cue of map.cues){if(!ids.has(cue.targetRegionId))issues.push(`Cue target missing: ${cue.id}`);if(cue.atSeconds<0||cue.atSeconds>map.durationSeconds)issues.push(`Cue time invalid: ${cue.id}`);}return issues;}

export class MapEditorHistory { private past:OriginalSongMap[]=[];private future:OriginalSongMap[]=[];constructor(private current:OriginalSongMap){}get map():OriginalSongMap{return this.current;}get canUndo():boolean{return this.past.length>0;}get canRedo():boolean{return this.future.length>0;}execute(command:MapCommand):OriginalSongMap{this.past.push(this.current);this.current=applyMapCommand(this.current,command);this.future=[];return this.current;}undo():OriginalSongMap{const previous=this.past.pop();if(!previous)throw new Error("Nothing to undo");this.future.push(this.current);this.current=previous;return this.current;}redo():OriginalSongMap{const next=this.future.pop();if(!next)throw new Error("Nothing to redo");this.past.push(this.current);this.current=next;return this.current;}}

function replaceCue(cues:OriginalSongMap["cues"],id:string,change:(cue:OriginalSongMap["cues"][number])=>OriginalSongMap["cues"][number]){let found=false;const result=cues.map((cue)=>{if(cue.id!==id)return cue;found=true;return change(cue);});if(!found)throw new Error("Cue not found");return result;}
function snapToGrid(map:OriginalSongMap,time:number):number{if(!Number.isFinite(time))throw new Error("Edit time must be finite");const grid=buildZeroBasedGrid(map.bpm,map.timeSignature,map.durationSeconds);return grid.reduce((best,position)=>Math.abs(position.timeSeconds-time)<Math.abs(best-time)?position.timeSeconds:best,grid[0]!.timeSeconds);}

