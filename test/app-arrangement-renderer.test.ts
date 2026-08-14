import assert from "node:assert/strict";
import test from "node:test";
import { buildArrangementFilter, keyDistance } from "../src/edit/app-arrangement-renderer.js";

test("computes shortest chromatic pitch changes with flat and sharp aliases", () => {
  assert.equal(keyDistance("C", "D"), 2);
  assert.equal(keyDistance("B", "Bb"), -1);
  assert.equal(keyDistance("Gb", "C"), -6);
  assert.throws(() => keyDistance("H", "C"), /Unsupported/);
});

test("applies Rubber Band once after assembling every arrangement section", () => {
  const filter = buildArrangementFilter({ baseKey: "C#", selectedKey: "G", baseBpm: 72, selectedBpm: 72, durationSeconds: 20, sections: [{ sourceStartSeconds: 0, sourceEndSeconds: 10 }, { sourceStartSeconds: 20, sourceEndSeconds: 30 }] } as any);
  assert.equal((filter.match(/rubberband=/g) ?? []).length, 1);
  assert.match(filter, /\[s0\]\[s1\]concat=n=2:v=0:a=1\[arranged\]/);
  assert.match(filter, /\[arranged\]rubberband=tempo=1:pitch=1\.4142135623730951,apad=whole_dur=20,atrim=duration=20/);
});

test("enforces exact duration without unnecessary key processing", () => {
  const filter = buildArrangementFilter({ baseKey: "C", selectedKey: "C", baseBpm: 72, selectedBpm: 72, durationSeconds: 10, sections: [{ sourceStartSeconds: 0, sourceEndSeconds: 10 }] } as any);
  assert.doesNotMatch(filter, /rubberband=/);
  assert.match(filter, /\[arranged\]apad=whole_dur=10,atrim=duration=10/);
});
