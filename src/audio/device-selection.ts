import type { NativeAudioDeviceSelection } from "../live/native-engine-client.js";

export function reconcileAudioDevice(saved:NativeAudioDeviceSelection|null,available:readonly NativeAudioDeviceSelection[]):NativeAudioDeviceSelection|null{const preferred=saved?null:preferredDefaultAudioDevice(available);if(!saved)return preferred;const exact=available.find(device=>device.type===saved.type&&device.name===saved.name),fuzzy=exact??available.find(device=>normalize(device.type)===normalize(saved.type)&&normalizeDeviceName(device.name)===normalizeDeviceName(saved.name));if(!fuzzy)return preferredDefaultAudioDevice(available);const max=Math.max(2,Number(fuzzy.maxOutputChannels??fuzzy.outputChannels??2)),requested=Math.max(2,Number(saved.outputChannels??max));return{type:fuzzy.type,name:fuzzy.name,maxOutputChannels:max,outputChannels:Math.min(requested,max)};}
export function preferredDefaultAudioDevice(available:readonly NativeAudioDeviceSelection[]):NativeAudioDeviceSelection|null{const focusrite=available.find(device=>isAsio(device.type)&&/focusrite.*usb|usb.*focusrite/i.test(device.name));if(!focusrite)return null;const max=Math.max(2,Number(focusrite.maxOutputChannels??focusrite.outputChannels??2));return{type:focusrite.type,name:focusrite.name,maxOutputChannels:max,outputChannels:Math.min(6,max)};}
export function parseAudioDeviceList(stdout:string):NativeAudioDeviceSelection[]{
  const candidates:NativeAudioDeviceSelection[]=[];
  for(const line of stdout.split(/\r?\n/)){
    const[type,name,countText]=line.split("\t"),count=Number(countText);
    if(!type||!name||!Number.isInteger(count)||count<1)continue;
    candidates.push({type,name,maxOutputChannels:count});
  }
  const preferred=new Map<string,NativeAudioDeviceSelection>();
  for(const device of candidates){
    const key=isAsio(device.type)?`asio:${normalizeDeviceName(device.name)}`:`windows:${normalizeDeviceName(device.name)}`;
    const current=preferred.get(key);
    if(!current||backendRank(device.type)<backendRank(current.type))preferred.set(key,device);
  }
  return [...preferred.values()].sort((left,right)=>backendRank(left.type)-backendRank(right.type)||left.name.localeCompare(right.name));
}
function normalize(value:string){return value.trim().toLowerCase().replace(/\s+/g," ");}
function normalizeDeviceName(value:string){return normalize(value).replace(/^\d+\s*-\s*/,"");}
function isAsio(type:string){return normalize(type)==="asio";}
function backendRank(type:string){const value=normalize(type);if(value==="asio")return 0;if(value==="windows audio")return 1;if(value.includes("low latency"))return 2;if(value.includes("exclusive"))return 3;if(value==="directsound")return 4;return 5;}
