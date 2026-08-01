import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWaveformSummary } from "../src/prep/wav-waveform.js";

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
