import { open, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export interface WaveformBucket { readonly min: number; readonly max: number; }
export interface WaveformSummary {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationSeconds: number;
  readonly buckets: readonly WaveformBucket[];
}

interface WaveFormat {
  readonly encoding: 1 | 3;
  readonly channels: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly bits: number;
}

function parseWaveFormat(fmt: Buffer): WaveFormat {
  if (fmt.length < 16) throw new Error("WAV format chunk is incomplete");
  let encoding = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  const blockAlign = fmt.readUInt16LE(12);
  const bits = fmt.readUInt16LE(14);

  // WAVE_FORMAT_EXTENSIBLE stores the real encoding in the SubFormat GUID.
  if (encoding === 0xfffe) {
    if (fmt.length < 40) throw new Error("Extensible WAV format chunk is incomplete");
    encoding = fmt.readUInt16LE(24);
  }
  if (encoding !== 1 && encoding !== 3) throw new Error(`Unsupported WAV encoding ${encoding} for waveform preparation`);
  if (!channels || !sampleRate || !blockAlign) throw new Error("WAV format contains invalid channel, rate, or alignment data");
  if (encoding === 1 && ![8, 16, 24, 32].includes(bits)) throw new Error(`Unsupported ${bits}-bit PCM WAV for waveform preparation`);
  if (encoding === 3 && ![32, 64].includes(bits)) throw new Error(`Unsupported ${bits}-bit float WAV for waveform preparation`);
  const bytesPerSample = bits / 8;
  if (!Number.isInteger(bytesPerSample) || blockAlign < channels * bytesPerSample) throw new Error("WAV block alignment is invalid");
  return { encoding, channels, sampleRate, blockAlign, bits };
}

function readSample(buffer: Buffer, offset: number, format: WaveFormat): number {
  let sample: number;
  if (format.encoding === 3) {
    sample = format.bits === 32 ? buffer.readFloatLE(offset) : buffer.readDoubleLE(offset);
  } else if (format.bits === 8) {
    sample = (buffer.readUInt8(offset) - 128) / 128;
  } else if (format.bits === 16) {
    sample = buffer.readInt16LE(offset) / 32768;
  } else if (format.bits === 24) {
    let value = buffer.readUIntLE(offset, 3);
    if (value & 0x800000) value -= 0x1000000;
    sample = value / 8388608;
  } else {
    sample = buffer.readInt32LE(offset) / 2147483648;
  }
  return Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
}

export async function buildWaveformSummary(sourcePath: string, bucketCount = 2400): Promise<WaveformSummary> {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) throw new Error("Waveform bucket count must be positive");
  const file = await open(sourcePath, "r");
  try {
    const fileSize = (await file.stat()).size;
    const header = Buffer.alloc(12);
    const headerRead = await file.read({ buffer: header, position: 0 });
    if (headerRead.bytesRead < 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Not a RIFF/WAVE file");
    }

    let position = 12;
    let format: WaveFormat | null = null;
    let dataOffset = 0;
    let dataBytes = 0;
    const chunkHeader = Buffer.alloc(8);
    while (position + 8 <= fileSize && (!format || !dataOffset)) {
      const read = await file.read({ buffer: chunkHeader, position });
      if (read.bytesRead < 8) break;
      const id = chunkHeader.toString("ascii", 0, 4);
      const declaredSize = chunkHeader.readUInt32LE(4);
      const body = position + 8;
      const availableSize = Math.max(0, Math.min(declaredSize, fileSize - body));
      if (id === "fmt ") {
        const fmt = Buffer.alloc(Math.min(availableSize, 64));
        const fmtRead = await file.read({ buffer: fmt, position: body });
        format = parseWaveFormat(fmt.subarray(0, fmtRead.bytesRead));
      } else if (id === "data") {
        dataOffset = body;
        dataBytes = availableSize;
      }
      position = body + declaredSize + (declaredSize % 2);
    }
    if (!format) throw new Error("WAV format chunk is missing");
    if (!dataOffset || !dataBytes) throw new Error("WAV data chunk is missing or empty");

    const bytesPerSample = format.bits / 8;
    const totalFrames = Math.floor(dataBytes / format.blockAlign);
    if (!totalFrames) throw new Error("WAV contains no complete audio frames");
    const actualBuckets = Math.min(bucketCount, totalFrames);
    const framesPerBucket = Math.ceil(totalFrames / actualBuckets);
    const buckets: WaveformBucket[] = [];
    const bufferSize = Math.max(format.blockAlign, Math.floor((1024 * 1024) / format.blockAlign) * format.blockAlign);
    const readBuffer = Buffer.alloc(bufferSize);
    let frameIndex = 0;
    let bucketMin = 1;
    let bucketMax = -1;
    while (frameIndex < totalFrames) {
      const framesToRead = Math.min(Math.floor(readBuffer.length / format.blockAlign), totalFrames - frameIndex);
      const bytesToRead = framesToRead * format.blockAlign;
      const { bytesRead } = await file.read({
        buffer: readBuffer,
        offset: 0,
        length: bytesToRead,
        position: dataOffset + frameIndex * format.blockAlign,
      });
      const completeFrames = Math.floor(bytesRead / format.blockAlign);
      if (!completeFrames) break;
      for (let localFrame = 0; localFrame < completeFrames; localFrame += 1) {
        const frameOffset = localFrame * format.blockAlign;
        for (let channel = 0; channel < format.channels; channel += 1) {
          const sample = readSample(readBuffer, frameOffset + channel * bytesPerSample, format);
          bucketMin = Math.min(bucketMin, sample);
          bucketMax = Math.max(bucketMax, sample);
        }
        frameIndex += 1;
        if (frameIndex % framesPerBucket === 0 || frameIndex === totalFrames) {
          buckets.push({ min: bucketMin, max: bucketMax });
          bucketMin = 1;
          bucketMax = -1;
        }
      }
    }
    if (frameIndex !== totalFrames) throw new Error("WAV audio data ended unexpectedly");
    return {
      schemaVersion: 1,
      source: sourcePath,
      sampleRate: format.sampleRate,
      channels: format.channels,
      durationSeconds: totalFrames / format.sampleRate,
      buckets,
    };
  } finally {
    await file.close();
  }
}

