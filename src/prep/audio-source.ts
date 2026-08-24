import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SUPPORTED_LIBRARY_AUDIO = new Set([".wav", ".m4a", ".mp3", ".aac", ".flac"]);

export function isSupportedLibraryAudio(path: string): boolean {
  return SUPPORTED_LIBRARY_AUDIO.has(extname(path).toLowerCase());
}

export function preparedAudioFilename(path: string): string {
  const extension = extname(path);
  return `${path.slice(0, path.length - extension.length)}.wav`;
}

export async function prepareAudioSource(sourcePath: string, destinationPath: string, ffmpegPath = "ffmpeg"): Promise<void> {
  const extension = extname(sourcePath).toLowerCase();
  if (!SUPPORTED_LIBRARY_AUDIO.has(extension)) throw new Error(`Unsupported library audio format: ${extension || "no extension"}`);
  // Confirmed performance packages have one canonical live format. Library
  // sources may vary, but Performance never performs SRC or compressed decode.
  await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", sourcePath,
    "-map_metadata", "-1", "-vn", "-ar", "48000", "-c:a", "pcm_s24le", destinationPath,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if ((await stat(destinationPath)).size === 0) throw new Error(`Prepared audio is empty: ${sourcePath}`);
  const handle = await open(destinationPath, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 44 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error(`Prepared audio is not a valid WAV file: ${sourcePath}`);
    }
    let offset = 12, verified = false;
    while (offset + 8 <= bytesRead) {
      const id = header.toString("ascii", offset, offset + 4), size = header.readUInt32LE(offset + 4), data = offset + 8;
      if (id === "fmt " && data + 16 <= bytesRead) {
        const encoding = header.readUInt16LE(data), sampleRate = header.readUInt32LE(data + 4), bits = header.readUInt16LE(data + 14);
        const extensiblePcm = encoding === 0xfffe && size >= 40 && data + 26 <= bytesRead && header.readUInt16LE(data + 24) === 1;
        verified = (encoding === 1 || extensiblePcm) && sampleRate === 48000 && bits === 24;
        break;
      }
      offset = data + size + (size & 1);
    }
    if (!verified) throw new Error(`Prepared audio is not PCM24/48 kHz WAV: ${sourcePath}`);
  } finally { await handle.close(); }
}
