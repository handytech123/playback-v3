import assert from "node:assert/strict";
import test from "node:test";
import { mapAnalyzerTimelinePackage } from "../src/library/analyzer-package.js";

test("Playback preserves Analyzer package regions when they are present",()=>{
  const result=mapAnalyzerTimelinePackage({
    schema:"playback-analyzer-package/v1",
    schemaVersion:1,
    generatedAt:"2026-08-10T00:00:00.000Z",
    review:{status:"ready"},
    master:{catalogId:"song-1",title:"Test Song"},
    timeline:{durationMs:20000},
    audioFiles:[],
    regions:[
      {id:"r1",name:"Intro",start:{position:{measure:1,beat:1,tick:0}},end:{position:{measure:5,beat:1,tick:0}}},
      {id:"r2",name:"Verse",start:{position:{measure:5,beat:1,tick:0}},end:{position:{measure:9,beat:1,tick:0}}},
    ],
    cues:[{id:"c1",phrase:"Verse",cueStart:{position:{measure:4,beat:1,tick:0}},targetRegionId:"r2"}],
  },20,120,{numerator:4,denominator:4});
  assert.ok(result);
  assert.deepEqual(result.regions.map(region=>({id:region.id,name:region.name,start:region.startPosition,end:region.endPosition})),[
    {id:"r1",name:"Intro",start:{measure:1,beat:1,tick:0},end:{measure:5,beat:1,tick:0}},
    {id:"r2",name:"Verse",start:{measure:5,beat:1,tick:0},end:{measure:9,beat:1,tick:0}},
  ]);
  assert.deepEqual(result.cues,[{phrase:"Verse",position:{measure:4,beat:1,tick:0},atSeconds:6,targetRegionId:"r2"}]);
});

test("Playback links Analyzer cue-derived regions back to their source cues",()=>{
  const result=mapAnalyzerTimelinePackage({
    schema:"playback-analyzer-package/v1",
    schemaVersion:1,
    generatedAt:"2026-08-10T00:00:00.000Z",
    review:{status:"ready"},
    master:{catalogId:"song-1",title:"Test Song"},
    timeline:{durationMs:20000},
    audioFiles:[],
    regions:[
      {id:"region-1",name:"Intro",sourceCueId:"cue-1",start:{position:{measure:2,beat:1,tick:0}},end:{position:{measure:10,beat:1,tick:0}}},
      {id:"region-2",name:"Instrumental",sourceCueId:"cue-2",start:{position:{measure:10,beat:1,tick:0}},end:{position:{measure:18,beat:1,tick:0}}},
    ],
    cues:[
      {id:"cue-1",phrase:"Intro",countPattern:"234",leadGridBeats:4,cueStart:{position:{measure:1,beat:4,tick:0}}},
      {id:"cue-2",phrase:"Instrumental",countPattern:"34",leadGridBeats:4,cueStart:{position:{measure:9,beat:4,tick:0}}},
    ],
  },20,120,{numerator:4,denominator:4});

  assert.ok(result);
  assert.deepEqual(result.cues.map(cue=>({phrase:cue.phrase,targetRegionId:cue.targetRegionId})),[
    {phrase:"Intro",targetRegionId:"region-1"},
    {phrase:"Instrumental",targetRegionId:"region-2"},
  ]);
});

test("Playback derives regions from Analyzer cue facts when regions are omitted",()=>{
  const result=mapAnalyzerTimelinePackage({
    schema:"playback-analyzer-package/v1",
    schemaVersion:1,
    generatedAt:"2026-08-10T00:00:00.000Z",
    review:{status:"ready"},
    master:{catalogId:"song-2",title:"Cue Fact Song"},
    timeline:{durationMs:20000},
    audioFiles:[],
    regions:[],
    cues:[
      {id:"c1",phrase:"Verse",countPattern:"234",leadGridBeats:4,cueStart:{timeMs:2000,position:{measure:2,beat:1,tick:0}}},
      {id:"c2",phrase:"Chorus",countPattern:"234",leadGridBeats:4,cueStart:{timeMs:10000,position:{measure:6,beat:1,tick:0}}},
    ],
  },20,120,{numerator:4,denominator:4});

  assert.ok(result);
  assert.deepEqual(result.regions.map(region=>({id:region.id,name:region.name,start:region.startPosition,end:region.endPosition})),[
    {id:"derived-region-001",name:"Verse",start:{measure:3,beat:1,tick:0},end:{measure:7,beat:1,tick:0}},
    {id:"derived-region-002",name:"Chorus",start:{measure:7,beat:1,tick:0},end:{measure:11,beat:1,tick:0}},
  ]);
  assert.deepEqual(result.cues,[
    {phrase:"Verse",position:{measure:2,beat:1,tick:0},atSeconds:2,targetRegionId:"derived-region-001"},
    {phrase:"Chorus",position:{measure:6,beat:1,tick:0},atSeconds:10,targetRegionId:"derived-region-002"},
  ]);
});
