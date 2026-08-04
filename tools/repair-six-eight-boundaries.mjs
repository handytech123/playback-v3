import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const selection = JSON.parse(await readFile(".playback-data/active-arrangement.json", "utf8"));
const setlist = JSON.parse(await readFile(".playback-data/draft-setlist.json", "utf8"));
const sourcePaths = [...new Set(setlist.items.map(item => resolve(item.manifestPath)))];
const canonical = new Map();

for (const manifestPath of sourcePaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let changed = false;
  for (const song of manifest.songs ?? []) {
    if (!isCompound(song)) continue;
    repairSong(song);
    canonical.set(String(song.song.id), song.regions.map(region => ({ ...region })));
    changed = true;
  }
  if (changed) await atomicWrite(manifestPath, manifest);
}

const activePath = resolve(selection.manifestPath);
if (!sourcePaths.includes(activePath)) {
  const manifest = JSON.parse(await readFile(activePath, "utf8"));
  let changed = false;
  for (const song of manifest.songs ?? []) {
    const regions = canonical.get(String(song.song.id));
    if (!regions) continue;
    song.regions = regions.map(region => ({ ...region }));
    retimeCues(song);
    changed = true;
  }
  if (changed) await atomicWrite(activePath, manifest);
}

function isCompound(song) {
  return song.timeSignature?.denominator === 8 && song.timeSignature.numerator % 3 === 0 && song.timeSignature.numerator > 3;
}

function repairSong(song) {
  const measureSeconds = (60 / song.selectedBpm) * song.timeSignature.numerator;
  const countIn = song.regions.find(region => region.id === "review-count-in" || /^count in$/i.test(region.name));
  const structural = song.regions.filter(region => region !== countIn).map(region => ({ ...region }));
  const starts = structural.map(region => Math.round(region.startSeconds / measureSeconds) * measureSeconds);
  song.regions = structural.map((region, index) => ({ ...region, startSeconds: starts[index], endSeconds: starts[index + 1] ?? song.durationSeconds }));
  if (countIn && starts[0] > 0) song.regions.unshift({ ...countIn, name: "Count In", startSeconds: 0, endSeconds: starts[0] });
  retimeCues(song);
}

function retimeCues(song) {
  const measureSeconds = (60 / song.selectedBpm) * song.timeSignature.numerator;
  const timings = new Map(song.regions.filter(region => !/^count in$/i.test(region.name)).map(region => [region.id, Math.max(0, region.startSeconds - measureSeconds)]));
  song.cues = (song.cues ?? []).filter(cue => timings.has(cue.targetRegionId)).map(cue => ({ ...cue, atSeconds: timings.get(cue.targetRegionId) }));
  if (song.liveAssets?.cues) song.liveAssets.cues = song.liveAssets.cues.filter(cue => timings.has(cue.targetRegionId)).map(cue => ({ ...cue, atSeconds: timings.get(cue.targetRegionId) }));
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.boundary.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, path);
  console.log(`Repaired ${path}`);
}
