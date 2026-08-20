import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANALYZER_SONG_MAP_VERSION, correctedReviewCueAt, cueAudioLookupNames, normalizeReviewKey, prepareCandidateReview, selectedSongClickTemplate } from "../src/library/review-manifest.js";
import { isReferenceAudio } from "../src/library/audio-role.js";
import { discoverPreparedLibrary } from "../src/prep/operator-workflow.js";

async function writeSilentWav(path: string, seconds = 1) {
  const sampleRate = 48000, channels = 1, bits = 16, samples = sampleRate * seconds;
  const dataSize = samples * channels * bits / 8;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bits / 8, 28);
  buffer.writeUInt16LE(channels * bits / 8, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  await writeFile(path, buffer);
}

test("analyzer song-map format has an explicit invalidation version",()=>{
  assert.equal(ANALYZER_SONG_MAP_VERSION,15);
});

test("vendor pad stems are playable stems, not reference audio", () => {
  assert.equal(isReferenceAudio("CLICK.wav"), true);
  assert.equal(isReferenceAudio("Guide.wav"), true);
  assert.equal(isReferenceAudio("CUES.wav"), true);
  assert.equal(isReferenceAudio("PAD.wav"), false);
  assert.equal(isReferenceAudio("Synth Pad.wav"), false);
});

test("playback-song package selects the live click template",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"click-metadata-"));
  await writeFile(join(folder,"playback-song.json"),JSON.stringify({schema:"playback-analyzer-package/v1",schemaVersion:1,generatedAt:"now",review:{status:"ready"},master:{catalogId:"1",title:"Song"},timeline:{durationMs:1000},audioFiles:[],cues:[],click:{playbackPattern:{templateId:"4-4-eighth",events:[{atSeconds:0,accent:true}]}}}));
  assert.equal(await selectedSongClickTemplate(folder,{numerator:4,denominator:4}),"4-4-eighth");
});

test("missing click metadata is rejected instead of using a Playback fallback",async()=>{
  const missing=await mkdtemp(join(tmpdir(),"click-default-"));
  await assert.rejects(()=>selectedSongClickTemplate(missing,{numerator:6,denominator:8}),/playback-song\.json must provide a click template/);
  const noEvents=await mkdtemp(join(tmpdir(),"click-events-"));
  await writeFile(join(noEvents,"playback-song.json"),JSON.stringify({schema:"playback-analyzer-package/v1",schemaVersion:1,generatedAt:"now",review:{status:"ready"},master:{catalogId:"1",title:"Song"},timeline:{durationMs:1000},audioFiles:[],cues:[],click:{playbackPattern:{templateId:"6-8-full"}}}));
  await assert.rejects(()=>selectedSongClickTemplate(noEvents,{numerator:6,denominator:8}),/must provide click events/);
  const invalid=await mkdtemp(join(tmpdir(),"click-invalid-"));
  await writeFile(join(invalid,"playback-song.json"),JSON.stringify({schema:"playback-analyzer-package/v1",schemaVersion:1,generatedAt:"now",review:{status:"ready"},master:{catalogId:"1",title:"Song"},timeline:{durationMs:1000},audioFiles:[],cues:[],click:{playbackPattern:{templateId:"4-4-eighth",events:[{atSeconds:0,accent:true}]}}}));
  await assert.rejects(()=>selectedSongClickTemplate(invalid,{numerator:6,denominator:8}),/does not match 6\/8/);
});

test("review preparation preserves minor keys instead of truncating them to major",()=>{
  assert.equal(normalizeReviewKey("E minor"),"Em");
  assert.equal(normalizeReviewKey("F#m"),"F#m");
  assert.equal(normalizeReviewKey("G major"),"G");
});

test("review cues begin one full measure before their destination and clamp the opening cue to zero",()=>{
  const measure=60/76*4;
  assert.equal(correctedReviewCueAt(0,measure),0);
  assert.ok(Math.abs(correctedReviewCueAt(28.42105263157895,measure)-25.263157894736842)<1e-9);
});

test("numbered section cues fall back to the base cue audio",()=>{
  assert.deepEqual(cueAudioLookupNames("Verse 1"),["VERSE 1.wav","VERSE1.wav","VERSE.wav"]);
  assert.deepEqual(cueAudioLookupNames("Turnaround 2"),["TURN AROUND 2.wav","TURNAROUND2.wav","TURN AROUND.wav","TURNAROUND.wav"]);
  assert.deepEqual(cueAudioLookupNames("DownBridge"),["DOWN BRIDGE.wav","DOWNBRIDGE.wav"]);
  assert.deepEqual(cueAudioLookupNames("DownChorus"),["DOWN CHORUS.wav","DOWNCHORUS.wav"]);
  assert.deepEqual(cueAudioLookupNames("A Capella"),["ACAPPELLA.wav","ACAPELLA.wav"]);
});

