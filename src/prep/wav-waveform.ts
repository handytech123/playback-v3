import { open, writeFile } from "node:fs/promises";

export interface WaveformBucket { readonly min: number; readonly max: number; }
export interface WaveformSummary {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSeconds: number;
  readonly buckets: readonly WaveformBucket[];
}

export async function buildWaveformSummary(sourcePath: string, bucketCount = 2400): Promise<WaveformSummary> {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) throw new Error("Waveform bucket count must be positive");
  const file = await open(sourcePath, "r");
  try {
    const header = Buffer.alloc(12);
    await file.read({ buffer: header, position: 0 });
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a RIFF/WAVE file");
    let position = 12, format: { channels: number; sampleRate: number; bits: number } | null = null;
    let dataOffset = 0, dataBytes = 0;
    const chunkHeader = Buffer.alloc(8);
    while (!dataOffset) {
      const read = await file.read({ buffer: chunkHeader, position });
      if (read.bytesRead < 8) throw new Error("WAV data chunk is missing");
      const id = chunkHeader.toString("ascii", 0, 4), size = chunkHeader.readUInt32LE(4), body = position + 8;
      if (id === "fmt ") {
        const fmt = Buffer.alloc(Math.min(size, 40)); await file.read({ buffer: fmt, position: body });
        if (fmt.readUInt16LE(0) !== 1) throw new Error("Only PCM WAV is supported for waveform preparation");
        format = { channels: fmt.readUInt16LE(2), sampleRate: fmt.readUInt32LE(4), bits: fmt.readUInt16LE(14) };
      } else if (id === "data") { dataOffset = body; dataBytes = size; }
      position = body + size + (size % 2);
    }
    if (!format || format.bits !== 16) throw new Error("Only 16-bit PCM WAV is supported for waveform preparation");
    const frameBytes = format.channels * 2, totalFrames = Math.floor(dataBytes / frameBytes);
    const actualBuckets = Math.min(bucketCount, totalFrames), framesPerBucket = Math.ceil(totalFrames / actualBuckets);
    const buckets: WaveformBucket[] = [];
    const readBuffer = Buffer.alloc(1024 * 1024 - ((1024 * 1024) % frameBytes));
    let frameIndex = 0, bucketMin = 1, bucketMax = -1;
    while (frameIndex < totalFrames) {
      const framesToRead = Math.min(readBuffer.length / frameBytes, totalFrames - frameIndex);
      const bytesToRead = framesToRead * frameBytes;
      const { bytesRead } = await file.read({ buffer: readBuffer, offset: 0, length: bytesToRead, position: dataOffset + frameIndex * frameBytes });
      for (let offset = 0; offset < bytesRead; offset += frameBytes) {
        for (let channel = 0; channel < format.channels; channel += 1) {
          const sample = readBuffer.readInt16LE(offset + channel * 2) / 32768;
          bucketMin = Math.min(bucketMin, sample); bucketMax = Math.max(bucketMax, sample);
        }
        frameIndex += 1;
        if (frameIndex % framesPerBucket === 0 || frameIndex === totalFrames) {
          buckets.push({ min: bucketMin, max: bucketMax }); bucketMin = 1; bucketMax = -1;
        }
      }
    }
    return { schemaVersion: 1, source: sourcePath, sampleRate: format.sampleRate, channels: format.channels, durationSeconds: totalFrames / format.sampleRate, buckets };
  } finally { await file.close(); }
}

export async function writeWaveformSummary(sourcePath: string, destinationPath: string, bucketCount = 2400): Promise<WaveformSummary> {
  const summary = await buildWaveformSummary(sourcePath, bucketCount);
  await writeFile(destinationPath, JSON.stringify(summary), { encoding: "utf8", flag: "wx" });
  return summary;
}

