import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { confirmSet } from "../src/confirmed-set/prepare.js";
import { songId, type PreparedSong } from "../src/domain/song.js";

const run = promisify(execFile);
const bundledFfmpeg = join(process.cwd(), "vendor", "runtime", "ffmpeg.exe");

test("Confirm Set copies, verifies, and atomically publishes a ready package", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-v3-"));
  const sourceFolder = join(root, "source");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(sourceFolder));
  const bytes = tinyWav();
  await writeFile(join(sourceFolder, "music.wav"), bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const preparedSong: PreparedSong = {
    song: { id: songId("one"), title: "One", artist: "A", vendor: "V", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } },
    selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 1,
    stems: [{ role: "music-stem", sourcePath: join(sourceFolder, "music.wav"), durationSeconds: 1 }],
    regions: [], cues: [], cacheFingerprint: hash,
  };
  const result = await confirmSet({
    setId: "test-set", setName: "Test", cacheRoot: join(root, "cache"),
    songs: [{ preparedSong, sourceFolder, stems: [{ relativePath: "music.wav", role: "music-stem", durationSeconds: 1, sha256: hash }], liveAssets: {
      click: { regularPath: join(sourceFolder, "music.wav"), accentPath: join(sourceFolder, "music.wav"), events: [{ atSeconds: 0, accent: true }] },
      cues: [{ atSeconds: 0.5, label: "Verse", sourcePath: join(sourceFolder, "music.wav"), targetRegionId: "r1" }],
      repeatCuePath: join(sourceFolder, "music.wav"),
      pad: { key: "C", sourcePath: join(sourceFolder, "music.wav") },
    } }],
  });
  assert.equal(result.readiness.ready, true);
  assert.equal(result.copiedBytes, bytes.length);
  assert.deepEqual(await readFile(result.manifest.songs[0]!.stems[0]!.sourcePath), bytes);
});

function tinyWav(): Buffer {
  const data = Buffer.alloc(16);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + data.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(4, 24); wav.writeUInt32LE(16, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  return wav;
}

test("Confirm Set rejects a bad hash without publishing a set", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-v3-bad-"));
  const sourceFolder = join(root, "source");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(sourceFolder));
  await writeFile(join(sourceFolder, "music.wav"), "bad");
  const preparedSong = {
    song: { id: songId("one"), title: "One", artist: "A", vendor: "V", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } },
    selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 1,
    stems: [{ role: "music-stem", sourcePath: "unused", durationSeconds: 1 }], regions: [], cues: [], cacheFingerprint: "wrong",
  } satisfies PreparedSong;
  await assert.rejects(confirmSet({
    setId: "bad-set", setName: "Bad", cacheRoot: join(root, "cache"),
    songs: [{ preparedSong, sourceFolder, stems: [{ relativePath: "music.wav", role: "music-stem", durationSeconds: 1, sha256: "wrong" }] }],
  }), /Hash verification failed/);
});

test("Confirm Set converts an M4A stem to PCM WAV before publishing", { skip: !existsSync(bundledFfmpeg) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-v3-m4a-")), sourceFolder = join(root, "source");
  await mkdir(sourceFolder);
  const wavPath = join(sourceFolder, "reference.wav"), m4aPath = join(sourceFolder, "music.m4a");
  const wav = playableWav();
  await writeFile(wavPath, wav);
  await run(bundledFfmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", wavPath, "-c:a", "aac", m4aPath]);
  const m4aHash = createHash("sha256").update(await readFile(m4aPath)).digest("hex");
  const preparedSong: PreparedSong = {
    song: { id: songId("m4a"), title: "M4A Song", artist: "A", vendor: "V", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } },
    selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: .01,
    stems: [{ role: "music-stem", sourcePath: m4aPath, durationSeconds: .01 }], regions: [], cues: [], cacheFingerprint: m4aHash,
  };
  const result = await confirmSet({
    setId: "m4a-set", setName: "M4A", cacheRoot: join(root, "cache"), ffmpegPath: bundledFfmpeg,
    songs: [{ preparedSong, sourceFolder, stems: [{ relativePath: "music.m4a", role: "music-stem", durationSeconds: .01, sha256: m4aHash }], liveAssets: {
      click: { regularPath: wavPath, accentPath: wavPath, events: [{ atSeconds: 0, accent: true }] }, cues: [{ atSeconds: 0, label: "Start", sourcePath: wavPath, targetRegionId: "r1" }], repeatCuePath: wavPath, pad: { key: "C", sourcePath: wavPath },
    } }],
  });
  const preparedPath = result.manifest.songs[0]!.stems[0]!.sourcePath, preparedBytes = await readFile(preparedPath);
  assert.equal(result.readiness.ready, true);
  assert.match(preparedPath, /music\.wav$/i);
  assert.equal(preparedBytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(preparedBytes.toString("ascii", 8, 12), "WAVE");
});

function playableWav(): Buffer {
  const samples = 480, data = Buffer.alloc(samples * 2), wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40);
  return wav;
}
