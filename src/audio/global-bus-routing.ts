import type { NativeAudioRouting,NativeStemBus } from "../live/native-engine-client.js";
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
  const stemBuses=stemLabels.map(label=>classifyStemOutput(label) as NativeStemBus),stemRoutes=stemBuses.map(bus=>busRouting[bus]??busRouting.other);
  return {
    stems:stemRoutes.map(route=>route.output),stemChannels:stemRoutes.map(route=>route.channels),
    stemBuses,busRoutes:(["drums","bass","acoustic","electric","keys","strings","vocals","other","pad"] as NativeStemBus[]).map(bus=>({bus,...busRouting[bus]})),
    click:busRouting.click.output,clickChannels:busRouting.click.channels,
    cue:busRouting.cue.output,cueChannels:busRouting.cue.channels,
    pad:busRouting.pad.output,padChannels:busRouting.pad.channels,
    iem:busRouting.iem.output,iemChannels:busRouting.iem.channels,
  };
}

export function migrateGlobalBusRouting(saved:unknown,_legacy:NativeAudioRouting|null,_stemLabels:readonly string[]):GlobalBusRouting {
  if(saved&&typeof saved==="object")return normalizeGlobalBusRouting(saved);
  return defaultGlobalBusRouting();
}
