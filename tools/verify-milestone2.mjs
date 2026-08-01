import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MapEditorHistory, validateSongMap } from "../dist/src/edit/map-editor.js";
import { loadSongMap, saveSongMap } from "../dist/src/edit/map-persistence.js";
import { normalizeRegions } from "../dist/src/edit/song-map.js";

const root = path.resolve(".");
const manifestPath = path.join(root, ".playback-cache", "milestone-1-cornerstone-performance-v3", "confirmed-set.json");
const sourceBytes = await readFile(manifestPath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const manifest = JSON.parse(sourceBytes.toString("utf8"));
const song = manifest.songs[0];
const original = {
  schemaVersion: 1,
  songId: song.song.id,
  bpm: song.selectedBpm,
  timeSignature: song.timeSignature,
  durationSeconds: song.durationSeconds,
  reviewState: "draft",
  revision: 0,
  source: { kind: "analyzer", path: manifestPath, importedAt: new Date().toISOString() },
  regions: normalizeRegions(song.regions),
  cues: song.liveAssets.cues.map((cue, index) => ({ id: `cue-${String(index + 1).padStart(4, "0")}`, phrase: cue.label, atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId, enabled: true, audioPath: cue.audioPath, sourceLabel: cue.label })),
};

assert.deepEqual(original.regions.map((region) => region.name), ["Start","Intro","Verse 1","Verse 2","Down Chorus 1","Turnaround","Verse 3","Tag","Chorus 1","Interlude 1","Chorus 2","Chorus 3","Interlude 2","Verse 4","Interlude 3","Instrumental","Down Chorus 2","Chorus 4","Chorus 5","Outro","End"]);
const editor = new MapEditorHistory(original);
const verse1 = original.regions.find((region) => region.name === "Verse 1");
const cue = original.cues[0];
assert.ok(verse1 && cue);
editor.execute({ type: "set-region-type", regionId: verse1.id, sectionType: "intro", modifier: "Down" });
editor.execute({ type: "toggle-cue", cueId: cue.id, enabled: false });
editor.execute({ type: "retarget-cue", cueId: cue.id, targetRegionId: verse1.id });
const edited = editor.map;
editor.undo();
editor.redo();
assert.deepEqual(editor.map, edited);
assert.deepEqual(validateSongMap(edited), []);

const dataRoot = await mkdtemp(path.join(tmpdir(), "playback-v3-m2-"));
const draftPaths = await saveSongMap(dataRoot, edited);
await saveSongMap(dataRoot, edited);
assert.deepEqual(await loadSongMap(draftPaths.currentPath), edited);
const approved = editor.execute({ type: "approve-map" });
const approvedPaths = await saveSongMap(dataRoot, approved);
assert.equal((await loadSongMap(approvedPaths.currentPath)).reviewState, "approved");
assert.equal(createHash("sha256").update(await readFile(manifestPath)).digest("hex"), sourceHash, "prepared analyzer source changed during editing");

console.log(JSON.stringify({ ready: true, song: song.song.title, canonicalRegions: original.regions.length, cues: original.cues.length, editCommandsVerified: 3, undoRedoVerified: true, draftPersistenceVerified: true, approvalVerified: true, sourcePreserved: true }, null, 2));