test("review preparation rejects stale nested MultiTracks analyzer paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "stale-multitracks-"));
  const song = join(root, "Song");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(song, "MultiTracks"), { recursive: true }));
  await writeFile(join(song, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "now",
    review: { status: "ready" },
    master: { catalogId: "1", title: "Song" },
    timeline: { durationMs: 1000 },
    audioFiles: [{ path: "MultiTracks/Bass.wav", playLive: true, playbackBus: "bass", sha256: "abc" }],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1, tick: 0 } }, end: { position: { measure: 2, beat: 1, tick: 0 } } }],
    cues: [],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
  }));
  await assert.rejects(() => prepareCandidateReview({
    catalogId: "1",
    sharedMetadataRoot: root,
    libraryRoot: root,
    cacheRoot: join(root, "cache"),
    clickRegularPath: join(root, "CLICK.wav"),
    clickAccentPath: join(root, "CLICK ACCENT.wav"),
    cueFolder: root,
    padFolder: root,
    ffmpegPath: "ffmpeg",
    master: { catalogId: "1", title: "Song", artist: "Artist", vendor: "Multitracks", key: "C", bpm: 120, timeSignature: "4/4", folderPath: song },
  }), /stale after library flattening/);
});

test("review preparation exposes Analyzer RPP arrangements as prepared choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "analyzer-arrangements-"));
  const song = join(root, "Song");
  const arrangementFolder = join(song, "Arrangements", "Short Version");
  const cues = join(root, "cues");
  await mkdir(song, { recursive: true });
  await mkdir(arrangementFolder, { recursive: true });
  await mkdir(cues, { recursive: true });
  await Promise.all(["INTRO.wav", "VERSE.wav", "TWO.wav", "THREE.wav", "FOUR.wav"].map(name => writeSilentWav(join(cues, name))));
  await writeSilentWav(join(song, "Bass.wav"), 4);
  await writeSilentWav(join(arrangementFolder, "Short Bass.wav"), 8);
  await writeFile(join(song, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "now",
    review: { status: "ready" },
    master: { catalogId: "1", title: "Song", originalKey: "C" },
    keyAnalysis: { approvedKey: "C" },
    timeline: { durationMs: 4000 },
    audioFiles: [{ path: "Bass.wav", playLive: true, playbackBus: "bass", sha256: "bass" }],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1, tick: 0 } }, end: { position: { measure: 2, beat: 1, tick: 0 } } }],
    cues: [{ phrase: "Intro", cueStart: { position: { measure: 1, beat: 1, tick: 0 } }, targetRegionId: "r1" }],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
    arrangements: [{
      id: "short",
      name: "Short Version",
      sourcePath: "Arrangements/Short Version/Short Version.rpp",
      bpm: 120,
      timeSignature: "4/4",
      durationSeconds: 8,
      audioFiles: [{ path: "Arrangements/Short Version/Short Bass.wav", playLive: true, playbackBus: "bass", sha256: "short-bass", trackName: "Short Bass" }],
      regions: [{ id: "a1", name: "Verse", start: { position: { measure: 1, beat: 1, tick: 0 } }, end: { position: { measure: 3, beat: 1, tick: 0 } } }],
      cues: [{ phrase: "Verse", cueStart: { position: { measure: 1, beat: 1, tick: 0 } }, targetRegionId: "a1" }],
      control: { slidesMidi: [{ atSeconds: 1, status: 144, data1: 19, data2: 2 }] },
    }],
  }));
  const result = await prepareCandidateReview({
    catalogId: "1",
    sharedMetadataRoot: root,
    libraryRoot: root,
    cacheRoot: join(root, "cache"),
    clickRegularPath: join(root, "click.wav"),
    clickAccentPath: join(root, "accent.wav"),
    cueFolder: cues,
    padFolder: root,
    ffmpegPath: "ffmpeg",
    master: { catalogId: "1", title: "Song", artist: "Artist", vendor: "Loop Community", key: "C", bpm: 120, timeSignature: "4/4", folderPath: song },
  });
  assert.equal(result.manifest.songs.length, 2);
  assert.equal(result.manifest.songs[0]!.arrangement, undefined);
  assert.equal(result.manifest.songs[1]!.arrangement?.name, "Short Version");
  assert.equal(result.manifest.songs[1]!.durationSeconds, 8);
  assert.match(result.manifest.songs[1]!.stems[0]!.sourcePath, /arrangements[\\/]+short[\\/]+stems[\\/]+01-Short_Bass\.wav$/);
  assert.equal(result.manifest.songs[1]!.stems[0]!.displayName, "Short Bass");
  assert.equal(result.manifest.songs[1]!.regions[0]!.name, "Verse");
  assert.equal(result.manifest.songs[1]!.arrangement?.proPresenterMidi.length, 1);
  assert.equal((result.manifest as any).review.arrangementCount, 1);
  const prepared = await discoverPreparedLibrary([result.manifestPath]);
  assert.deepEqual(prepared.map(item => item.arrangement), ["Original Song", "Short Version"]);
});

