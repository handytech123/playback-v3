import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOriginalSong } from "../src/library/normalize-song.js";

const master = {
  catalogId: "master_row_16", title: "Cornerstone", artist: "Hillsong Worship",
  vendor: "Loop Community", bpm: 72, key: "C", timeSignature: "4/4",
  folderPath: "D:\\Library\\Cornerstone",
};

const analyzer = {
  songId: "analyzer-id", title: "Wrong title", artist: "Hillsong Worship", vendor: "Loop Community",
  bpm: 80, key: "D", timeSignature: "6/8", durationSeconds: 410,
  wavFiles: [
    { path: "DRUMS.wav", durationSeconds: 410, playbackRole: "music-stem", playLive: true, sha256: "music" },
    { path: "CLICK.wav", durationSeconds: 410, playbackRole: "click-reference", playLive: false, sha256: "click" },
    { path: "CUES.wav", durationSeconds: 410, playbackRole: "cue-reference", playLive: false, sha256: "cue" },
  ],
};

const regions = { regions: [
  { id: "r1", name: "Start", startTimeSeconds: 0, endTimeSeconds: 10 },
  { id: "r2", name: "Verse 2", startTimeSeconds: 10, endTimeSeconds: 30 },
] };

test("master facts always win and reference stems never enter live music", () => {
  const result = normalizeOriginalSong(master, analyzer, regions);
  assert.equal(result.preparedSong.song.title, "Cornerstone");
  assert.equal(result.preparedSong.selectedBpm, 72);
  assert.equal(result.preparedSong.selectedKey, "C");
  assert.deepEqual(result.preparedSong.timeSignature, { numerator: 4, denominator: 4 });
  assert.deepEqual(result.preparedSong.stems.map((stem) => stem.sourcePath), ["D:\\Library\\Cornerstone\\DRUMS.wav"]);
  assert.equal(result.warnings.length, 4);
});

test("analyzer key is used only when the master key is missing", () => {
  const result = normalizeOriginalSong({ ...master, key: null }, { ...analyzer, keyStatus: "confirmed" as const }, regions);
  assert.equal(result.preparedSong.selectedKey, "D");
  assert.match(result.warnings.at(-1) ?? "", /explicitly approved/);
});

test("an estimated key cannot silently enter a Confirmed Set",()=>{
  assert.throws(()=>normalizeOriginalSong({...master,key:null},{...analyzer,keyStatus:"estimated" as const},regions),/requires operator approval/);
});
