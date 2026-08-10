import assert from "node:assert/strict";
import test from "node:test";
import { deriveRegionsFromAnalyzerCues } from "../src/library/analyzer-package.js";

test("Playback trusts Analyzer measure/beat positions and treats milliseconds as non-authoritative evidence",()=>{
  const result=deriveRegionsFromAnalyzerCues([
    {id:"c1",phrase:"Verse",countPattern:"234",leadGridBeats:4,cueStart:{timeMs:3750,position:{measure:2,beat:4}}},
    {id:"c2",phrase:"Chorus",countPattern:"234",leadGridBeats:4,cueStart:{timeMs:7750,position:{measure:4,beat:4}}},
    {id:"c3",phrase:"Verse",countPattern:"234",leadGridBeats:4,cueStart:{timeMs:11750,position:{measure:6,beat:4}}},
  ],20,120,{numerator:4,denominator:4});
  assert.deepEqual(result.regions.map(region=>({name:region.name,start:region.startSeconds})),[
    {name:"Verse 1",start:5.5},
    {name:"Chorus",start:9.5},
    {name:"Verse 2",start:13.5},
  ]);
  assert.equal(result.regions.some(region=>/^start$/i.test(region.name)),false);
  assert.deepEqual(result.cues.map(cue=>cue.atSeconds),[3.5,7.5,11.5]);
  assert.deepEqual(result.cues.map(cue=>cue.position),[{measure:2,beat:4,tick:0},{measure:4,beat:4,tick:0},{measure:6,beat:4,tick:0}]);
});

test("6/8 count metadata owns its six- or seven-grid-beat region lead",()=>{
  const result=deriveRegionsFromAnalyzerCues([
    {id:"six",phrase:"Verse",countPattern:"456",leadGridBeats:6,cueStart:{timeMs:1000,position:{measure:1,beat:2}}},
    {id:"seven",phrase:"Chorus",countPattern:"23456",leadGridBeats:7,cueStart:{timeMs:9000,position:{measure:2,beat:4}}},
  ],30,60,{numerator:6,denominator:8});
  assert.deepEqual(result.regions.map(region=>region.startSeconds),[7,16]);
  assert.deepEqual(result.cues.map(cue=>cue.countPattern),["456","23456"]);
});
