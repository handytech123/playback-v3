import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { confirmSet } from "../src/confirmed-set/prepare.js";
import { songId, type PreparedSong } from "../src/domain/song.js";

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
