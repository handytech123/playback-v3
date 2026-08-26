import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseAudioDeviceList, reconcileAudioDevice } from "../../dist/src/audio/device-selection.js";
test("Dante keeps its 32-output choices and matrix even when the driver open fails", async () => {
 const bundle=await readFile(new URL('../../ui-dist/assets/index-DjlP38JI.js',import.meta.url),'utf8');
 const helperStart=bundle.indexOf('n=l=>{',bundle.indexOf('const t=o("#audioOutputCount")'));
 const helperEnd=bundle.indexOf(';n(w.audio.selectedDevice)',helperStart);
 const handlersStart=bundle.indexOf('e.onchange=async()=>',helperEnd);
 const handlersEnd=bundle.indexOf(';const i=()=>',handlersStart);
 const e={value:JSON.stringify({type:'ASIO',name:'Dante Virtual Soundcard (x64)',maxOutputChannels:32})};
 const t={options:[],value:'2',replaceChildren(){this.options=[];},add(option){this.options.push(option);if(option.selected)this.value=option.value;}};
 const w={audio:{selectedDevice:{name:'Realtek ASIO',outputChannels:2},outputChannels:2}}, a={},matrices=[],errors=[];
 const Option=function(label,value,defaultSelected,selected){Object.assign(this,{label,value,selected});};
 const n=new Function('w','t','Option',`return ${bundle.slice(helperStart+2,helperEnd)}`)(w,t,Option);
 const window={playback:{audio:{setDevice:async()=>{throw Error('driver unavailable');}}}};
 new Function('e','t','a','w','n','d','i','st','window','D',bundle.slice(handlersStart,handlersEnd))(e,t,a,w,n,()=>{},()=>matrices.push(w.audio.selectedDevice.outputChannels),()=>{},window,error=>errors.push(error.message));
 await e.onchange();
 assert.equal(t.value,'32');assert.deepEqual(t.options.map(option=>Number(option.value)),[2,4,6,8,16,32]);
 assert.equal(w.audio.selectedDevice.outputChannels,32);assert.deepEqual(matrices,[32]);assert.equal(a.textContent,'AUDIO FAULT');assert.deepEqual(errors,['driver unavailable']);
 t.value='16';await t.onchange();assert.equal(w.audio.selectedDevice.outputChannels,16);assert.equal(t.disabled,false);
});

test("A successful device reopen clears a previous engine fault, but a failed reopen does not", async () => {
 const main=await readFile(new URL('../../dist/src/desktop/main.js',import.meta.url),'utf8');
 const start=main.indexOf('async (_event, device) =>',main.indexOf('ipcMain.handle("audio:set-device"'));
 const end=main.indexOf('\n    });',start);
 for(const fails of [false,true]) {
  const calls=[],dante={type:'ASIO',name:'Dante Virtual Soundcard (x64)',maxOutputChannels:32,outputChannels:32};
  const performance={snapshot:{songIndex:0,fault:'old device error'},setReadiness(){calls.push('readiness');},clearFault(){this.snapshot.fault=null;calls.push('clear');}};
  const context={refreshAudioDeviceCache:async()=>[dante],selectedAudioDevice:null,saveDeviceSettings:async()=>{},canArmCurrentSong:()=>true,currentReady:null,armNativeSong:async()=>{if(fails)throw Error('open failed');return{routingReady:true,outputChannels:32};},applyPreparedSongMixer:async()=>{},manifest:{songs:[{}]},performance,nativeArmError:'old device error',readinessFor:async()=>({ready:true}),sendToRenderer:()=>{},activeAudioRouting:()=>({stems:[5]})};
  const handler=vm.runInNewContext(`(${main.slice(start,end)}})`,context);
  if(fails){await assert.rejects(()=>handler(null,dante),/open failed/);assert.deepEqual(calls,[]);assert.equal(performance.snapshot.fault,'old device error');}
  else{const result=await handler(null,dante);assert.equal(result.outputChannels,32);assert.deepEqual(calls,['readiness','clear']);assert.equal(performance.snapshot.fault,null);}
 }
});
