import type { PreparedSong, StemMixSetting } from "../domain/song.js";
import { classifyStemOutput } from "../audio/output-layout.js";
import type { LiveMixerState } from "./performance-session.js";

export const SONG_MIX_SCHEMA_VERSION = 1;
export const SONG_MIX_BUS_KEYS = ["drums", "bass", "acoustic", "electric", "keys", "strings", "vocals", "other"] as const;
export type SongMixBusKey = typeof SONG_MIX_BUS_KEYS[number];
export interface SavedBusMix { readonly gain:number;readonly muted:boolean;readonly solo:boolean; }
export interface SavedSongMix { readonly songId:string;readonly buses:Partial<Record<SongMixBusKey,SavedBusMix>>;readonly pad?:SavedBusMix;readonly masterGain:number;readonly savedAt:string; }
export interface SongMixLibrary { readonly schemaVersion:1;readonly songs:Readonly<Record<string,SavedSongMix>>; }

export function emptySongMixLibrary():SongMixLibrary{return{schemaVersion:SONG_MIX_SCHEMA_VERSION,songs:{}};}
export function stemBus(song:PreparedSong,index:number):SongMixBusKey{const stem=song.stems[index];return classifyStemOutput(`${stem?.displayName??""} ${stem?.role??""}`) as SongMixBusKey;}
export function captureSongMix(song:PreparedSong,mixer:LiveMixerState,now=new Date().toISOString()):SavedSongMix{
  const buses:Partial<Record<SongMixBusKey,SavedBusMix>>={};
  for(const channel of mixer.channels.filter(item=>item.kind==="stem")){const bus=stemBus(song,channel.index);if(!buses[bus])buses[bus]={gain:channel.gain,muted:channel.muted,solo:channel.solo};}
  const pad=mixer.channels.find(item=>item.kind==="pad");
  return{songId:song.song.id,buses,...(pad?{pad:{gain:pad.gain,muted:pad.muted,solo:pad.solo}}:{}),masterGain:mixer.masterGain,savedAt:now};
}
export function applySavedSongMix(song:PreparedSong,saved:SavedSongMix|undefined):PreparedSong{
  if(!saved)return song;
  const stemMix:StemMixSetting[]=song.stems.map((_,index)=>{const prior=song.stemMix?.find(item=>item.index===index),bus=saved.buses[stemBus(song,index)];return{index,gain:bus?.gain??prior?.gain??1,muted:bus?.muted??prior?.muted??false,solo:bus?.solo??prior?.solo??false,iem:!(bus?.muted??prior?.muted??false)};});
  return{...song,stemMix,performanceMix:{masterGain:saved.masterGain,...(saved.pad?{pad:saved.pad}:{})}};
}
export function linearGainToGldDb(gain:number):number|"-inf"{if(gain<=0)return"-inf";return Math.max(-40,Math.min(10,20*Math.log10(gain)));}
