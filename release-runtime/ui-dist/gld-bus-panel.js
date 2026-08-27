const expected={drums:10,bass:12,acoustic:14,electric:16,keys:36,strings:37,vocals:39,other:41,pad:33};
const labels={drums:'Drums',bass:'Bass',acoustic:'Acoustic',electric:'Electric',keys:'Keys',strings:'Orchestra',vocals:'Vocals',other:'Other',pad:'Dynamic Pad'};
const api=window.playback.gldBus;
if(api){
 const timer=setInterval(()=>{const toolbar=document.querySelector('.editor-setlist-toolbar'),header=document.querySelector('#performanceMixer header');if(!toolbar||!header)return;clearInterval(timer);mount(toolbar,header);},200);
}
function mount(toolbar,header){
 const save=document.createElement('button');save.textContent='SAVE ALL SONG MIXES';save.title='Save the Editor mixes for every confirmed song. Entering Performance does this automatically.';toolbar.append(save);
 const setup=document.createElement('button');setup.textContent='GLD RETURNS';header.append(setup);
 const status=document.createElement('small');status.style.cssText='display:block;padding:6px 12px;color:#8ed8c0';header.after(status);
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:850px;width:85vw;max-height:88vh;overflow:auto;background:#151c24;color:#eef4fa;border:1px solid #426076;border-radius:12px;padding:22px';
 dialog.innerHTML=`<h2>GLD Playback returns · Bank 1 / D</h2><p>Only mapped Playback return faders, mutes, and bus colors are recalled. GLD levels run from -inf to +10 dB. The eight music buses use all eight GLD color choices, including Off/dark for Other. Playback uses the same palette. Click, IEM, DCA, Main LR and all other channels stay untouched.</p>
 <p style="color:#ffd18a">GLD-only mode removes the mapped bus gain from Playback audio. IEM sends remain pre-fader. Stop playback before setup. Surface Mixer ON arms recall and console-fader feedback automatically; OFF holds console levels. Neither switching nor a MIDI send failure stops playback. Shared GLD returns change at the start of a song transition, including overlaps.</p>
 <div style="display:flex;gap:12px;flex-wrap:wrap"><label>Connection <select id="gbTransport"><option value="midi">MIDI cable</option><option value="tcp">Network TCP</option></select></label><label>MIDI input/output <select id="gbMidi"></select></label><label>MIDI channel <input id="gbChannel" type="number" min="1" max="16" style="width:60px"></label><label>GLD IP <input id="gbHost" style="width:140px"></label><label>TCP port <input id="gbPort" type="number" value="51325" style="width:80px"></label></div>
 <p><label><input id="gbExclusive" type="checkbox"> GLD-only audio levels (Surface Mixer controls MIDI ON/OFF)</label></p><p>With GLD-only levels enabled, the console keeps control of these audio returns even when Surface Mixer is OFF. With this disabled, Playback controls levels and sends no mix recalls. The console is left unchanged: review its faders before using local-only levels.</p><h3>Enable returns to recall</h3><div id="gbMap" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
 <p><button id="gbSaveConfig">SAVE CONNECTION + MAPPING</button> <button id="gbConnect">TEST CONNECTION · NO DATA</button> <button id="gbPreview">PREVIEW CURRENT MIX · NO SEND</button></p>
 <h3>Controlled physical test</h3><p>Set one mapped fader to the specified level. Its mute is not changed. No automatic restoration.</p>
 <label>Return <select id="gbTestReturn"></select></label> <label>Test dB <input id="gbTestDb" type="number" min="-40" max="10" step="1" value="-20" style="width:75px"></label>
 <button id="gbTest">SEND ONE FADER TEST</button> <button id="gbConfirm" disabled>CONFIRM CORRECT FADER</button>
 <p>Surface Mixer ON/OFF at the top of Playback controls recall. <button id="gbClose">CLOSE</button></p><p id="gbStatus" role="status"></p><pre id="gbDetails" style="white-space:pre-wrap;max-height:200px;overflow:auto"></pre>`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);let pending=null;
 for(const [id,input]of Object.entries(expected)){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.bus=id;label.append(check,` ${labels[id]} → input ${input}`);$('gbMap').append(label);const option=new Option(`${labels[id]} · input ${input}`,input);$('gbTestReturn').add(option);}
 $('gbTestReturn').value='33';
 function render(state){const feedback=state.feedback?.enabled?` · TWO-WAY MIDI: ${state.feedback.midiInputName}`:' · MIDI FEEDBACK OFF';status.textContent=state.status+feedback;$('gbStatus').textContent=(state.surfaceEnabled?'SURFACE MIXER ON · ':'SURFACE MIXER OFF · ')+state.status+feedback;}
 async function run(fn){try{const result=await fn();if(result?.status)render(result);return result;}catch(error){status.textContent=error.message;$('gbStatus').textContent=error.message;return null;}}
 async function load(){const state=await api.get();render(state);const c=state.config;$('gbExclusive').checked=c.exclusiveEnabled!==false;$('gbTransport').value=c.transport;$('gbChannel').value=c.midiChannel;$('gbHost').value=c.host;$('gbPort').value=c.port;
  $('gbMidi').replaceChildren(...(state.midiOutputs??[]).map(name=>new Option(name,name)));if(c.midiOutputName&&!Array.from($('gbMidi').options).some(o=>o.value===c.midiOutputName))$('gbMidi').add(new Option(c.midiOutputName+' (unavailable)',c.midiOutputName));$('gbMidi').value=c.midiOutputName;
  for(const check of dialog.querySelectorAll('[data-bus]'))check.checked=c.mapping[check.dataset.bus]===expected[check.dataset.bus];
 }
 setup.onclick=()=>run(async()=>{await load();dialog.showModal();});$('gbClose').onclick=()=>dialog.close();
 async function saveAllMixes(){save.disabled=true;try{const result=await api.saveAll();if(result)save.textContent=`SAVED ${result.savedCount} SONG MIX${result.savedCount===1?'':'ES'}`;return result;}finally{save.disabled=false;setTimeout(()=>save.textContent='SAVE ALL SONG MIXES',1800);}}
 save.onclick=()=>run(saveAllMixes);
 let wasPerformance=document.body.classList.contains('performance-mode'),autoSaving=false;
 const autoSaveOnPerformance=()=>{const isPerformance=document.body.classList.contains('performance-mode');if(isPerformance&&!wasPerformance&&!autoSaving){autoSaving=true;void run(saveAllMixes).finally(()=>{autoSaving=false;});}wasPerformance=isPerformance;};
 new MutationObserver(autoSaveOnPerformance).observe(document.body,{attributes:true,attributeFilter:['class']});
 $('gbSaveConfig').onclick=()=>run(async()=>{pending=null;$('gbConfirm').disabled=true;const mapping={};for(const c of dialog.querySelectorAll('[data-bus]:checked'))mapping[c.dataset.bus]=expected[c.dataset.bus];return api.configure({exclusiveEnabled:$('gbExclusive').checked,transport:$('gbTransport').value,midiOutputName:$('gbMidi').value,midiChannel:Number($('gbChannel').value),host:$('gbHost').value,port:Number($('gbPort').value),mapping});});
 $('gbConnect').onclick=()=>run(()=>api.connectionTest());
 $('gbPreview').onclick=()=>run(async()=>{$('gbDetails').textContent=JSON.stringify(await api.preview(),null,2);});
 $('gbTest').onclick=()=>run(async()=>{const mix=Number($('gbTestReturn').value),db=Number($('gbTestDb').value);if(!Number.isFinite(db))throw Error('Enter a test level');if(!confirm(`Send GLD input ${mix} to ${db} dB now? Only this fader will change.`))return;const response=await api.test({mix,db,confirmation:`TEST RETURN ${mix}`});pending=response.test.id;$('gbConfirm').disabled=false;return response;});
 $('gbConfirm').onclick=()=>run(async()=>{if(!pending||!confirm('Did the intended physical Playback return fader reach the requested level?'))return;const result=await api.confirm(pending);pending=null;$('gbConfirm').disabled=true;return result;});
 api.onState(render);void run(load);
}
