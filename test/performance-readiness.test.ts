import { validateConfirmedSet } from "../src/confirmed-set/manifest.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConfirmedSetManifest } from "../src/confirmed-set/manifest.js";
import { songId } from "../src/domain/song.js";
import { evaluatePerformanceReadiness, manifestReadiness } from "../src/live/performance-readiness.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "playback-ready-")), packageRoot = join(root, "confirmed"); await mkdir(packageRoot);
  const asset = async (name: string) => { const path = join(packageRoot, name); await writeFile(path, name); return path; };
  const music = await asset("music.wav"), waveform = await asset("waveform.json"), click = await asset("click.wav"), cue = await asset("cue.wav"), pad = await asset("pad.wav");
  const song = { song: { id: songId("one"), title: "One", artist: "A", vendor: "V", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } }, selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 8, stems: [{ role: "Music", sourcePath: music, durationSeconds: 8 }], regions: [{ id: "v", name: "Verse", startSeconds: 0, endSeconds: 8 }], cues: [], cacheFingerprint: "hash", waveformPath: waveform, liveAssets: { click: { regularPath: click, accentPath: click, events: [{ atSeconds: 0, accent: true }] }, cues: [{ atSeconds: 0, label: "Verse", audioPath: cue, targetRegionId: "v" }], repeatCuePath: cue, pad: { key: "C", audioPath: pad } } };
  const manifest: ConfirmedSetManifest = { schemaVersion: 1, id: "set", name: "Set", confirmedAt: "now", songs: [song] };
  const native = { deviceOpenMs: 2, armMs: 4, stems: 1, clickEvents: 1, cueEvents: 1, padKey: "C", midiEvents: 0, midiEnabled: false, outputChannels: 6, routingReady: true, stereoFallback: false, nextReady: false, nextIndex: -1 };
  return { root, packageRoot, manifest, native };
}
test("unified performance readiness passes a complete isolated package", async () => { const value = await fixture(); const result = await evaluatePerformanceReadiness({ manifest: value.manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: value.native, midiOutputName: null }); assert.equal(result.status, "Ready"); assert.equal(result.ready, true); assert.equal(result.checks.length, 9); });
test("stereo fallback and disabled prepared MIDI warn without blocking audio", async () => { const value = await fixture(); const song = { ...value.manifest.songs[0]!, arrangement: { id: "a", name: "A", sourceType: "reaper-import" as const, sourceSha256: "h", proPresenterMidi: [{ atSeconds: 1, status: 144, data1: 19, data2: 2 }], midiOutputName: null } }; const manifest = { ...value.manifest, songs: [song] }; const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...value.native, outputChannels: 2, routingReady: false, stereoFallback: true, midiEvents: 1 }, midiOutputName: null }); assert.equal(result.status, "Ready with warnings"); assert.equal(result.ready, true); assert.deepEqual(result.checks.filter((item) => item.level === "warning").map((item) => item.id), ["routing", "midi"]); });
test("Original Song control MIDI is counted without arrangement identity", async () => { const value = await fixture(); const song = { ...value.manifest.songs[0]!, control: { sourceType: "reaper-import" as const, sourceSha256: "slides", proPresenterMidi: [{ atSeconds: 1, status: 144, data1: 19, data2: 2 }], midiOutputName: null } }; const manifest = { ...value.manifest, songs: [song] }; const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...value.native, midiEvents: 1, midiEnabled: true }, midiOutputName: "Slides" }); assert.equal(result.status, "Ready"); assert.equal(result.checks.find((item) => item.id === "midi")?.level, "ready"); });
test("media-only setlist items do not require click, cue, pad, MIDI, or regions", async () => { const value = await fixture(); const source = value.manifest.songs[0]!, { liveAssets: _liveAssets, control: _control, arrangement: _arrangement, ...withoutLiveAssets } = source, song = { ...withoutLiveAssets, mediaOnly: true, song: { ...source.song, vendor: "Media" }, selectedKey: "MEDIA", selectedBpm: 120, regions: [], cues: [] }; const manifest = { ...value.manifest, songs: [song] }; const { padKey: _padKey, ...nativeWithoutPad } = value.native; const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...nativeWithoutPad, clickEvents: 0, cueEvents: 0, midiEvents: 0 }, midiOutputName: null }); assert.equal(result.ready, true); assert.equal(result.checks.some((item) => item.id === "structure"), false); assert.equal(result.checks.find((item) => item.id === "engine")?.level, "ready"); });
test("one Reaper measure containing ProPresenter start MIDI is a valid control preroll",async()=>{const value=await fixture(),source=value.manifest.songs[0]!,song={...source,regions:[{...source.regions[0]!,startSeconds:2}],arrangement:{id:"reaper",name:"REAPER · One",sourceType:"reaper-import" as const,sourceSha256:"h",proPresenterMidi:[{atSeconds:0,status:144,data1:1,data2:2}],midiOutputName:"Slides"}},manifest={...value.manifest,songs:[song]};const result=await evaluatePerformanceReadiness({manifest,manifestPath:join(value.packageRoot,"confirmed-set.json"),songIndex:0,native:{...value.native,midiEvents:1,midiEnabled:true},midiOutputName:"Slides"});assert.equal(result.status, "Ready");});
test("Non-stem failures are notices and never block Performance", async () => { const value = await fixture(); const outside = join(value.root, "outside.wav"); await writeFile(outside, "outside"); const source = value.manifest.songs[0]!, second = { ...structuredClone(source), song: { ...source.song, id: songId("two"), title: "Two" } }; const broken = { ...source, stems: [{ ...source.stems[0]!, sourcePath: outside }], waveformPath: join(value.packageRoot, "missing.json") }; const manifest = { ...value.manifest, songs: [broken, second] }; const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...value.native, stems: 0, outputChannels: 0, routingReady: false, nextReady: false }, midiOutputName: null }); assert.equal(result.status, "Ready with warnings"); for (const id of ["isolation", "assets", "engine", "routing", "next"]) assert.equal(result.checks.find((item) => item.id === id)?.level, "warning"); });
test("engine startup failure is reported without blocking Performance entry", async () => { const value = await fixture(); const result = await evaluatePerformanceReadiness({ manifest: value.manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: null, midiOutputName: null, nativeError: "Audio device lost" }); assert.equal(result.ready, true); assert.match(result.checks.find((item) => item.id === "engine")!.detail, /Audio device lost/); });
test("Analyzer review status does not block Performance Mode", async () => { const value = await fixture(); const manifest = { ...value.manifest, review: { status: "draft", performanceEligible: false } } as typeof value.manifest; const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: value.native, midiOutputName: null }); assert.equal(result.ready, true); assert.equal(result.checks.find((item) => item.id === "analyzer-review")?.level, "warning"); });

