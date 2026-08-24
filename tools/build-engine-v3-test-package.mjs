import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sourceManifestPath = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node tools/build-engine-v3-test-package.mjs <confirmed-set.json> [output-folder]");
const outputRoot = resolve(process.argv[3] ?? join(process.cwd(), ".playback-cache", "engine-v3-silent-test"));
const audioRoot = join(outputRoot, "audio");
const ffmpeg = join(process.cwd(), "vendor", "runtime", "ffmpeg.exe");
await mkdir(audioRoot, { recursive: true });
const manifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const converted = new Map();

async function canonical(sourcePath) {
  const source = resolve(sourcePath);
  if (converted.has(source)) return converted.get(source);
  const id = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const destination = join(audioRoot, `${id}-${basename(source).replace(/\.[^.]+$/, "")}.wav`);
  await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source, "-map_metadata", "-1", "-vn", "-ar", "48000", "-c:a", "pcm_s24le", destination], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  converted.set(source, destination);
  process.stdout.write(`CANONICALIZED ${converted.size} ${basename(source)}\n`);
  return destination;
}

for (const song of manifest.songs ?? []) {
  for (const stem of song.stems ?? []) stem.sourcePath = await canonical(stem.sourcePath);
  const live = song.liveAssets;
  if (!live) continue;
  live.click.regularPath = await canonical(live.click.regularPath);
  live.click.accentPath = await canonical(live.click.accentPath);
  live.repeatCuePath = await canonical(live.repeatCuePath);
  live.pad.audioPath = await canonical(live.pad.audioPath);
  for (const cue of live.cues ?? []) cue.audioPath = await canonical(cue.audioPath);
}
manifest.id = `${manifest.id}-engine-v3-silent-test`;
manifest.name = `${manifest.name} - Engine V3 Silent Test`;
manifest.confirmedAt = new Date().toISOString();
manifest.testPackage = { sourceManifestPath, canonicalFormat: "PCM24/48000", productionSetUnchanged: true };
const destinationManifest = join(outputRoot, "confirmed-set.json");
await writeFile(destinationManifest, JSON.stringify(manifest, null, 2));
process.stdout.write(`ENGINE_V3_TEST_PACKAGE manifest=${destinationManifest} assets=${converted.size}\n`);
