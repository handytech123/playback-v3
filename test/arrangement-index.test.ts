import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { songId } from "../src/domain/song.js";
import { registerSourceArrangement, registeredSourceArrangementManifestPaths, sourceArrangementIndexPath } from "../src/reaper/arrangement-index.js";
import type { ArrangementVersion } from "../src/reaper/arrangement.js";

const arrangement = (id: string, name: string): ArrangementVersion => ({
  schemaVersion: 1,
  id,
  songId: songId("song-a"),
  name,
  sourceType: "app-edit",
  sourcePath: "",
  sourceSha256: `${id}-hash`,
  importedAt: "2026-01-01T00:00:00.000Z",
  selectedKey: "G",
  selectedBpm: 72,
  timeSignature: { numerator: 4, denominator: 4 },
  durationSeconds: 12,
  regions: [],
  cueMarkers: [],
  markers: [],
  mediaItems: [],
  proPresenterMidi: [],
  slidesTrackName: null,
  warnings: [],
});

test("source arrangement index registers performance manifests without duplicates", async () => {
  const sourceSongFolder = await mkdtemp(join(tmpdir(), "source-arrangement-index-"));
  const arrangementRoot = join(sourceSongFolder, "Arrangements", "Sunday Version", "app-1");
  const arrangementPath = join(arrangementRoot, "arrangement.json");
  const performanceManifestPath = join(arrangementRoot, "performance", "confirmed-set.json");
  await mkdir(join(arrangementRoot, "performance"), { recursive: true });
  await writeFile(arrangementPath, "{}", { encoding: "utf8", flag: "wx" });
  await writeFile(performanceManifestPath, "{}", { encoding: "utf8", flag: "wx" });

  const first = arrangement("app-1", "Sunday Version");
  await registerSourceArrangement({ sourceSongFolder, arrangement: first, arrangementPath, performanceManifestPath });
  await registerSourceArrangement({ sourceSongFolder, arrangement: first, arrangementPath, performanceManifestPath });

  const index = JSON.parse(await readFile(sourceArrangementIndexPath(sourceSongFolder), "utf8"));
  assert.equal(index.arrangements.length, 1);
  assert.equal(index.arrangements[0].performanceManifestPath, "Sunday Version/app-1/performance/confirmed-set.json");
  assert.deepEqual(await registeredSourceArrangementManifestPaths(sourceSongFolder), [performanceManifestPath]);
});
