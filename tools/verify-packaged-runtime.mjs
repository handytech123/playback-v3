import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

const required = [
  ["FFmpeg", "vendor/runtime/ffmpeg.exe", 1_000_000],
  ["FFmpeg license", "vendor/runtime/FFMPEG-LICENSE.txt", 1],
  ["Rubber Band", "vendor/runtime/rubberband.exe", 100_000],
  ["native Playback engine", "native/build/PlaybackEngineProbe_artefacts/Release/PlaybackEngineProbe.exe", 1_000_000],
];

const missing = [];
for (const [label, relativePath, minimumBytes] of required) {
  const path = resolve(relativePath);
  try {
    await access(path);
    const file = await stat(path);
    if (!file.isFile() || file.size < minimumBytes) missing.push(`${label}: ${path} is incomplete`);
  } catch {
    missing.push(`${label}: ${path} is missing`);
  }
}

if (missing.length) {
  throw new Error(`Playback installer cannot be built without its required runtime:\n${missing.join("\n")}`);
}
console.log("Packaged audio runtime verified.");