test("Performance allows absent or incomplete song annotations without changing the song", async () => {
    const value = await fixture(), source = value.manifest.songs[0]!;
    const cases = [
        { ...source, regions: [], cues: [], liveAssets: { ...source.liveAssets!, cues: [] } },
        { ...source, regions: [{ id: "", name: "", startSeconds: 2, endSeconds: 6 }] },
        { ...source, regions: [{ id: "v", name: "Verse", startSeconds: 0, endSeconds: 2 }, { id: "c", name: "Chorus", startSeconds: 4, endSeconds: 6 }] },
        { ...source, regions: [{ id: "v", name: "Verse", startSeconds: 0, endSeconds: 6 }, { id: "c", name: "Chorus", startSeconds: 4, endSeconds: 8 }] },
        { ...source, cues: [{ phrase: "Verse", atSeconds: 0, targetRegionId: "deleted" }] },
    ];
    for (const song of cases) {
        const manifest = { ...value.manifest, review: { songMapVersion: 8, performanceEligible: true }, songs: [song] };
        const before = JSON.stringify(manifest);
        const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...value.native, cueEvents: song.liveAssets?.cues.length ?? 0 }, midiOutputName: null });
        assert.equal(result.status, "Ready", JSON.stringify(result.checks));
        assert.equal(manifestReadiness(manifest).status, "Ready");
        assert.equal(JSON.stringify(manifest), before);
        assert.equal(validateConfirmedSet(manifest).ready, false, "Editor/preparation still checks annotations");
    }
});

test("Configured cue audio failures remain visible without blocking Performance", async () => {
    const value = await fixture(), source = value.manifest.songs[0]!;
    for (const cue of [
        { ...source.liveAssets!.cues[0]!, audioPath: join(value.packageRoot, "missing-cue.wav") },
        { ...source.liveAssets!.cues[0]!, audioPath: "" },
    ]) {
        const manifest = { ...value.manifest, songs: [{ ...source, liveAssets: { ...source.liveAssets!, cues: [cue] } }] };
        const result = await evaluatePerformanceReadiness({ manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: value.native, midiOutputName: null });
        assert.equal(result.status, "Ready with warnings");
    }
    const mismatch = await evaluatePerformanceReadiness({ manifest: value.manifest, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: { ...value.native, cueEvents: 0 }, midiOutputName: null });
    assert.equal(mismatch.checks.find(item => item.id === "engine")?.level, "warning");
});

test("Only missing stem audio blocks readiness", async () => {
 const value = await fixture(), original = value.manifest.songs[0]!;
 for (const stems of [[], [{ ...original.stems[0]!, sourcePath: "" }], [{ ...original.stems[0]!, sourcePath: join(value.packageRoot, "absent.wav") }], [{ ...original.stems[0]!, sourcePath: value.packageRoot }]]) {
  const result = await evaluatePerformanceReadiness({ manifest: { ...value.manifest, songs: [{ ...original, stems }] }, manifestPath: join(value.packageRoot, "confirmed-set.json"), songIndex: 0, native: value.native, midiOutputName: null });
  assert.equal(result.ready, false);
  assert.deepEqual(result.checks.filter(item => item.level === "blocked").map(item => item.id), ["stems"]);
 }
});
