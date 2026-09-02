const expected={drums:10,bass:12,acoustic:14,electric:16,keys:36,strings:37,vocals:39,other:41,pad:33};
const labels={drums:'Drums',bass:'Bass',acoustic:'Acoustic',electric:'Electric',keys:'Keys',strings:'Orchestra',vocals:'Vocals',other:'Other',pad:'Dynamic Pad'};
const api=window.playback.gldBus;
if(api){
 const timer=setInterval(()=>{const toolbar=document.querySelector('.editor-setlist-toolbar'),header=document.querySelector('#performanceMixer header');if(!toolbar||!header)return;clearInterval(timer);mount(toolbar,header);},200);
}
function setupEditorSongMixSave(){
 const install=()=>{
  const heading=document.querySelector('.summary-stem-mixer-heading');if(!heading||heading.querySelector('#saveEditorSongMix'))return;
  const button=document.createElement('button');button.id='saveEditorSongMix';button.type='button';button.textContent='SAVE SONG MIX';button.title='Save these stem faders, mutes, and solos to this Editor set card.';
  button.onclick=async()=>{button.disabled=true;try{const workspace=await window.playback.arrange.workspace();for(const channel of workspace.mixer?.channels??[])await window.playback.editor.mixerChannel(channel);button.textContent='SONG MIX SAVED';}catch(error){button.textContent=error.message||'SAVE FAILED';}finally{button.disabled=false;setTimeout(()=>button.textContent='SAVE SONG MIX',1800);}};
  const collapse=heading.querySelector('#summaryMixerCollapse');heading.insertBefore(button,collapse);
 };
 install();new MutationObserver(install).observe(document.querySelector('#editorWorkspace')??document.body,{childList:true,subtree:true});
}
function setupPerformanceMixerViews(header,busView,stemView){
 const container=document.querySelector('#mixerChannels'),commandTimers=new Map();let view='bus',latest=null,payload=null,busNodes=[],songLoad=0,stemSignature='';
 const active=(button,value)=>button.classList.toggle('active',value);
 const labelFor=channel=>channel.kind==='stem'?(payload?.stemLabels?.[channel.index]??payload?.song?.stems?.[channel.index]?.displayName??payload?.song?.stems?.[channel.index]?.role??`Stem ${channel.index+1}`):channel.kind==='pad'?'Dynamic Pad':channel.kind==='click'?'Dynamic Click':'Dynamic Cue';
 const accentFor=channel=>{if(channel.kind==='pad')return'#8C0099';if(channel.kind==='click')return'#f0c75e';if(channel.kind==='cue')return'#ff78b3';const value=`${labelFor(channel)} ${payload?.song?.stems?.[channel.index]?.role??''}`.toLowerCase();if(/drum|kick|snare|tom|cymbal|loop|perc/.test(value))return'#FF0000';if(/bass/.test(value))return'#00FF00';if(/acoustic|acous/.test(value))return'#0066FF';if(/electric|guitar/.test(value))return'#8C0099';if(/key|piano|organ|synth/.test(value))return'#0000FF';if(/string|violin|cello/.test(value))return'#FFFF00';if(/vocal|bgv|choir/.test(value))return'#FFFFFF';return'#6f7b82';};
 const render=()=>{
  if(view!=='stems'||!latest||!payload)return;
  const channels=latest.mixer?.channels??[],signature=`${payload.index}|${channels.map(channel=>`${channel.index}:${channel.kind}:${labelFor(channel)}`).join('|')}`;
  if(signature!==stemSignature){
   stemSignature=signature;container.replaceChildren();
   for(const channel of channels){const label=labelFor(channel),locked=channel.kind==='click'||channel.kind==='cue',strip=document.createElement('article');strip.className=`daw-channel ${channel.kind}`;strip.dataset.mixerIndex=String(channel.index);strip.style.setProperty('--channel-accent',accentFor(channel));strip.innerHTML=`<div class="channel-head"><strong title="${escapeText(label)}">${escapeText(label)}</strong><b data-stem-meter-readout="${channel.index}">−∞</b></div><div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-stem-meter="${channel.index}"></i></div><div class="console-controls"><div class="channel-switches"><button data-mixer-switch="muted" title="Mute ${escapeText(label)}">M</button><button data-mixer-switch="solo" title="Solo ${escapeText(label)}">S</button><button data-mixer-switch="iem" title="Send ${escapeText(label)} to PB_IEM">IEM</button></div><div class="gld-fader-wrap"><span class="gld-fader-scale" aria-hidden="true"></span><input class="channel-fader" data-mixer-fader="${channel.index}" type="range" min="0" max="1.25" step="0.01" value="${channel.gain}" aria-label="${escapeText(label)} fader"></div></div></div><output data-mixer-output="${channel.index}">${Math.round(channel.gain*100)}%</output><div class="channel-name" title="${escapeText(label)}">${escapeText(label)}</div>`;container.append(strip);
    strip.classList.toggle('level-locked',locked);const fader=strip.querySelector('[data-mixer-fader]');fader.disabled=locked;fader.title=locked?`${label} level is locked in Performance mode`:`${label} level`;
    for(const button of strip.querySelectorAll('[data-mixer-switch]')){button.disabled=locked;button.onclick=()=>{const current=latest?.mixer?.channels?.[channel.index];if(!current)return;const key=button.dataset.mixerSwitch;sendChannel(channel.index,{[key]:!current[key]});};}
    if(!locked)fader.oninput=()=>{const gain=Number(fader.value);strip.querySelector('output').value=`${Math.round(gain*100)}%`;clearTimeout(commandTimers.get(channel.index));commandTimers.set(channel.index,setTimeout(()=>sendChannel(channel.index,{gain}),30));};
   }
  }
  for(const channel of channels){const strip=container.querySelector(`[data-mixer-index="${channel.index}"]`);if(!strip)continue;strip.classList.toggle('muted',channel.muted);for(const button of strip.querySelectorAll('[data-mixer-switch]'))button.classList.toggle('active',!!channel[button.dataset.mixerSwitch]);const fader=strip.querySelector('[data-mixer-fader]'),output=strip.querySelector('output');if(fader&&output&&document.activeElement!==fader){fader.value=String(channel.gain);output.value=`${Math.round(channel.gain*100)}%`;}}
 };
 const sendChannel=async(index,patch)=>{const channel=latest?.mixer?.channels?.[index];if(!channel)return;try{latest=await window.playback.performance.command({action:'stem-mixer-channel',index,gain:patch.gain??channel.gain,muted:patch.muted??channel.muted,solo:patch.solo??channel.solo,iem:patch.iem??channel.iem});render();}catch(error){console.error('Stem mixer update failed',error);}};
 const loadSong=async state=>{const serial=++songLoad;try{const next=await window.playback.set.getSong(state.songIndex);if(serial!==songLoad)return;payload=next;if(view==='stems'&&container.querySelector('[data-mixer-group]'))busNodes=[...container.childNodes];render();}catch(error){console.error('Stem mixer song load failed',error);}};
 busView.onclick=()=>{if(view==='bus')return;view='bus';stemSignature='';active(busView,true);active(stemView,false);container.replaceChildren(...busNodes);header.querySelector('span').textContent='LIVE BUS MIXER';};
 stemView.onclick=()=>{if(view==='stems')return;busNodes=[...container.childNodes];stemSignature='';view='stems';active(busView,false);active(stemView,true);header.querySelector('span').textContent='LIVE STEM MIXER · BUS ROUTING ACTIVE';if(latest)void loadSong(latest);};
 window.playback.performance.onState(state=>{const changed=!latest||latest.songIndex!==state.songIndex;latest=state;if(view==='stems'){if(changed||!payload||payload.index!==state.songIndex)void loadSong(state);else render();}});
 window.playback.performance.onMeters(meters=>{if(view!=='stems')return;for(const [index,value]of (meters.channels??[]).entries()){const fill=container.querySelector(`[data-stem-meter="${index}"]`),readout=container.querySelector(`[data-stem-meter-readout="${index}"]`);if(!fill||!readout)continue;const db=value>0?20*Math.log10(value):-Infinity,percent=Number.isFinite(db)?Math.max(0,Math.min(100,(db+60)/66*100)):0;fill.style.height=`${percent}%`;fill.classList.toggle('hot',db>=-6);readout.textContent=Number.isFinite(db)?`${Math.max(-60,db).toFixed(0)}`:'−∞';}});
 void window.playback.performance.get().then(state=>{latest=state;}).catch(()=>{});
}
function escapeText(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function mount(toolbar,header){
 const save=document.createElement('button');save.textContent='SAVE ALL SONG MIXES';save.title='Save the Editor mixes for every confirmed song. Entering Performance does this automatically.';toolbar.append(save);
 const saveCurrent=document.createElement('button');saveCurrent.textContent='SAVE CURRENT MIX';saveCurrent.title='Save the active Performance song mix for recall.';header.append(saveCurrent);
 const mixerView=document.createElement('span');mixerView.className='performance-mixer-view';mixerView.style.cssText='display:inline-flex;gap:3px;padding:2px;border:1px solid #385263;border-radius:5px;background:#0b1217';
 const busView=document.createElement('button'),stemView=document.createElement('button');busView.textContent='BUS MIXER';stemView.textContent='STEM MIXER';busView.classList.add('active');mixerView.append(busView,stemView);header.append(mixerView);
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
 saveCurrent.onclick=()=>run(async()=>{saveCurrent.disabled=true;try{const result=await api.save();saveCurrent.textContent='CURRENT MIX SAVED';return result;}finally{saveCurrent.disabled=false;setTimeout(()=>saveCurrent.textContent='SAVE CURRENT MIX',1800);}});
 setupPerformanceMixerViews(header,busView,stemView);
 setupEditorSongMixSave();
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
