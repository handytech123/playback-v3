import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDynamicClickEvents } from "../dist/src/domain/grid.js";

const selection = JSON.parse(await readFile(".playback-data/active-arrangement.json", "utf8"));
const setlist = JSON.parse(await readFile(".playback-data/draft-setlist.json", "utf8").catch(() => "{\"items\":[]}"));
const manifestPaths = new Set([selection.manifestPath, ...setlist.items.map(item => item.manifestPath)].filter(Boolean).map(path => resolve(path)));

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let changed = false;
  for (const song of manifest.songs ?? []) {
    const meter = song.timeSignature;
    if (!song.liveAssets?.click || meter?.denominator !== 8 || meter.numerator % 3 !== 0) continue;
    const templateId = meter.numerator === 12 ? "12-8-four-feel" : "6-8-two-feel";
    song.liveAssets.click.templateId = templateId;
    song.liveAssets.click.events = buildDynamicClickEvents(song.selectedBpm, meter, song.durationSeconds, templateId);
    changed = true;
    console.log(`${song.song.title}: ${song.liveAssets.click.events.length} clicks using ${templateId}`);
  }
  if (!changed) continue;
  const temporary = `${manifestPath}.${process.pid}.six-eight.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, manifestPath);
}
