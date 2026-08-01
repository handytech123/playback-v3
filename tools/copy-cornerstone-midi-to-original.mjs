import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, ".playback-cache", "arrangements", "reaper-72091bdc9061", "performance", "confirmed-set.json");
const targetPath = path.join(root, ".playback-cache", "milestone-1-cornerstone-performance-v3", "confirmed-set.json");

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const target = JSON.parse(await readFile(targetPath, "utf8"));
const sourceSong = source.songs?.[0];
const targetSong = target.songs?.[0];
const midi = sourceSong?.arrangement?.proPresenterMidi;

if (!sourceSong || !targetSong) throw new Error("Cornerstone source or Original Song is missing");
if (sourceSong.song.id !== targetSong.song.id) throw new Error("MIDI can only be copied between the same song identity");
if (sourceSong.selectedBpm !== targetSong.selectedBpm) throw new Error("Source and Original Song BPM do not match");
if (JSON.stringify(sourceSong.timeSignature) !== JSON.stringify(targetSong.timeSignature)) throw new Error("Source and Original Song meter do not match");
if (!Array.isArray(midi) || midi.length === 0) throw new Error("Cornerstone B has no prepared Slides MIDI");

let previousTime = -1;
for (const [index, event] of midi.entries()) {
  if (!Number.isFinite(event.atSeconds) || event.atSeconds < previousTime || event.atSeconds > targetSong.durationSeconds) throw new Error(`MIDI event ${index + 1} is outside the ordered Original Song timeline`);
  for (const field of ["status", "data1", "data2"]) if (!Number.isInteger(event[field]) || event[field] < 0 || event[field] > 255) throw new Error(`MIDI event ${index + 1} has invalid ${field}`);
  previousTime = event.atSeconds;
}

const immutableFacts = JSON.stringify({ song: targetSong.song, key: targetSong.selectedKey, bpm: targetSong.selectedBpm, meter: targetSong.timeSignature, duration: targetSong.durationSeconds, stems: targetSong.stems });
const endCue = targetSong.liveAssets?.cues?.find((cue) => cue.label.toLowerCase() === "end");
const finalRegion = targetSong.regions.at(-1);
let repairedTail = false;
if (finalRegion && finalRegion.endSeconds < targetSong.durationSeconds - .05 && endCue) {
  const measureSeconds = 60 / targetSong.selectedBpm * targetSong.timeSignature.numerator;
  const endStart = Math.round((endCue.atSeconds + measureSeconds) * 1e6) / 1e6;
  if (endStart <= finalRegion.startSeconds || endStart >= targetSong.durationSeconds) throw new Error("Original Song End boundary could not be derived from its cue marker");
  finalRegion.endSeconds = endStart;
  const endRegionId = `region-${String(targetSong.regions.length + 1).padStart(4, "0")}`;
  targetSong.regions.push({ id: endRegionId, name: "End", startSeconds: endStart, endSeconds: targetSong.durationSeconds });
  targetSong.cues.push({ phrase: "End", atSeconds: endStart, targetRegionId: endRegionId });
  endCue.targetRegionId = endRegionId;
  repairedTail = true;
}
targetSong.control = {
  sourceType: "reaper-import",
  sourceSha256: sourceSong.arrangement.sourceSha256,
  proPresenterMidi: structuredClone(midi),
  midiOutputName: sourceSong.arrangement.midiOutputName ?? null,
};
if (targetSong.arrangement?.id === "original-song-midi") delete targetSong.arrangement;
const preservedFacts = JSON.stringify({ song: targetSong.song, key: targetSong.selectedKey, bpm: targetSong.selectedBpm, meter: targetSong.timeSignature, duration: targetSong.durationSeconds, stems: targetSong.stems });
if (preservedFacts !== immutableFacts) throw new Error("Original Song identity, musical facts, duration, or audio changed while copying MIDI");

const temporaryPath = `${targetPath}.midi-${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
await rename(temporaryPath, targetPath);

console.log(JSON.stringify({
  ready: true,
  source: source.name,
  target: "Original Song",
  events: midi.length,
  firstEventSeconds: midi[0].atSeconds,
  lastEventSeconds: midi.at(-1).atSeconds,
  targetDurationSeconds: targetSong.durationSeconds,
  originalFactsPreserved: true,
  repairedTail,
  regions: targetSong.regions.length,
  targetPath,
}, null, 2));
