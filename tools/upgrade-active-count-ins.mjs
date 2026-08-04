import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeCountedCue } from "../dist/src/prep/cue-sequence.js";

const selection = JSON.parse(await readFile(".playback-data/active-arrangement.json", "utf8"));
const manifest = JSON.parse(await readFile(selection.manifestPath, "utf8"));
for (const song of manifest.songs) {
  if (!song.liveAssets) continue;
  if (!song.liveAssets.repeatCuePath.endsWith("repeat-command.wav")) {
    const repeatCommandPath = join(dirname(song.liveAssets.repeatCuePath), "repeat-command.wav");
    await copyFile("D:\\Dropbox\\Worship\\Cues\\REPEAT.wav", repeatCommandPath);
    song.liveAssets.repeatCuePath = repeatCommandPath;
  }
  if (song.liveAssets.cueCountVersion !== 1) {
    const processed = new Set();
    for (const cue of song.liveAssets.cues) {
      if (processed.has(cue.audioPath)) continue;
      processed.add(cue.audioPath);
      const temporary = `${cue.audioPath}.${process.pid}.counted.wav`;
      await writeCountedCue({ sourcePath: cue.audioPath, destinationPath: temporary, numberDirectory: "D:\\Dropbox\\Worship\\Cues", bpm: song.selectedBpm, meter: song.timeSignature });
      await rename(temporary, cue.audioPath);
    }
    song.liveAssets.cueCountVersion = 1;
  }
  delete song.liveAssets.countIn;
  console.log(`${song.song.title}: ${song.liveAssets.cues.length} counted cues`);
}
const temporary = `${selection.manifestPath}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
await rename(temporary, selection.manifestPath);
