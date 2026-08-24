import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCombinedWaveformSummary, buildWaveformSummary, writeCachedCombinedWaveformSummary } from "../src/prep/wav-waveform.js";

test("builds normalized min/max peaks from stereo PCM16 WAV", async () => {
  const samples = [-32768, 32767, -16384, 16384, 0, 0, 8192, -8192];
  const data = Buffer.alloc(samples.length * 2); samples.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const wav = Buffer.alloc(44 + data.length); wav.write("RIFF", 0); wav.writeUInt32LE(36 + data.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(4, 24); wav.writeUInt32LE(16, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  const directory = await mkdtemp(join(tmpdir(), "playback-waveform-")); const source = join(directory, "test.wav"); await writeFile(source, wav);
  const result = await buildWaveformSummary(source, 2);
  assert.equal(result.durationSeconds, 1); assert.equal(result.buckets.length, 2);
  assert.equal(result.buckets[0]!.min, -1); assert.ok(result.buckets[0]!.max > 0.99);
  assert.equal(result.buckets[1]!.min, -0.25); assert.equal(result.buckets[1]!.max, 0.25);
});

function makeWave(data: Buffer, format: 1 | 3, channels: number, sampleRate: number, bits: number): Buffer {
  const bytesPerSample = bits / 8;
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + data.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(format, 20); wav.writeUInt16LE(channels, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); wav.writeUInt16LE(channels * bytesPerSample, 32); wav.writeUInt16LE(bits, 34);
  wav.write("data", 36); wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  return wav;
}

test("builds waveform peaks from production PCM24 WAV", async () => {
  const values = [-8388608, 8388607, -4194304, 4194304];
  const data = Buffer.alloc(values.length * 3);
  values.forEach((value, index) => data.writeIntLE(value, index * 3, 3));
  const directory = await mkdtemp(join(tmpdir(), "playback-waveform-"));
  const source = join(directory, "pcm24.wav");
  await writeFile(source, makeWave(data, 1, 1, 4, 24));
  const result = await buildWaveformSummary(source, 2);
  assert.equal(result.durationSeconds, 1);
  assert.equal(result.buckets[0]!.min, -1);
  assert.ok(result.buckets[0]!.max > 0.99);
  assert.equal(result.buckets[1]!.min, -0.5);
  assert.equal(result.buckets[1]!.max, 0.5);
});

test("builds waveform peaks from IEEE float32 WAV", async () => {
  const values = [-1, 0.75, -0.25, 0.5];
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => data.writeFloatLE(value, index * 4));
  const directory = await mkdtemp(join(tmpdir(), "playback-waveform-"));
  const source = join(directory, "float32.wav");
  await writeFile(source, makeWave(data, 3, 1, 4, 32));
  const result = await buildWaveformSummary(source, 2);
  assert.equal(result.buckets[0]!.min, -1);
  assert.equal(result.buckets[0]!.max, 0.75);
  assert.equal(result.buckets[1]!.min, -0.25);
  assert.equal(result.buckets[1]!.max, 0.5);
});

test("combines every playable stem into one time-aligned summary waveform", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playback-waveform-combined-"));
  const firstData = Buffer.alloc(8); [-32768, 0, 0, 0].forEach((value, index) => firstData.writeInt16LE(value, index * 2));
  const secondData = Buffer.alloc(8); [0, 0, 0, 32767].forEach((value, index) => secondData.writeInt16LE(value, index * 2));
  const first = join(directory, "acoustic.wav"), second = join(directory, "drums.wav");
  await writeFile(first, makeWave(firstData, 1, 1, 4, 16));
  await writeFile(second, makeWave(secondData, 1, 1, 4, 16));
  const result = await buildCombinedWaveformSummary([first, second], 4);
  assert.equal(result.channels, 2);
  assert.match(result.source, /^combined:acoustic\.wav\|drums\.wav$/);
  assert.equal(result.buckets[0]!.min, -1);
  assert.ok(result.buckets[3]!.max > 0.99);
});

test("reuses cached combined waveform peaks by stem fingerprints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playback-waveform-cache-"));
  const cacheDirectory = join(directory, "peak-cache");
  const firstData = Buffer.alloc(8); [-32768, 0, 0, 0].forEach((value, index) => firstData.writeInt16LE(value, index * 2));
  const secondData = Buffer.alloc(8); [0, 0, 0, 32767].forEach((value, index) => secondData.writeInt16LE(value, index * 2));
  const first = join(directory, "acoustic.wav"), second = join(directory, "drums.wav");
  await writeFile(first, makeWave(firstData, 1, 1, 4, 16));
  await writeFile(second, makeWave(secondData, 1, 1, 4, 16));

  const sources = [
    { path: first, sha256: "a".repeat(64), durationSeconds: 1 },
    { path: second, sha256: "b".repeat(64), durationSeconds: 1 },
  ];
  const destination = join(directory, "confirmed", "waveform.json");
  await writeCachedCombinedWaveformSummary(sources, destination, cacheDirectory, 4);

  const reusedDestination = join(directory, "confirmed-again", "waveform.json");
  await writeCachedCombinedWaveformSummary(sources.map((source) => ({ ...source, path: join(directory, "missing.wav") })), reusedDestination, cacheDirectory, 4);
  assert.deepEqual(JSON.parse(await readFile(reusedDestination, "utf8")), JSON.parse(await readFile(destination, "utf8")));

  await assert.rejects(
    writeCachedCombinedWaveformSummary([{ ...sources[0]!, path: join(directory, "missing.wav"), sha256: "c".repeat(64) }], join(directory, "changed", "waveform.json"), cacheDirectory, 4),
    /ENOENT|no such file/i,
  );
});
