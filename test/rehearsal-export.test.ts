import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportRehearsalSong, rehearsalExportFilename } from "../src/prep/rehearsal-export.js";
import { songId, type PreparedSong } from "../src/domain/song.js";

test("exports the active song as a rehearsal WAV mixdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "rehearsal-export-"));
  const stemA = join(root, "AG.wav");
  const stemB = join(root, "Bass.wav");
  const click = join(root, "Click.wav");
  const accent = join(root, "Accent.wav");
  const cue = join(root, "Verse.wav");
  await writeFile(stemA, tinyWav(0.25, 440));
  await writeFile(stemB, tinyWav(0.25, 220));
  await writeFile(click, tinyWav(0.05, 1200));
  await writeFile(accent, tinyWav(0.05, 1800));
  await writeFile(cue, tinyWav(0.1, 660));
  const song: PreparedSong = {
    song: {
      id: songId("song"),
      title: "Song",
      artist: "Artist",
      vendor: "Vendor",
      originalKey: "G",
      originalBpm: 72,
      originalTimeSignature: { numerator: 4, denominator: 4 },
    },
    selectedKey: "G",
    selectedBpm: 72,
    timeSignature: { numerator: 4, denominator: 4 },
    durationSeconds: 10,
    stems: [
      { role: "acoustic", sourcePath: stemA, durationSeconds: 10, displayName: "AG" },
      { role: "bass", sourcePath: stemB, durationSeconds: 10, displayName: "Bass" },
    ],
    stemMix: [
      { index: 0, gain: 1, muted: false, solo: false, iem: true },
      { index: 1, gain: 1, muted: true, solo: false, iem: true },
    ],
    regions: [{ id: "r1", name: "Verse", startSeconds: 0, endSeconds: 10 }],
    cues: [{ phrase: "Verse", atSeconds: 0, targetRegionId: "r1" }],
    cacheFingerprint: "fingerprint",
    liveAssets: {
      click: {
        regularPath: click,
        accentPath: accent,
        events: [
          { atSeconds: 0, accent: true },
          { atSeconds: 0.5, accent: false },
        ],
        templateId: "4-4-quarter",
      },
      cues: [{ atSeconds: 0, label: "Verse", audioPath: cue, targetRegionId: "r1" }],
      repeatCuePath: cue,
      pad: { key: "G", audioPath: cue },
    },
  };
  const destinationPath = join(root, rehearsalExportFilename(song, 0));
  const result = await exportRehearsalSong({
    song,
    setName: "Sunday Set",
    songIndex: 0,
    destinationPath,
    ffmpegPath: join(process.cwd(), "vendor", "runtime", "ffmpeg.exe"),
  });
  const output = await readFile(result.path);
  assert.equal(result.stemCount, 1);
  assert.equal(result.liveEventCount, 3);
  assert.equal(result.path.endsWith(".wav"), true);
  assert.equal(output.toString("ascii", 0, 4), "RIFF");
  assert.equal(output.toString("ascii", 8, 12), "WAVE");
});

function tinyWav(durationSeconds: number, frequency: number): Buffer {
  const sampleRate = 48000;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * frequency * Math.PI * 2) * 12000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}
