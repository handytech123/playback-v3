import test from "node:test";
import vm from "node:vm";
import { REMOTE_CONTROL_PAGE } from "../../dist/src/control/remote-page.js";
import assert from "node:assert/strict";
import { RemoteControlServer } from "../../dist/src/control/remote-server.js";
import { PlaybackCommandBus } from "../../dist/src/control/command-bus.js";
import { PerformanceSession } from "../../dist/src/live/performance-session.js";
import { songId } from "../../dist/src/domain/song.js";
import { createSocket } from "node:dgram";
import { encodeOscMessage } from "../../dist/src/control/osc.js";
const clientScript = REMOTE_CONTROL_PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
test('remote JavaScript parses as ES5 for Safari on iOS 9.3.5', () => {
 const exports={}; vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{exports,module:{exports}});
 assert.doesNotThrow(()=>exports.parse(clientScript,{ecmaVersion:5}));
 assert.doesNotMatch(clientScript,/\b(fetch|Promise|URLSearchParams|replaceChildren|padStart)\b(?=\s*[.(])/);
 assert.doesNotMatch(REMOTE_CONTROL_PAGE,/display:grid|color-mix\(|clamp\(/);
});

function remoteBrowser(modern=false, unauthorized=false) {
 const nodes={}, posts=[],requests=[],timers=[],listeners={},streams=[];
 class Node {
  constructor(id=''){this.id=id;this.children=[];this.listeners={};this.style={};this.className='';this.textContent='';this.scrollLeft=0;this.capture=[];this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ');},contains:name=>this.className.split(' ').includes(name)};}
  get firstChild(){return this.children[0];} get innerHTML(){return this.html===undefined?String(this.textContent).replace(/&/g,'&amp;').replace(/</g,'&lt;'):this.html;} set innerHTML(value){this.html=value;}
  appendChild(node){this.children.push(node);node.parentNode=this;return node;} removeChild(node){this.children.splice(this.children.indexOf(node),1);}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);} getAttribute(name){return name==='data-command'?this.command:null;}
  getBoundingClientRect(){return{left:0,right:400,top:0,width:400,height:240};}
  getContext(){return{setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}};}
  setPointerCapture(id){this.capture.push(id);} hasPointerCapture(id){return this.capture.includes(id);} releasePointerCapture(id){this.capture=this.capture.filter(x=>x!==id);}
 }
 const get=id=>nodes[id]??=new Node(id), commandButtons=['transport.play','transport.pause','transport.stop'].map(type=>{const node=new Node();node.command=type;return node;});
 get('setSongs').parentNode=new Node();
 const state={setName:'Sunday',songs:[{index:0,title:'Old and new iPad',key:'C',bpm:120,durationSeconds:60,regions:[{id:'v',name:'Verse',startSeconds:0,endSeconds:60}],cues:[]}],transitions:[],performance:{ready:true,songIndex:0,positionSeconds:0,playing:false,channels:{pad:false},currentRegionId:'v'}};
 const document={hidden:false,getElementById:get,querySelectorAll:()=>commandButtons,createElement:()=>new Node(),addEventListener(name,fn){(listeners[name]??=[]).push(fn);}};
 function XHR(){this.headers={};this.open=(method,path)=>{this.method=method;this.path=path;};this.setRequestHeader=(key,value)=>this.headers[key]=value;this.send=body=>{requests.push(this);this.status=unauthorized?401:200;this.readyState=4;if(this.method==='POST')posts.push(JSON.parse(body));this.responseText=JSON.stringify(unauthorized?{error:'Unauthorized'}:this.path==='/api/state'?state:this.path.indexOf('/api/waveform')===0?{buckets:[{min:-.5,max:.5}]}:{ok:true});this.onreadystatechange();};}
 const context={document,location:{search:'?token=test%20token'},XMLHttpRequest:XHR,setTimeout:fn=>timers.push(fn),setInterval:fn=>timers.push(fn),console,addEventListener(name,fn){(listeners[name]??=[]).push(fn);}};
 context.window=context;if(modern){context.PointerEvent=function(){};context.EventSource=function(){this.listeners={};this.addEventListener=(name,fn)=>this.listeners[name]=fn;this.close=()=>this.closed=true;streams.push(this);};}
 vm.runInNewContext(clientScript,context);
 return{nodes,get,posts,requests,timers,listeners,streams,context,document,state,commandButtons,fire(node,type,event={}){event.preventDefault??=()=>{};event.stopPropagation??=()=>{};event.cancelable=true;for(const fn of node.listeners[type]||[])fn(event);}};
}
test('iOS 9 fallback loads state and waveform using authenticated XHR, and preserves controls',()=>{
 const b=remoteBrowser();assert.equal(b.get('song').textContent,'Old and new iPad');assert.equal(b.get('status').textContent,'READY');assert.equal(b.requests.length,2);assert.ok(b.requests.every(x=>x.headers.Authorization==='Bearer test token'));
 b.commandButtons[0].onclick();b.get('pad').onclick();assert.deepEqual(b.posts,[{type:'transport.play'},{type:'bus.set',bus:'pad',enabled:true}]);
 const first=b.get('setSongs').firstChild;b.timers[0]();assert.equal(b.get('setSongs').firstChild,first);
 b.document.hidden=true;b.listeners.visibilitychange[0]();const count=b.requests.length;b.timers[0]();assert.equal(b.requests.length,count);b.document.hidden=false;b.listeners.visibilitychange[0]();assert.ok(b.requests.length>count);
});
test('iOS 9 touch drag seeks, while region double-tap jumps without duplicate mouse actions',()=>{
 const b=remoteBrowser(),wrap=b.get('waveWrap');b.fire(wrap,'touchstart',{target:wrap,touches:[{identifier:7,clientX:100}]});b.fire(wrap,'touchmove',{target:wrap,touches:[{identifier:7,clientX:250}]});b.fire(wrap,'touchend',{target:wrap,changedTouches:[{identifier:7,clientX:300}]});assert.equal(b.posts[0].seconds,15);assert.equal(b.posts.at(-1).seconds,45);const count=b.posts.length;b.fire(wrap,'mousedown',{button:0,target:wrap,clientX:10});assert.equal(b.posts.length,count);
 const tap=remoteBrowser(),region=tap.get('regionLayer').firstChild;region.onclick({stopPropagation(){}});region.onclick({stopPropagation(){}});assert.deepEqual(tap.posts,[{type:'section.jump',regionId:'v'}]);
});
test('modern tablets retain pointer dragging and live events, including wake reconnection',()=>{
 const b=remoteBrowser(true),wrap=b.get('waveWrap'),region=b.get('regionLayer').firstChild;assert.ok(!wrap.listeners.touchstart);b.fire(wrap,'pointerdown',{target:region,pointerId:2,clientX:100,button:0});b.fire(wrap,'pointerup',{pointerId:2,clientX:100});assert.equal(wrap.capture.length,0);assert.equal(b.posts.length,0);
 b.fire(wrap,'pointerdown',{target:wrap,pointerId:3,clientX:100,button:0});b.fire(wrap,'pointermove',{pointerId:3,clientX:200});b.fire(wrap,'pointerup',{pointerId:3,clientX:240});assert.equal(b.posts.at(-1).seconds,36);
 b.streams[0].listeners.state({data:JSON.stringify({...b.state,setName:'Live update'})});assert.equal(b.get('set').textContent,'Live update');b.document.hidden=true;b.listeners.visibilitychange[0]();assert.equal(b.streams[0].closed,true);b.document.hidden=false;b.listeners.visibilitychange[0]();assert.equal(b.streams.length,2);
});
test('unauthorized old-iPad links stop reconnecting and never send commands',()=>{
 const b=remoteBrowser(false,true);assert.equal(b.get('status').textContent,'OFFLINE');const count=b.requests.length;b.commandButtons[0].onclick();b.timers[0]();assert.equal(b.requests.length,count);assert.equal(b.posts.length,0);assert.match(b.get('hint').textContent,/not authorized/);
});
