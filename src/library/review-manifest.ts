import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { DEFAULT_SHOW_STATE, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { buildDynamicClickEvents, secondsPerNotatedBeat } from "../domain/grid.js";
import { CLICK_TEMPLATES, clickTemplate, requiredDefaultClickTemplate, type ClickTemplateId } from "../domain/click-templates.js";
import { songId, type MusicalPosition, type PreparedSong, type Region, type TimeSignature } from "../domain/song.js";
import { loadOrBuildEditorWaveforms } from "../edit/editor-workspace.js";
import { isSupportedLibraryAudio } from "../prep/audio-source.js";
import { normalizeRegions } from "../edit/song-map.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import { parseTimeSignature, type MasterSongRow } from "./normalize-song.js";
import { loadSharedCandidateIndex } from "./shared-candidate-index.js";
import { deriveRegionsFromAnalyzerCues, loadPlaybackAnalyzerPackage, type AnalyzerCountPattern } from "./analyzer-package.js";

export const ANALYZER_SONG_MAP_VERSION = 8;

export async function prepareCandidateReview(input: {
  readonly catalogId: string;
  readonly sharedMetadataRoot: string;
  readonly libraryRoot: string;
  readonly cacheRoot: string;
  readonly clickRegularPath: string;
  readonly clickAccentPath: string;
  readonly cueFolder: string;
  readonly padFolder: string;
  readonly ffmpegPath: string;
  readonly master: MasterSongRow;
}): Promise<{ manifestPath: string; manifest: ConfirmedSetManifest }> {
  const meter = parseTimeSignature(input.master.timeSignature);
  const packageSourceFolder = input.master.folderPath;
  const analyzerPackage = await loadPlaybackAnalyzerPackage(packageSourceFolder);
  const index = analyzerPackage ? null : await loadSharedCandidateIndex(input.sharedMetadataRoot);
  const entry = index?.entries.find(item => item.catalogId === input.catalogId);
  if (!analyzerPackage && (!entry || entry.status !== "review" || !entry.candidateFile)) throw new Error("This Original Song does not have analyzer review metadata");
  const candidate = analyzerPackage ? null : JSON.parse(await readFile(join(input.sharedMetadataRoot, ...entry!.candidateFile!.split("/")), "utf8"));
  const sourceFolder = analyzerPackage ? packageSourceFolder : join(input.libraryRoot, ...entry!.folderRelativePath.split("/"));
  const duration = analyzerPackage ? Number(analyzerPackage.timeline.durationMs) / 1000 : Number(candidate.audioEvidence?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Analyzer candidate duration is unavailable");
  const selectedKey = normalizeReviewKey(input.master.key ?? analyzerPackage?.keyAnalysis?.approvedKey ?? analyzerPackage?.keyAnalysis?.detectedKey ?? analyzerPackage?.master.originalKey ?? candidate?.keyEvidence?.estimate);
  if (!selectedKey) throw new Error("A key estimate is required before this song can open in Editor review");
  const clickTemplateId = await selectedSongClickTemplate(sourceFolder, meter);
  const reviewRoot = join(input.cacheRoot, safeId(input.catalogId));
  const waveformPath = join(reviewRoot, "waveform.json");
  const bundlePath = join(reviewRoot, "editor-waveforms.json");
  const manifestPath = join(reviewRoot, "confirmed-set.json");
  await mkdir(reviewRoot, { recursive: true });

  const sourceStems = analyzerPackage
    ? analyzerPackage.audioFiles.filter(file => file.playLive === true && !isReferenceAudio(file.path)).map(file => ({ role: file.playbackBus ?? file.role ?? "music-stem", sourcePath: safeAnalyzerAudioPath(sourceFolder, file.path), durationSeconds: duration }))
    : (await readdir(sourceFolder, { withFileTypes: true })).filter(item => item.isFile() && isSupportedLibraryAudio(item.name) && !isReferenceAudio(item.name)).map(file => ({ role: "music-stem", sourcePath: join(sourceFolder, file.name), durationSeconds: duration }));
  if (!sourceStems.length) throw new Error("No playable music file is available for Editor review");
  const stems=sourceStems;
  const derived = analyzerPackage ? deriveRegionsFromAnalyzerCues(analyzerPackage.cues, duration, input.master.bpm, meter) : null;
  const regions = derived?.regions ?? reviewRegions(candidate?.regionDraft ?? [], duration, input.master.bpm, meter);
  const warningSeconds = secondsPerNotatedBeat(input.master.bpm, meter) * meter.numerator;
  const cueMarkers: readonly { position?: MusicalPosition; atSeconds:number; label:string; targetRegionId:string; countPattern?:AnalyzerCountPattern }[] = derived ? derived.cues.map(cue => ({ position: cue.position, atSeconds: cue.atSeconds, label: cue.phrase, targetRegionId: cue.targetRegionId, countPattern: cue.countPattern })) : reviewCueMarkers(regions, warningSeconds);
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
    cues: cueMarkers.map(cue => ({ phrase: cue.label, ...("position" in cue ? { position: cue.position } : {}), atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId })),
    cacheFingerprint: (analyzerPackage?.audioFiles ?? candidate?.audioEvidence?.files ?? []).map((file: any) => String(file.sha256 ?? "")).filter(Boolean).sort().join(":"),
    waveformPath,
    liveAssets: {
      click: {
        regularPath: input.clickRegularPath,
        accentPath: input.clickAccentPath,
        events: buildDynamicClickEvents(input.master.bpm, meter, duration, clickTemplateId),
        templateId: clickTemplateId,
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

export async function selectedSongClickTemplate(sourceFolder: string, meter: TimeSignature): Promise<ClickTemplateId> {
  const fallback = requiredDefaultClickTemplate(meter);
  const analyzerPackage = await loadPlaybackAnalyzerPackage(sourceFolder);
  const packageSelected = analyzerPackage?.click?.playbackPattern?.templateId;
  if (packageSelected) {
    if (!(packageSelected in CLICK_TEMPLATES)) throw new Error(`Analyzer package selected an unknown click template: ${packageSelected}`);
    clickTemplate(packageSelected as ClickTemplateId, meter);
    return packageSelected as ClickTemplateId;
  }
  let metadata: any;
  try {
    metadata = JSON.parse(await readFile(join(sourceFolder, "song-metadata.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Song click metadata could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const classification = metadata?.gridAnalysis?.clickPatternClassification;
  const selected = classification?.status === "matched" ? classification?.selected?.id : metadata?.dynamicClick?.templateId;
  if (selected === undefined || selected === null || selected === "") return fallback;
  if (typeof selected !== "string" || !(selected in CLICK_TEMPLATES)) throw new Error(`Song metadata selected an unknown click template: ${String(selected)}`);
  clickTemplate(selected as ClickTemplateId, meter);
  return selected as ClickTemplateId;
}

function isReferenceAudio(name: string) {
  return /(?:^|[_\s-])(click|cue|cues|count|guide|reference|ref|pad)(?:$|[_\s-])/i.test(basename(name, extname(name)));
}

function safeAnalyzerAudioPath(sourceFolder: string, analyzerPath: string) {
  const resolvedRoot = resolve(sourceFolder), resolvedPath = resolve(sourceFolder, analyzerPath), relation = relative(resolvedRoot, resolvedPath);
  if (!relation || relation.startsWith("..") || resolve(resolvedRoot, relation) !== resolvedPath) throw new Error(`Analyzer audio path escapes its song folder: ${analyzerPath}`);
  return resolvedPath;
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

async function reviewCuePlan(markers: readonly { position?:MusicalPosition;atSeconds:number;label:string;targetRegionId:string;countPattern?:AnalyzerCountPattern }[], cueFolder: string, outputFolder:string, bpm:number, meter:TimeSignature, ffmpegPath:string) {
  await mkdir(outputFolder,{recursive:true});
  const rendered=new Map<string,string>(),plans=[];
  for(const marker of markers){
    try{
      const renderKey=`${marker.label}:${marker.countPattern??"meter-default"}`;
      let audioPath=rendered.get(renderKey);
      if(!audioPath){const sourcePath=await resolveCueAudio(cueFolder,marker.label),destination=join(outputFolder,`${safeId(renderKey)}.wav`),temporary=`${destination}.${process.pid}.tmp.wav`;await writeCountedCue({sourcePath,destinationPath:temporary,numberDirectory:cueFolder,bpm,meter,ffmpegPath,...(marker.countPattern?{countPattern:marker.countPattern}:{})});await rm(destination,{force:true});await rename(temporary,destination);audioPath=destination;rendered.set(renderKey,audioPath);}
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
  const aliases: Record<string, string> = { START: "CountIn.wav", BUILD: "BUILDITUP.wav" };
  const names = [aliases[normalized] ?? `${normalized}.wav`, `${normalized.replace(/\s+/g, "")}.wav`];
  for (const name of names) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {}
  }
  throw new Error(`No cue audio is available for analyzer region: ${label}`);
}