export async function writeWaveformSummary(sourcePath: string, destinationPath: string, bucketCount = 2400): Promise<WaveformSummary> {
  const summary = await buildWaveformSummary(sourcePath, bucketCount);
  await writeFile(destinationPath, JSON.stringify(summary), { encoding: "utf8", flag: "wx" });
  return summary;
}

export async function buildCombinedWaveformSummary(sourcePaths: readonly string[], bucketCount = 2400): Promise<WaveformSummary> {
  if (!sourcePaths.length) throw new Error("At least one playable stem is required for a combined waveform");
  const summaries = await Promise.all(sourcePaths.map((path) => buildWaveformSummary(path, bucketCount)));
  const durationSeconds = Math.max(...summaries.map((summary) => summary.durationSeconds));
  const actualBuckets = Math.min(bucketCount, Math.max(...summaries.map((summary) => summary.buckets.length)));
  const buckets: WaveformBucket[] = [];
  for (let index = 0; index < actualBuckets; index += 1) {
    const atSeconds = ((index + 0.5) / actualBuckets) * durationSeconds;
    let min = 0;
    let max = 0;
    for (const summary of summaries) {
      if (atSeconds >= summary.durationSeconds || !summary.buckets.length) continue;
      const sourceIndex = Math.min(summary.buckets.length - 1, Math.floor((atSeconds / summary.durationSeconds) * summary.buckets.length));
      const sourceBucket = summary.buckets[sourceIndex]!;
      min = Math.min(min, sourceBucket.min);
      max = Math.max(max, sourceBucket.max);
    }
    buckets.push({ min, max });
  }
  return {
    schemaVersion: 1,
    source: `combined:${sourcePaths.map((path) => basename(path)).join("|")}`,
    sampleRate: Math.max(...summaries.map((summary) => summary.sampleRate)),
    channels: summaries.reduce((total, summary) => total + summary.channels, 0),
    durationSeconds,
    buckets,
  };
}

export async function writeCombinedWaveformSummary(sourcePaths: readonly string[], destinationPath: string, bucketCount = 2400): Promise<WaveformSummary> {
  const summary = await buildCombinedWaveformSummary(sourcePaths, bucketCount);
  await writeFile(destinationPath, JSON.stringify(summary), { encoding: "utf8", flag: "wx" });
  return summary;
}
