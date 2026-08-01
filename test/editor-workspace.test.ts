import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArrangementDraft, applyArrangementCommand } from "../src/edit/arrangement-editor.js";
import { arrangementDraftPath, loadArrangementDraft, saveArrangementDraft } from "../src/edit/arrangement-draft-persistence.js";
import { bucketsFromPcm16, combineWaveforms, editorStemDisplayLabels, projectBuckets } from "../src/edit/editor-workspace.js";
import { songId, type PreparedSong } from "../src/domain/song.js";

const song:PreparedSong={song:{id:songId("workspace"),title:"Workspace",artist:"A",vendor:"V",originalKey:"C",originalBpm:120,originalTimeSignature:{numerator:4,denominator:4}},selectedKey:"C",selectedBpm:120,timeSignature:{numerator:4,denominator:4},durationSeconds:4,stems:[{role:"music",sourcePath:"cached.wav",durationSeconds:4}],regions:[{id:"a",name:"A",startSeconds:0,endSeconds:2},{id:"b",name:"B",startSeconds:2,endSeconds:4}],cues:[],cacheFingerprint:"cache"};

test("builds normalized peaks and combines stacked stem shapes",()=>{const bytes=Buffer.alloc(8);[-32768,-1000,1000,32767].forEach((value,index)=>bytes.writeInt16LE(value,index*2));const buckets=bucketsFromPcm16(bytes,2);assert.deepEqual(buckets.map(bucket=>[Number(bucket.min.toFixed(3)),Number(bucket.max.toFixed(3))]),[[-1,-0.031],[0.031,1]]);assert.deepEqual(combineWaveforms([buckets,[{min:-.5,max:.25},{min:-.2,max:.4}]],2),[{min:-1,max:.25},{min:-.2,max:32767/32768}]);});

test("projects source waveform buckets through reordered arrangement sections",()=>{let draft=createArrangementDraft(song);draft=applyArrangementCommand(draft,{type:"move-section",sectionId:"b",toIndex:0});const source=[{min:0,max:.1},{min:0,max:.2},{min:0,max:.7},{min:0,max:.8}];const projected=projectBuckets(source,4,draft);assert.deepEqual(projected.map(bucket=>bucket.max),[.7,.8,.1,.2]);});

test("atomically saves and reloads a valid arrangement draft",async()=>{const root=await mkdtemp(join(tmpdir(),"playback-editor-"));try{const draft=applyArrangementCommand(createArrangementDraft(song),{type:"rename-section",sectionId:"a",name:"Verse 1"}),path=arrangementDraftPath(root,"workspace","original");await saveArrangementDraft(path,draft);assert.deepEqual(await loadArrangementDraft(path,"workspace"),draft);assert.equal(await loadArrangementDraft(path,"different"),null);}finally{await rm(root,{recursive:true,force:true});}});
test("derives meaningful editor labels from original filenames without changing routing roles",()=>{const original={...song,stems:[{role:"music-stem",sourcePath:"C:\\cache\\ACOUSTIC.wav",durationSeconds:4},{role:"music-stem",sourcePath:"C:\\cache\\ELECTRIC_1.wav",durationSeconds:4}]},rendered={...song,stems:[{role:"music-stem",sourcePath:"01-music-stem.wav",durationSeconds:4},{role:"music-stem",sourcePath:"02-music-stem.wav",durationSeconds:4}]};assert.deepEqual(editorStemDisplayLabels(rendered,original),["Acoustic","Electric 1"]);assert.deepEqual(editorStemDisplayLabels({...song,stems:[{role:"Elcrectic 2",sourcePath:"x.wav",durationSeconds:4},{role:"Sopranno",sourcePath:"y.wav",durationSeconds:4}]}),["Electric 2","Soprano"]);});