test("review preparation keeps analyzer pad-stem in the expanded stem list", async () => {
  const root = await mkdtemp(join(tmpdir(), "vendor-pad-stem-"));
  const song = join(root, "Song");
  const cues = join(root, "cues");
  await mkdir(song, { recursive: true });
  await mkdir(cues, { recursive: true });
  await Promise.all(["INTRO.wav", "TWO.wav", "THREE.wav", "FOUR.wav"].map(name => writeSilentWav(join(cues, name))));
  await writeSilentWav(join(song, "Bass.wav"), 4);
  await writeSilentWav(join(song, "PAD.wav"), 4);
  await writeFile(join(song, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "now",
    review: { status: "ready" },
    master: { catalogId: "1", title: "Song", originalKey: "C" },
    keyAnalysis: { approvedKey: "C" },
    timeline: { durationMs: 4000 },
    audioFiles: [
      { path: "Bass.wav", playLive: true, playbackBus: "bass", role: "music-stem", sha256: "bass" },
      { path: "PAD.wav", playLive: true, playbackBus: "pad", role: "pad-stem", sha256: "pad" },
      { path: "CLICK.wav", playLive: true, playbackBus: "click", role: "click-reference", sha256: "click" },
    ],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1, tick: 0 } }, end: { position: { measure: 2, beat: 1, tick: 0 } } }],
    cues: [{ phrase: "Intro", cueStart: { position: { measure: 1, beat: 1, tick: 0 } }, targetRegionId: "r1" }],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
  }));

  const result = await prepareCandidateReview({
    catalogId: "1",
    sharedMetadataRoot: root,
    libraryRoot: root,
    cacheRoot: join(root, "cache"),
    clickRegularPath: join(root, "click.wav"),
    clickAccentPath: join(root, "accent.wav"),
    cueFolder: cues,
    padFolder: root,
    ffmpegPath: "ffmpeg",
    master: { catalogId: "1", title: "Song", artist: "Artist", vendor: "Loop Community", key: "C", bpm: 120, timeSignature: "4/4", folderPath: song },
  });

  assert.deepEqual(result.manifest.songs[0]!.stems.map(stem => stem.role), ["bass", "pad"]);
  assert.match(result.manifest.songs[0]!.stems[1]!.sourcePath, /02-PAD\.wav$/);
});

test("review preparation keeps vocal stems in editor mixers even when analyzer playLive is false", async () => {
  const root = await mkdtemp(join(tmpdir(), "vocal-stems-"));
  const song = join(root, "Song");
  const cues = join(root, "cues");
  await mkdir(song, { recursive: true });
  await mkdir(cues, { recursive: true });
  await Promise.all(["INTRO.wav", "TWO.wav", "THREE.wav", "FOUR.wav"].map(name => writeSilentWav(join(cues, name))));
  await writeSilentWav(join(song, "Bass.wav"), 4);
  await writeSilentWav(join(song, "BGVS.wav"), 4);
  await writeSilentWav(join(song, "CUES.wav"), 4);
  await writeFile(join(song, "playback-song.json"), JSON.stringify({
    schema: "playback-analyzer-package/v1",
    schemaVersion: 1,
    generatedAt: "now",
    review: { status: "ready" },
    master: { catalogId: "1", title: "Song", originalKey: "C" },
    keyAnalysis: { approvedKey: "C" },
    timeline: { durationMs: 4000 },
    audioFiles: [
      { path: "Bass.wav", playLive: true, playbackBus: "bass", role: "music-stem", sha256: "bass" },
      { path: "BGVS.wav", playLive: false, playbackBus: "vocals", role: "vocal-stem", sha256: "bgvs" },
      { path: "CUES.wav", playLive: false, role: "cue-reference", sha256: "cue" },
    ],
    regions: [{ id: "r1", name: "Intro", start: { position: { measure: 1, beat: 1, tick: 0 } }, end: { position: { measure: 2, beat: 1, tick: 0 } } }],
    cues: [{ phrase: "Intro", cueStart: { position: { measure: 1, beat: 1, tick: 0 } }, targetRegionId: "r1" }],
    click: { playbackPattern: { templateId: "4-4-quarter", events: [{ atSeconds: 0, accent: true }] } },
  }));

  const result = await prepareCandidateReview({
    catalogId: "1",
    sharedMetadataRoot: root,
    libraryRoot: root,
    cacheRoot: join(root, "cache"),
    clickRegularPath: join(root, "click.wav"),
    clickAccentPath: join(root, "accent.wav"),
    cueFolder: cues,
    padFolder: root,
    ffmpegPath: "ffmpeg",
    master: { catalogId: "1", title: "Song", artist: "Artist", vendor: "Loop Community", key: "C", bpm: 120, timeSignature: "4/4", folderPath: song },
  });

  assert.deepEqual(result.manifest.songs[0]!.stems.map(stem => stem.role), ["bass", "vocals"]);
  assert.deepEqual(result.manifest.songs[0]!.stems.map(stem => stem.displayName), ["Bass", "BGVS"]);
});
