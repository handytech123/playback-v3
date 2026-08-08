import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLiveEngine } from "../src/live/live-engine-contract.js";
import { songId, type PreparedSong } from "../src/domain/song.js";
import type { ConfirmedSetManifest } from "../src/confirmed-set/manifest.js";

function fixture(stems = 1): ConfirmedSetManifest {
  const song: PreparedSong = {
    song: {
      id: songId("song-1"), title: "Example", artist: "Artist", vendor: "Vendor",
      originalKey: "D", originalBpm: 72, originalTimeSignature: { numerator: 6, denominator: 8 },
    },
    selectedKey: "D", selectedBpm: 72, timeSignature: { numerator: 6, denominator: 8 },
    durationSeconds: 120,
    stems: Array.from({ length: stems }, (_, index) => ({ role: `music-${index}`, sourcePath: `cache/stem-${index}.wav`, durationSeconds: 120 })),
    regions: [], cues: [], cacheFingerprint: "sha256:test", waveformPath: "cache/waveform.json",
    liveAssets: { click: { regularPath: "cache/click.wav", accentPath: "cache/accent.wav", events: [{ atSeconds: 0, accent: true }], templateId: "4-4-quarter" }, cues: [{ atSeconds: 1, label: "Verse", audioPath: "cache/verse.wav", targetRegionId: "r1" }], repeatCuePath:"cache/repeat.wav", pad: { key: "D", audioPath: "cache/pad.wav" } },
  };
  return { schemaVersion: 1, id: "set-1", name: "Sunday", confirmedAt: new Date(0).toISOString(), songs: [song] };
}

test("live commands require an armed confirmed set", () => {
  const engine = new InMemoryLiveEngine();
  assert.throws(() => engine.play(), /armed/);
});

test("invalid preparation is rejected before performance", async () => {
  const engine = new InMemoryLiveEngine();
  await assert.rejects(engine.arm(fixture(0), 0), /No playable music stems/);
});

test("armed transport plays, seeks, pauses, and stops without prep calls", async () => {
  const engine = new InMemoryLiveEngine();
  await engine.arm(fixture(), 0);
  engine.seek(32.5);
  engine.play();
  assert.equal(engine.snapshot().state, "playing");
  assert.equal(engine.snapshot().positionSeconds, 32.5);
  engine.pause();
  assert.equal(engine.snapshot().state, "paused");
  engine.stop();
  assert.deepEqual(engine.snapshot(), { state: "stopped", songIndex: 0, positionSeconds: 0 });
});
