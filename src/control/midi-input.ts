import type { NativeMidiInputEvent } from "../live/native-engine-client.js";
import { PlaybackCommandBus, type PlaybackCommand } from "./command-bus.js";

export type FootControllerProfileId="disabled"|"basic-notes";
export interface MidiInputBinding {readonly channel:number;readonly kind:"note"|"cc";readonly number:number;readonly action:"play-toggle"|"stop"|"panic"|"previous"|"next"|"loop-current"|"cue-next";}
export const FOOT_CONTROLLER_PROFILES:Readonly<Record<FootControllerProfileId,readonly MidiInputBinding[]>>={disabled:[],"basic-notes":[{channel:1,kind:"note",number:20,action:"play-toggle"},{channel:1,kind:"note",number:21,action:"stop"},{channel:1,kind:"note",number:22,action:"panic"},{channel:1,kind:"note",number:23,action:"previous"},{channel:1,kind:"note",number:24,action:"next"},{channel:1,kind:"note",number:25,action:"loop-current"},{channel:1,kind:"note",number:26,action:"cue-next"}]};

export class MidiInputRouter{
  private readonly last=new Map<string,number>();
  constructor(private readonly bus:PlaybackCommandBus,private readonly bindings:readonly MidiInputBinding[],private readonly debounceMs=120){}
  async handle(event:NativeMidiInputEvent,at=Date.now()){const kind=event.status&0xf0,channel=(event.status&0x0f)+1,isNote=kind===0x90&&event.data2>0,isCc=kind===0xb0;if(!isNote&&!isCc)return null;const binding=this.bindings.find(item=>item.channel===channel&&item.kind===(isNote?"note":"cc")&&item.number===event.data1);if(!binding)return null;const key=`${channel}:${binding.kind}:${binding.number}`,previous=this.last.get(key)??-Infinity;if(at-previous<this.debounceMs)return null;this.last.set(key,at);const command=this.command(binding);return this.bus.dispatch(command,"midi");}
  private command(binding:MidiInputBinding):PlaybackCommand{if(binding.action==="play-toggle")return{type:"transport.toggle"};if(binding.action==="stop")return{type:"transport.stop"};if(binding.action==="panic")return{type:"panic.enter"};if(binding.action==="previous")return{type:"section.previous"};if(binding.action==="next")return{type:"section.next"};if(binding.action==="cue-next")return{type:"song.cue-next"};const regionId=this.bus.state().performance.currentRegionId;if(!regionId)throw new Error("No current region is available for the foot controller");return{type:"section.loop",regionId};}
}
