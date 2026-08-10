import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { songId } from "../src/domain/song.js";
import { MapEditorHistory,applyMapCommand } from "../src/edit/map-editor.js";
import { loadSongMap,saveSongMap } from "../src/edit/map-persistence.js";
import { normalizeRegions,type OriginalSongMap } from "../src/edit/song-map.js";

function fixture():OriginalSongMap{return{schemaVersion:1,songId:songId("song-1"),bpm:120,timeSignature:{numerator:4,denominator:4},durationSeconds:8,reviewState:"draft",revision:0,source:{kind:"analyzer",path:"analysis/regions.json",importedAt:new Date(0).toISOString()},regions:normalizeRegions([{id:"r1",name:"Verse",startSeconds:0,endSeconds:4},{id:"r2",name:"Verse 2",startSeconds:4,endSeconds:8}]),cues:[{id:"c1",phrase:"Verse",atSeconds:3,targetRegionId:"r2",enabled:true,audioPath:"verse.wav",sourceLabel:"Verse"}]};}
test("measure-and-beat boundaries renumber types and retarget cues",()=>{let map=applyMapCommand(fixture(),{type:"set-region-boundary",rightRegionId:"r2",atPosition:{measure:3,beat:1,tick:0}});assert.equal(map.regions[0]!.endSeconds,4);assert.deepEqual(map.regions[0]!.endPosition,{measure:3,beat:1,tick:0});map=applyMapCommand(map,{type:"set-region-type",regionId:"r2",sectionType:"chorus"});assert.deepEqual(map.regions.map((region)=>region.name),["Verse","Chorus"]);map=applyMapCommand(map,{type:"retarget-cue",cueId:"c1",targetRegionId:"r1"});assert.equal(map.cues[0]!.targetRegionId,"r1");});
test("undo and redo restore complete immutable maps",()=>{const history=new MapEditorHistory(fixture());history.execute({type:"toggle-cue",cueId:"c1",enabled:false});assert.equal(history.map.cues[0]!.enabled,false);history.undo();assert.equal(history.map.cues[0]!.enabled,true);history.redo();assert.equal(history.map.cues[0]!.enabled,false);});
test("approval and atomic persistence preserve immutable revisions",async()=>{const approved=applyMapCommand(fixture(),{type:"approve-map"});assert.equal(approved.reviewState,"approved");const root=await mkdtemp(join(tmpdir(),"playback-maps-"));const saved=await saveSongMap(root,approved);assert.deepEqual(await loadSongMap(saved.currentPath),approved);assert.deepEqual(await saveSongMap(root,approved),saved);const conflicting={...approved,reviewState:"draft" as const};await assert.rejects(saveSongMap(root,conflicting),/EEXIST/);});
