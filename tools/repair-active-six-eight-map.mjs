import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildDynamicClickEvents, secondsPerNotatedBeat } from "../dist/src/domain/grid.js";
import { normalizeRegions } from "../dist/src/edit/song-map.js";
import { writeCountedCue } from "../dist/src/prep/cue-sequence.js";

const cueSourceDirectory = "D:\\Dropbox\\Worship\\Cues";
const ffmpegPath = resolve("vendor/runtime/ffmpeg.exe");
const selection = JSON.parse(await readFile(".playback-data/active-arrangement.json", "utf8"));
const setlist = JSON.parse(await readFile(".playback-data/draft-setlist.json", "utf8"));
const paths = new Set([selection.manifestPath, ...setlist.items.map(item => item.manifestPath)].filter(Boolean).map(path => resolve(path)));

for (const manifestPath of paths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let changed = false;
  for (const song of manifest.songs ?? []) {
    const meter = song.timeSignature;
    if (!song.liveAssets || meter?.numerator !== 6 || meter.denominator !== 8) continue;
    const countIn = song.regions.find(region => region.id === "review-count-in" || /^count in$/i.test(region.name));
    const structural = song.regions.filter(region => region !== countIn).map(region => ({ ...region, name: repairAnalyzerLabel(region.name) }));
    const numbered = normalizeRegions(structural).map(({ id, name, startSeconds, endSeconds }) => ({ id, name, startSeconds, endSeconds }));
    song.regions = countIn ? [{ ...countIn, name: "Count In" }, ...numbered] : numbered;

    const measureSeconds = secondsPerNotatedBeat(song.selectedBpm, meter) * meter.numerator;
    const cueDirectory = join(dirname(manifestPath), "live-assets", "cues");
    await mkdir(cueDirectory, { recursive: true });
    const rendered = new Map();
    const metadataCues = [];
    const liveCues = [];
    for (const region of numbered) {
      const phrase = region.name.replace(/\s+\d+$/, "");
      const atSeconds = Math.max(0, region.startSeconds - measureSeconds);
      let audioPath = rendered.get(phrase);
      if (!audioPath) {
        const sourcePath = await cueSourcePath(phrase);
        audioPath = join(cueDirectory, `${safe(phrase)}.wav`);
        const temporary = `${audioPath}.${process.pid}.six-eight.wav`;
        await writeCountedCue({ sourcePath, destinationPath: temporary, numberDirectory: cueSourceDirectory, bpm: song.selectedBpm, meter, ffmpegPath });
        await rename(temporary, audioPath);
        rendered.set(phrase, audioPath);
      }
      metadataCues.push({ phrase, atSeconds, targetRegionId: region.id });
      liveCues.push({ label: phrase, atSeconds, audioPath, targetRegionId: region.id });
    }
    song.cues = metadataCues;
    song.liveAssets.cues = liveCues;
    song.liveAssets.click.events = buildDynamicClickEvents(song.selectedBpm, meter, song.durationSeconds);
    song.liveAssets.cueCountVersion = 2;
    changed = true;
    console.log(`${song.song.title}: ${numbered.length} regions, ${liveCues.length} full-measure cues`);
  }
  if (!changed) continue;
  const temporary = `${manifestPath}.${process.pid}.six-eight-map.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, manifestPath);
}

function repairAnalyzerLabel(value) {
  return String(value).replace(/^(verse|chorus|bridge)\s+to$/i, "$1").replace(/^out\s+row$/i, "Outro");
}

async function cueSourcePath(phrase) {
  const upper = phrase.toUpperCase();
  const aliases = { TURNAROUND: ["TURN AROUND.wav", "TURNAROUND.wav"], OUTRO: ["OUTRO.wav"], "PRE CHORUS": ["PRE CHORUS.wav"] };
  const candidates = aliases[upper] ?? [`${upper}.wav`, `${upper.replace(/\s+/g, "")}.wav`];
  for (const name of candidates) {
    const path = join(cueSourceDirectory, name);
    try { if ((await stat(path)).isFile()) return path; } catch {}
  }
  throw new Error(`Missing 6/8 cue phrase source: ${phrase}`);
}

function safe(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cue";
}
