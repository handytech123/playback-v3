import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAudioRouting } from "../src/audio/routing-reconcile.js";
import type { NativeAudioRouting } from "../src/live/native-engine-client.js";

const fallback = (count: number): NativeAudioRouting => ({
  stems: Array.from({ length: count }, (_, index) => index + 1),
  stemChannels: Array.from({ length: count }, () => 1 as const),
  click: 19, clickChannels: 1, cue: 20, cueChannels: 1,
  pad: 21, padChannels: 1, iem: 31, iemChannels: 1,
});

test("routing reconciliation preserves existing assignments and adds new stems", () => {
  const saved: NativeAudioRouting = {
    stems: [8, 9], stemChannels: [1, 2], click: 1, clickChannels: 2,
    cue: 3, cueChannels: 1, pad: 4, padChannels: 1, iem: 5, iemChannels: 2,
  };
  const result = reconcileAudioRouting(saved, fallback(4), 4);
  assert.deepEqual(result.stems, [8, 9, 3, 4]);
  assert.deepEqual(result.stemChannels, [1, 2, 1, 1]);
  assert.equal(result.click, 1);
  assert.equal(result.iemChannels, 2);
});

test("routing reconciliation removes obsolete stems and repairs invalid values", () => {
  const saved = { ...fallback(4), stems: [7, 99, 9, 10], stemChannels: [2, 7, 1, 1] } as unknown as NativeAudioRouting;
  const result = reconcileAudioRouting(saved, fallback(2), 2);
  assert.deepEqual(result.stems, [7, 2]);
  assert.deepEqual(result.stemChannels, [2, 1]);
});
