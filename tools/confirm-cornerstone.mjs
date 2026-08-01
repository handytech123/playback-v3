import fs from "node:fs/promises";
import path from "node:path";
import { normalizeOriginalSong } from "../dist/src/library/normalize-song.js";
import { confirmSet } from "../dist/src/confirmed-set/prepare.js";
import { buildZeroBasedGrid } from "../dist/src/domain/grid.js";
import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";
import { productionDefaults } from "../dist/src/config/settings.js";

const sourceFolder = "D:\\Dropbox\\Worship\\Backing Tracks\\Loop Community\\Cornerstone - Hillsong Worship";
const cacheRoot = path.resolve(".playback-cache");
const analyzer = JSON.parse(await fs.readFile(path.join(sourceFolder, "song-metadata.json"), "utf8"));
const regions = JSON.parse(await fs.readFile(path.join(sourceFolder, "analysis", "regions.json"), "utf8"));
const cueIntelligence = JSON.parse(await fs.readFile(path.join(sourceFolder, "analysis", "cue-intelligence.json"), "utf8"));
const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
const master = catalog.songs.find((song) => song.title === "Cornerstone" && song.artist === "Hillsong Worship");
if (!master) throw new Error("Cornerstone is missing from the production master workbook");

const normalized = normalizeOriginalSong(master, analyzer, regions);
const liveByPath = new Map(analyzer.wavFiles.map((file) => [file.path, file]));
const stems = normalized.preparedSong.stems.map((stem) => {
  const relativePath = path.basename(stem.sourcePath);
  const source = liveByPath.get(relativePath);
  if (!source) throw new Error(`Analyzer inventory missing ${relativePath}`);
  return { relativePath, role: source.playbackRole, durationSeconds: source.durationSeconds, sha256: source.sha256 };
});
const cueFolder = "D:\\Dropbox\\Worship\\Cues";
const cueAliases = new Map([["Turnaround", "TURN AROUND.wav"]]);
const cueSources = cueIntelligence.cues.map((cue) => {
  const region = normalized.preparedSong.regions.find((item) => Math.abs(item.startSeconds - cue.predictedRegionStart.timeSeconds) < 0.01)
    ?? (cue.label === "End" ? normalized.preparedSong.regions.at(-1) : undefined);
  if (!region) throw new Error(`No target region for cue ${cue.label}`);
  return { atSeconds: cue.detectedGridTimeSeconds, label: cue.label, sourcePath: path.join(cueFolder, cueAliases.get(cue.label) ?? `${cue.label.toUpperCase()}.wav`), targetRegionId: region.id };
});
const clickEvents = buildZeroBasedGrid(master.bpm, normalized.preparedSong.timeSignature, normalized.preparedSong.durationSeconds)
  .map((position) => ({ atSeconds: position.timeSeconds, accent: position.beat === 1 }));

const result = await confirmSet({
  setId: "milestone-1-cornerstone-performance-v3",
  setName: "Milestone 1 - Cornerstone",
  cacheRoot,
  songs: [{ preparedSong: normalized.preparedSong, sourceFolder, stems, liveAssets: {
    click: { regularPath: "D:\\Dropbox\\Worship\\Click\\CLICK.wav", accentPath: "D:\\Dropbox\\Worship\\Click\\CLICK ACCENT.wav", events: clickEvents },
    cues: cueSources,
    repeatCuePath: path.join(cueFolder, "REPEAT.wav"),
    pad: { key: normalized.preparedSong.selectedKey, sourcePath: "D:\\Dropbox\\Worship\\Pads\\Pad_C.wav" },
  } }],
});
console.log(JSON.stringify({
  manifestPath: result.manifestPath,
  ready: result.readiness.ready,
  songCount: result.manifest.songs.length,
  stemCount: result.manifest.songs[0].stems.length,
  copiedBytes: result.copiedBytes,
  warnings: normalized.warnings,
}, null, 2));
