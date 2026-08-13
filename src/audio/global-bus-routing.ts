import type { NativeAudioRouting } from "../live/native-engine-client.js";
import { classifyStemOutput, PLAYBACK_OUTPUTS } from "./output-layout.js";

export type GlobalBusKey = "click"|"cue"|"iem"|"acoustic"|"electric"|"bass"|"keys"|"strings"|"drums"|"vocals"|"other"|"pad";
export interface GlobalBusRoute { readonly output:number;readonly channels:1|2; }
export type GlobalBusRouting = Readonly<Record<GlobalBusKey,GlobalBusRoute>>;

const keys = PLAYBACK_OUTPUTS.map(item=>item.key) as GlobalBusKey[];

export function defaultGlobalBusRouting():GlobalBusRouting {
  return Object.fromEntries(PLAYBACK_OUTPUTS.map(item=>[item.key,{output:item.output,channels:1}])) as unknown as GlobalBusRouting;
}

export function normalizeGlobalBusRouting(value:unknown):GlobalBusRouting {
  const source=value&&typeof value==="object"?value as Record<string,any>:{};
  const defaults=defaultGlobalBusRouting();
  return Object.fromEntries(keys.map(key=>{const route=source[key],fallback=defaults[key],output=Number(route?.output),channels=route?.channels===2?2:1;return[key,{output:Number.isInteger(output)&&output>=0&&output<=32?output:fallback.output,channels}];})) as unknown as GlobalBusRouting;
}

export function deriveAudioRouting(busRouting:GlobalBusRouting,stemLabels:readonly string[]):NativeAudioRouting {
  const stemRoutes=stemLabels.map(label=>busRouting[classifyStemOutput(label) as GlobalBusKey]??busRouting.other);
  return {
    stems:stemRoutes.map(route=>route.output),stemChannels:stemRoutes.map(route=>route.channels),
    click:busRouting.click.output,clickChannels:busRouting.click.channels,
    cue:busRouting.cue.output,cueChannels:busRouting.cue.channels,
    pad:busRouting.pad.output,padChannels:busRouting.pad.channels,
    iem:busRouting.iem.output,iemChannels:busRouting.iem.channels,
  };
}

export function migrateGlobalBusRouting(saved:unknown,legacy:NativeAudioRouting|null,stemLabels:readonly string[]):GlobalBusRouting {
  if(saved&&typeof saved==="object")return normalizeGlobalBusRouting(saved);
  const next={...defaultGlobalBusRouting()} as Record<GlobalBusKey,GlobalBusRoute>;
  if(legacy)for(const key of keys.filter(key=>!["click","cue","iem","pad"].includes(key))){
    const indices=stemLabels.map((label,index)=>({key:classifyStemOutput(label),index})).filter(item=>item.key===key).map(item=>item.index);
    const outputs=indices.map(index=>legacy.stems[index]).filter(Number.isInteger),widths=indices.map(index=>legacy.stemChannels[index]).filter(Boolean);
    if(outputs.length&&outputs.every(output=>output===outputs[0])&&widths.every(width=>width===widths[0]))next[key]={output:outputs[0]!,channels:widths[0]??1};
  }
  if(legacy){next.click={output:legacy.click,channels:legacy.clickChannels};next.cue={output:legacy.cue,channels:legacy.cueChannels};next.pad={output:legacy.pad,channels:legacy.padChannels};next.iem={output:legacy.iem,channels:legacy.iemChannels};}
  return normalizeGlobalBusRouting(next);
}
