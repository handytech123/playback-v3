import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANALYZER_SONG_MAP_VERSION, correctedReviewCueAt, normalizeReviewKey, reviewRegions, selectedSongClickTemplate } from "../src/library/review-manifest.js";

test("analyzer song-map format has an explicit invalidation version",()=>{
  assert.equal(ANALYZER_SONG_MAP_VERSION,8);
});

test("song metadata selects the live click template",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"click-metadata-"));
  await writeFile(join(folder,"song-metadata.json"),JSON.stringify({gridAnalysis:{clickPatternClassification:{status:"matched",selected:{id:"4-4-eighth"}}}}));
  assert.equal(await selectedSongClickTemplate(folder,{numerator:4,denominator:4}),"4-4-eighth");
});

test("missing click metadata uses the meter default but invalid selections are rejected",async()=>{
  const missing=await mkdtemp(join(tmpdir(),"click-default-"));
  assert.equal(await selectedSongClickTemplate(missing,{numerator:6,denominator:8}),"6-8-two-feel");
  const invalid=await mkdtemp(join(tmpdir(),"click-invalid-"));
  await writeFile(join(invalid,"song-metadata.json"),JSON.stringify({gridAnalysis:{clickPatternClassification:{status:"matched",selected:{id:"4-4-eighth"}}}}));
  await assert.rejects(()=>selectedSongClickTemplate(invalid,{numerator:6,denominator:8}),/does not match 6\/8/);
});

test("review preparation preserves minor keys instead of truncating them to major",()=>{
  assert.equal(normalizeReviewKey("E minor"),"Em");
  assert.equal(normalizeReviewKey("F#m"),"F#m");
  assert.equal(normalizeReviewKey("G major"),"G");
});

test("6/8 review maps repair analyzer homophones, number repeats, and use a six-beat measure",()=>{
  const regions=reviewRegions([
    {id:"v1",name:"verse to",cueAtSeconds:1.25},
    {id:"c1",name:"chorus to",cueAtSeconds:21.25},
    {id:"v2",name:"verse to",cueAtSeconds:41.25},
    {id:"c2",name:"chorus to",cueAtSeconds:61.25},
    {id:"out",name:"out row",cueAtSeconds:81.25},
  ],100,144,{numerator:6,denominator:8});
  assert.deepEqual(regions.map(region=>region.name),["Count In","Verse 1","Chorus 1","Verse 2","Chorus 2","Outro"]);
  assert.equal(regions[1]?.startSeconds,5);
});

test("analyzer speech transients are quantized to region measure boundaries",()=>{
  const regions=reviewRegions([{id:"intro",name:"Intro",cueAtSeconds:2.916666666666667}],20,144,{numerator:6,denominator:8});
  assert.equal(regions[1]?.startSeconds,5);
});

test("review regions begin one complete measure after the cue phrase",()=>{
  const regions=reviewRegions([
    {id:"intro",name:"Intro",startSeconds:.795147,cueAtSeconds:.004558,measure:1,beat:1},
    {id:"verse",name:"Verse",startSeconds:26.058277,cueAtSeconds:25.267687,measure:9,beat:1},
  ],50,76,{numerator:4,denominator:4});
  assert.deepEqual(regions.map(region=>region.name),["Count In","Intro","Verse"]);
  assert.equal(regions[0]?.startSeconds,0);
  assert.ok(Math.abs(regions[1]!.startSeconds-3.1578947368421053)<1e-9);
  assert.ok(Math.abs(regions[2]!.startSeconds-28.42105263157895)<1e-9);
});

test("review cues begin one full measure before their destination and clamp the opening cue to zero",()=>{
  const measure=60/76*4;
  assert.equal(correctedReviewCueAt(0,measure),0);
  assert.ok(Math.abs(correctedReviewCueAt(28.42105263157895,measure)-25.263157894736842)<1e-9);
});
