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
