import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanMasterLibrary } from "../src/library/library-scanner.js";
import type { MasterSongRow } from "../src/library/normalize-song.js";

const row = (folderPath: string, title: string): MasterSongRow => ({
  catalogId: title,
  title,
  artist: "Artist",
  vendor: "Vendor",
  bpm: 120,
  key: "C",
  timeSignature: "4/4",
  folderPath,
});

test("legacy analyzer files no longer make a song ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-library-legacy-"));
  await mkdir(join(root, "analysis"), { recursive: true });
  await writeFile(join(root, "song-metadata.json"), "{}");
  await writeFile(join(root, "analysis", "regions.json"), "{}");
  await writeFile(join(root, "music.wav"), "wav");

  const result = await scanMasterLibrary([row(root, "Legacy")]);

  assert.equal(result.songs[0]?.readiness, "needs-analysis");
  assert.match(result.songs[0]?.issues.join(" ") ?? "", /playback-song\.json/);
});

test("playback-song package is the library gate for editor review", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-library-package-"));
  await writeFile(join(root, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    review: { status: "ready" },
    master: { catalogId: "Packaged", title: "Packaged" },
    timeline: { durationMs: 10000 },
    audioFiles: [{ path: "music.m4a", role: "music-stem", playbackBus: "music-stem", playLive: true }],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1 } }, end: { position: { measure: 5, beat: 1 } } }],
    cues: [],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
  }));

  const result = await scanMasterLibrary([row(root, "Packaged")]);
  const song = result.songs[0]!;

  assert.equal(song.readiness, "needs-review");
  assert.equal(song.wavCount, 0);
  assert.equal(song.m4aCount, 1);
  assert.equal(song.analyzerMetadataPath, join(root, "playback-song.json"));
});

test("playback-song package with nested MultiTracks live paths requires reanalysis", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-library-stale-path-"));
  await writeFile(join(root, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    review: { status: "ready" },
    master: { catalogId: "Stale", title: "Stale" },
    timeline: { durationMs: 10000 },
    audioFiles: [{ path: "MultiTracks/music.wav", role: "music-stem", playbackBus: "music-stem", playLive: true }],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1 } }, end: { position: { measure: 5, beat: 1 } } }],
    cues: [],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
  }));

  const result = await scanMasterLibrary([row(root, "Stale")]);
  const song = result.songs[0]!;

  assert.equal(song.readiness, "needs-analysis");
  assert.match(song.issues.join(" "), /nested MultiTracks/);
});
