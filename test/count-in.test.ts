import assert from "node:assert/strict";
import test from "node:test";
import { songId, type PreparedSong } from "../src/domain/song.js";
import { buildCountInSources } from "../src/live/count-in.js";

function song(numerator: 4 | 6, bpm: number, cueAt: number, regionAt: number): PreparedSong {
  const targetRegionId = "intro";
  return {
    song: { id: songId("test"), title: "Test", artist: "", vendor: "", originalKey: "C", originalBpm: bpm, originalTimeSignature: { numerator, denominator: numerator === 6 ? 8 : 4 } },
    selectedKey: "C", selectedBpm: bpm, timeSignature: { numerator, denominator: numerator === 6 ? 8 : 4 }, durationSeconds: 60,
    stems: [], regions: [{ id: targetRegionId, name: "Intro", startSeconds: regionAt, endSeconds: 60 }], cues: [], cacheFingerprint: "test",
    liveAssets: { click: { regularPath: "click.wav", accentPath: "accent.wav", events: [] }, cues: [{ atSeconds: cueAt, label: "Intro", audioPath: "intro.wav", targetRegionId }], repeatCuePath: "repeat.wav", pad: { key: "C", audioPath: "pad.wav" } },
  };
}

test("4/4 count-in schedules 2 3 4 after the section announcement", () => {
  const events = buildCountInSources(song(4, 60, 4, 8), "C:\\Cues");
  assert.deepEqual(events.map((event) => [event.label, event.atSeconds]), [["2", 5], ["3", 6], ["4", 7]]);
});

test("6/8 count-in schedules all six written eighth-note positions", () => {
  const events = buildCountInSources(song(6, 120, 2, 5), "C:\\Cues");
  assert.deepEqual(events.map((event) => event.label), ["2", "3", "4", "5", "6"]);
  events.forEach((event, index) => assert.ok(Math.abs(event.atSeconds - (2 + (index + 1) / 2)) < 1e-9));
});
