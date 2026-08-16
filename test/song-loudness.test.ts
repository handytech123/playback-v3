import test from "node:test";
import assert from "node:assert/strict";
import { calculateSafeNormalizationGain } from "../src/audio/song-loudness.js";

test("song normalization targets -18 LUFS while preserving true-peak headroom",()=>{
  assert.equal(calculateSafeNormalizationGain(-21,-10),3);
  assert.equal(calculateSafeNormalizationGain(-14,-4),-4);
  assert.equal(calculateSafeNormalizationGain(-24,-1),0);
});

test("song normalization limits extreme corrections and rejects invalid measurements",()=>{
  assert.equal(calculateSafeNormalizationGain(-40,-20),6);
  assert.equal(calculateSafeNormalizationGain(-5,-1),-6);
  assert.equal(calculateSafeNormalizationGain(Number.NEGATIVE_INFINITY,-10),0);
});
