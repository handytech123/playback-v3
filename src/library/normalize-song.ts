import { songId, type AudioStem, type Cue, type OriginalSongFacts, type PreparedSong, type Region, type TimeSignature } from "../domain/song.js";

export interface MasterSongRow {
  readonly catalogId: string;
  readonly title: string;
  readonly artist: string;
  readonly vendor: string;
  readonly bpm: number;
  readonly key: string | null;
  readonly timeSignature: string;
  readonly folderPath: string;
}

export interface AnalyzerAudioFile {
  readonly path: string;
  readonly durationSeconds: number;
  readonly playbackRole: string;
  readonly playLive: boolean;
  readonly sha256: string;
}

export interface AnalyzerSongMetadata {
  readonly songId: string;
  readonly title?: string;
  readonly artist?: string;
  readonly vendor?: string;
  readonly bpm?: number;
  readonly key?: string;
  readonly keyStatus?: "confirmed" | "estimated" | "unknown" | "conflict";
  readonly timeSignature?: string;
  readonly durationSeconds: number;
  readonly wavFiles: readonly AnalyzerAudioFile[];
}

export interface AnalyzerRegionFile {
  readonly regions: readonly {
    readonly id: string;
    readonly name: string;
    readonly startTimeSeconds: number;
    readonly endTimeSeconds: number;
  }[];
}

export interface NormalizeResult {
  readonly preparedSong: PreparedSong;
  readonly warnings: readonly string[];
}

export function normalizeOriginalSong(
  master: MasterSongRow,
  analyzer: AnalyzerSongMetadata,
  regionFile: AnalyzerRegionFile,
): NormalizeResult {
  const warnings: string[] = [];
  compareFact(warnings, "title", master.title, analyzer.title);
  compareFact(warnings, "artist", master.artist, analyzer.artist);
  compareFact(warnings, "vendor", master.vendor, analyzer.vendor);
  compareFact(warnings, "BPM", master.bpm, analyzer.bpm);
  compareFact(warnings, "time signature", master.timeSignature, analyzer.timeSignature);
  if (master.key) compareFact(warnings, "key", master.key, analyzer.key);

  const approvedAnalyzerKey = analyzer.keyStatus === "confirmed" ? analyzer.key : undefined;
  const selectedKey = master.key ?? approvedAnalyzerKey;
  if (!selectedKey) throw new Error(analyzer.key?"Detected key requires operator approval before Confirm Set":"Key is missing from both master spreadsheet and approved analyzer metadata");
  if (!master.key) warnings.push("Master key is missing; using explicitly approved analyzer key");

  const facts: OriginalSongFacts = {
    id: songId(master.catalogId || analyzer.songId),
    title: master.title,
    artist: master.artist,
    vendor: master.vendor,
    originalKey: selectedKey,
    originalBpm: master.bpm,
    originalTimeSignature: parseTimeSignature(master.timeSignature),
  };

  const stems: AudioStem[] = analyzer.wavFiles
    .filter((audio) => audio.playLive && !["click-reference", "cue-reference", "pad-stem"].includes(audio.playbackRole))
    .map((audio) => ({
      role: audio.playbackRole,
      sourcePath: joinWindowsPath(master.folderPath, audio.path),
      durationSeconds: audio.durationSeconds,
    }));

  const regions: Region[] = regionFile.regions.map((region) => ({
    id: region.id,
    name: region.name,
    startSeconds: region.startTimeSeconds,
    endSeconds: region.endTimeSeconds,
  }));
  validateRegions(regions, analyzer.durationSeconds);
  const finalRegion = regions.at(-1);
  if (finalRegion && finalRegion.endSeconds < analyzer.durationSeconds) {
    regions[regions.length - 1] = { ...finalRegion, endSeconds: analyzer.durationSeconds };
  }

  const cues: Cue[] = regions.slice(1).map((region) => ({
    phrase: region.name.replace(/\s+\d+$/, ""),
    atSeconds: region.startSeconds,
    targetRegionId: region.id,
  }));

  return {
    preparedSong: {
      song: facts,
      selectedKey,
      selectedBpm: master.bpm,
      timeSignature: facts.originalTimeSignature,
      durationSeconds: analyzer.durationSeconds,
      stems,
      regions,
      cues,
      cacheFingerprint: analyzer.wavFiles.map((audio) => audio.sha256).sort().join(":"),
    },
    warnings,
  };
}

export function parseTimeSignature(value: string): TimeSignature {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time signature: ${value}`);
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

function compareFact(warnings: string[], label: string, master: unknown, analyzer: unknown): void {
  if (analyzer !== undefined && master !== analyzer) {
    warnings.push(`Analyzer ${label} differs from master; master value retained`);
  }
}

function validateRegions(regions: readonly Region[], duration: number): void {
  let previousEnd = 0;
  for (const region of regions) {
    if (region.startSeconds < previousEnd || region.endSeconds <= region.startSeconds || region.endSeconds > duration) {
      throw new Error(`Invalid or overlapping analyzer region: ${region.name}`);
    }
    previousEnd = region.endSeconds;
  }
}

function joinWindowsPath(folder: string, child: string): string {
  return `${folder.replace(/[\\/]$/, "")}\\${child.replace(/^[\\/]/, "")}`;
}
