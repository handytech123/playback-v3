import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { DEFAULT_SHOW_STATE, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { buildDynamicClickEvents, secondsPerNotatedBeat } from "../domain/grid.js";
import { songId, type PreparedSong, type Region, type TimeSignature } from "../domain/song.js";
import { loadOrBuildEditorWaveforms } from "../edit/editor-workspace.js";
import { isSupportedLibraryAudio } from "../prep/audio-source.js";
import { normalizeRegions } from "../edit/song-map.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import { parseTimeSignature, type MasterSongRow } from "./normalize-song.js";
import { loadSharedCandidateIndex } from "./shared-candidate-index.js";

export const ANALYZER_SONG_MAP_VERSION = 5;

export async function prepareCandidateReview(input: {
  readonly catalogId: string;
  readonly sharedMetadataRoot: string;
  readonly libraryRoot: string;
  readonly cacheRoot: string;
  readonly clickFolder: string;
  readonly cueFolder: string;
  readonly padFolder: string;
  readonly ffmpegPath: string;
  readonly master: MasterSongRow;
}): Promise<{ manifestPath: string; manifest: ConfirmedSetManifest }> {
  const index = await loadSharedCandidateIndex(input.sharedMetadataRoot);
  const entry = index?.entries.find(item => item.catalogId === input.catalogId);
  if (!entry || entry.status !== "review" || !entry.candidateFile) throw new Error("This Original Song does not have a synchronized analyzer candidate");

  const candidate = JSON.parse(await readFile(join(input.sharedMetadataRoot, ...entry.candidateFile.split("/")), "utf8"));
  const sourceFolder = join(input.libraryRoot, ...entry.folderRelativePath.split("/"));
  const sourceFiles = (await readdir(sourceFolder, { withFileTypes: true })).filter(item => item.isFile() && isSupportedLibraryAudio(item.name) && !isReferenceAudio(item.name));
  if (!sourceFiles.length) throw new Error("No playable music file is available for Editor review");

  const duration = Number(candidate.audioEvidence?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Analyzer candidate duration is unavailable");
  const selectedKey = normalizeReviewKey(input.master.key ?? candidate.keyEvidence?.estimate);
  if (!selectedKey) throw new Error("A key estimate is required before this song can open in Editor review");

  const meter = parseTimeSignature(input.master.timeSignature);
  const reviewRoot = join(input.cacheRoot, safeId(input.catalogId));
  const waveformPath = join(reviewRoot, "waveform.json");
  const bundlePath = join(reviewRoot, "editor-waveforms.json");
  const manifestPath = join(reviewRoot, "confirmed-set.json");
  await mkdir(reviewRoot, { recursive: true });

  const drafts = candidate.regionDraft ?? [];
  const stems = sourceFiles.map(file => ({ role: "music-stem", sourcePath: join(sourceFolder, file.name), durationSeconds: duration }));
  const regions = reviewRegions(drafts, duration, input.master.bpm, meter);
  const warningSeconds = secondsPerNotatedBeat(input.master.bpm, meter) * meter.numerator;
  const cueMarkers = reviewCueMarkers(regions, warningSeconds);
  const cuePlan = await reviewCuePlan(cueMarkers, input.cueFolder, join(reviewRoot,"live-assets","cues"), input.master.bpm, meter, input.ffmpegPath);
  const resolvedCueTargets = new Set(cuePlan.map(cue => cue.targetRegionId));
  const missingCueLabels = cueMarkers.filter(cue => !resolvedCueTargets.has(cue.targetRegionId)).map(cue => cue.label);
  const song: PreparedSong = {
    song: {
      id: songId(input.master.catalogId),
      title: input.master.title,
      artist: input.master.artist,
      vendor: input.master.vendor,
      originalKey: selectedKey,
      originalBpm: input.master.bpm,
      originalTimeSignature: meter,
    },
    selectedKey,
    selectedBpm: input.master.bpm,
    timeSignature: meter,
    durationSeconds: duration,
    stems,
    regions,
    cues: cueMarkers.map(cue => ({ phrase: cue.label, atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId })),
    cacheFingerprint: (candidate.audioEvidence?.files ?? []).map((file: any) => String(file.sha256 ?? "")).filter(Boolean).sort().join(":"),
    waveformPath,
    liveAssets: {
      click: {
        regularPath: join(input.clickFolder, "CLICK.wav"),
        accentPath: join(input.clickFolder, "CLICK ACCENT.wav"),
        events: buildDynamicClickEvents(input.master.bpm, meter, duration),
      },
      cues: cuePlan,
      cueCountVersion: 2,
      repeatCuePath: join(input.cueFolder, "REPEAT.wav"),
      pad: { key: selectedKey, audioPath: join(input.padFolder, `Pad_${padFileKey(selectedKey)}.wav`) },
    },
  };

  const bundle = await loadOrBuildEditorWaveforms(song, bundlePath, 2400, input.ffmpegPath);
  await writeFile(waveformPath, JSON.stringify({ schemaVersion: 1, source: stems[0]!.sourcePath, sampleRate: 0, channels: 0, durationSeconds: duration, buckets: bundle.summary }));
  const manifest = {
    schemaVersion: 1,
    id: `review-${safeId(input.catalogId)}`,
    name: `Review · ${input.master.title}`,
    confirmedAt: new Date().toISOString(),
    songs: [song],
    show: DEFAULT_SHOW_STATE,
    review: { status: "needs-review", catalogId: input.catalogId, performanceEligible: false, songMapVersion: ANALYZER_SONG_MAP_VERSION, missingCueLabels },
  } as ConfirmedSetManifest;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, manifest };
}

function isReferenceAudio(name: string) {
  return /(?:^|[_\s-])(click|cue|cues|count|guide|reference|ref|pad)(?:$|[_\s-])/i.test(basename(name, extname(name)));
}

export function normalizeReviewKey(value: unknown) {
  const match = String(value ?? "").trim().match(/^([A-G](?:#|b)?)(?:\s*(major|minor)|([mM]))?/i);
  if (!match) return null;
  const root = `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}`;
  return match[2]?.toLowerCase() === "minor" || match[3] === "m" ? `${root}m` : root;
}

function padFileKey(key: string) {
  const tonalCenter = key.replace(/m$/i, "");
  return ({ "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" } as Record<string, string>)[tonalCenter] ?? tonalCenter;
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

export function reviewRegions(drafts: readonly any[], duration: number, bpm: number, meter: TimeSignature): Region[] {
  const beatSeconds = secondsPerNotatedBeat(bpm, meter);
  const measureSeconds = beatSeconds * meter.numerator;
  const points = drafts.map((item, index) => {
    const measure = Number(item.measure);
    const beat = Number(item.beat);
    const rawCue = Number(item.cueAtSeconds);
    const rawBoundary = Number.isFinite(rawCue)
      ? rawCue + measureSeconds
      : Number.isInteger(measure) && measure >= 1 && Number.isInteger(beat) && beat >= 1 && beat <= meter.numerator
        ? (measure * meter.numerator + (beat - 1)) * beatSeconds
        : Number(item.startSeconds);
    // Analyzer cue speech can begin partway through its warning measure. Regions,
    // however, are musical boundaries and must land on the first beat of a measure.
    const gridSeconds = Math.round(rawBoundary / measureSeconds) * measureSeconds;
    return { id: String(item.id ?? `review-${index + 1}`), name: reviewName(item.name, index), startSeconds: gridSeconds };
  }).filter(item => Number.isFinite(item.startSeconds) && item.startSeconds >= 0 && item.startSeconds < duration).sort((a, b) => a.startSeconds - b.startSeconds);
  const mapped = points.map((item, index) => ({ ...item, endSeconds: points[index + 1]?.startSeconds ?? duration })).filter(item => item.endSeconds - item.startSeconds > .001);
  const numbered = normalizeRegions(mapped).map(({ id, name, startSeconds, endSeconds }) => ({ id, name, startSeconds, endSeconds }));
  if (numbered[0] && numbered[0].startSeconds > .001) return [{ id:"review-count-in", name:"Count In", startSeconds:0, endSeconds:numbered[0].startSeconds }, ...numbered];
  return numbered;
}

function reviewName(value: unknown, index: number) {
  const name = String(value ?? "").replace(/\[unk\]/gi, "").replace(/\s+/g, " ").trim()
    .replace(/^(verse|chorus|bridge)\s+to$/i, "$1")
    .replace(/^out\s+row$/i, "Outro");
  return name || `Review Section ${index + 1}`;
}

function reviewCueMarkers(regions: readonly Region[], warningSeconds: number) {
  return regions.filter(region => region.id !== "review-count-in").map(region => ({
    atSeconds: correctedReviewCueAt(region.startSeconds, warningSeconds),
    label: region.name.replace(/\s+\d+$/, "").trim(),
    targetRegionId: region.id,
  }));
}

async function reviewCuePlan(markers: ReturnType<typeof reviewCueMarkers>, cueFolder: string, outputFolder:string, bpm:number, meter:TimeSignature, ffmpegPath:string) {
  await mkdir(outputFolder,{recursive:true});
  const rendered=new Map<string,string>(),plans=[];
  for(const marker of markers){
    try{
      let audioPath=rendered.get(marker.label);
      if(!audioPath){const sourcePath=await resolveCueAudio(cueFolder,marker.label),destination=join(outputFolder,`${safeId(marker.label)}.wav`),temporary=`${destination}.${process.pid}.tmp.wav`;await writeCountedCue({sourcePath,destinationPath:temporary,numberDirectory:cueFolder,bpm,meter,ffmpegPath});await rename(temporary,destination);audioPath=destination;rendered.set(marker.label,audioPath);}
      plans.push({...marker,audioPath});
    }catch{}
  }
  return plans;
}

export function correctedReviewCueAt(regionStart: number, warningSeconds: number) {
  return Math.max(0, regionStart - warningSeconds);
}

async function resolveCueAudio(directory: string, label: string) {
  const normalized = label.replace(/([A-Za-z])([0-9])$/, "$1 $2").replace(/^Turnaround/i, "Turn Around").toUpperCase();
  const aliases: Record<string, string> = { START: "CountIn.wav" };
  const names = [aliases[normalized] ?? `${normalized}.wav`, `${normalized.replace(/\s+/g, "")}.wav`];
  for (const name of names) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {}
  }
  throw new Error(`No cue audio is available for analyzer region: ${label}`);
}
