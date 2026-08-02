import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const SUPPORTED_LIBRARY_AUDIO = new Set([".wav", ".m4a"]);

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
  if (extension === ".wav") {
    await pipeline(createReadStream(sourcePath), createWriteStream(destinationPath, { flags: "wx" }));
  } else {
    await run(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", sourcePath,
      "-map_metadata", "-1", "-vn", "-c:a", "pcm_s16le", destinationPath,
    ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  }
  if ((await stat(destinationPath)).size === 0) throw new Error(`Prepared audio is empty: ${sourcePath}`);
  const handle = await open(destinationPath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error(`Prepared audio is not a valid WAV file: ${sourcePath}`);
    }
  } finally { await handle.close(); }
}
