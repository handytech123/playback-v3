import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { DEFAULT_SHOW_STATE, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { CLICK_TEMPLATES, clickTemplate, type ClickTemplateId } from "../domain/click-templates.js";
import { positionToSeconds } from "../domain/grid.js";
import { songId, type ClickEvent, type MusicalPosition, type PreparedSong, type TimeSignature } from "../domain/song.js";
import { loadOrBuildEditorWaveforms } from "../edit/editor-workspace.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import { prepareAudioSource, preparedAudioFilename } from "../prep/audio-source.js";
import { isReferenceAudio } from "./audio-role.js";
import { parseTimeSignature, type MasterSongRow } from "./normalize-song.js";
import { loadPlaybackAnalyzerPackage, mapAnalyzerTimelineFacts, mapAnalyzerTimelinePackage, type AnalyzerArrangementFact, type AnalyzerAudioFileFact } from "./analyzer-package.js";

export const ANALYZER_SONG_MAP_VERSION = 15;
const REVIEW_STEM_CACHE_VERSION = 3;

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
}): Promise<{ manifestPath: string; manifest: ConfirmedSetManifest; updated: boolean }> {
  const meter = parseTimeSignature(input.master.timeSignature);
  const packageSourceFolder = input.master.folderPath;
  const analyzerPackage = await loadPlaybackAnalyzerPackage(packageSourceFolder);
  if (!analyzerPackage) throw new Error("Analyzer playback-song.json is required before this song can open in Editor review");
  const sourceFolder = packageSourceFolder;
  const duration = Number(analyzerPackage.timeline.durationMs) / 1000;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Analyzer candidate duration is unavailable");
  const selectedKey = normalizeReviewKey(input.master.key ?? analyzerPackage?.keyAnalysis?.approvedKey ?? analyzerPackage?.keyAnalysis?.detectedKey ?? analyzerPackage?.master.originalKey);
  if (!selectedKey) throw new Error("A key estimate is required before this song can open in Editor review");
  const clickPlan = await selectedSongClickPlan(sourceFolder, meter);
  const reviewRoot = join(input.cacheRoot, safeId(input.catalogId));
  const waveformPath = join(reviewRoot, "waveform.json");
  const bundlePath = join(reviewRoot, "editor-waveforms.json");
  const manifestPath = join(reviewRoot, "confirmed-set.json");
  await mkdir(reviewRoot, { recursive: true });

  const cueLabels = Array.from(new Set((analyzerPackage.cues ?? []).map(cue => String(cue.phrase ?? "")).filter(Boolean)));
  const cueSources = await Promise.all(cueLabels.map(label => resolveCueAudio(input.cueFolder, label).catch(() => null)));
  const reusableAudioFingerprint = await fingerprintFiles([
    input.clickRegularPath,
    input.clickAccentPath,
    join(input.cueFolder, "REPEAT.wav"),
    join(input.padFolder, `Pad_${padFileKey(selectedKey)}.wav`),
    ...cueSources.filter((value): value is string => Boolean(value)),
  ]);
  const arrangementAnalyzerFingerprint = analyzerArrangementFingerprint(analyzerPackage.arrangements ?? []);
  const sourceFingerprint = createHash("sha256").update(JSON.stringify({
    songMapVersion: ANALYZER_SONG_MAP_VERSION,
    master: { key: input.master.key, bpm: input.master.bpm, timeSignature: input.master.timeSignature, folderPath: input.master.folderPath },
    analyzerPackage,
    clickRegularPath: input.clickRegularPath,
    clickAccentPath: input.clickAccentPath,
    reusableAudioFingerprint,
    arrangementAnalyzerFingerprint,
    reviewStemCacheVersion: REVIEW_STEM_CACHE_VERSION,
    analyzerControlVersion: 1,
  })).digest("hex");
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8")) as ConfirmedSetManifest & { review?: { sourceFingerprint?: string } };
    await Promise.all([stat(waveformPath), stat(bundlePath)]);
    if (existing.review?.sourceFingerprint === sourceFingerprint) return { manifestPath, manifest: existing, updated: false };
  } catch {}
  // A changed analyzer package may retain the same audio duration and stem count,
  // so the normal waveform cache validity check is not enough here.
  await Promise.all([rm(waveformPath, { force: true }), rm(bundlePath, { force: true })]);

  const sourceStems = analyzerSourceStems(sourceFolder, analyzerPackage.audioFiles, duration);
  if (!sourceStems.length) throw new Error("No playable music file is available for Editor review");
  const stems=await prepareReviewStems(sourceStems, join(reviewRoot, "stems"), input.ffmpegPath);
  const analyzerTimeline = mapAnalyzerTimelinePackage(analyzerPackage, duration, input.master.bpm, meter);
  if (!analyzerTimeline) throw new Error("Analyzer playback-song.json must provide regions before Playback can prepare Editor review");
  const regions = analyzerTimeline.regions;
  const cueMarkers: readonly { position?: MusicalPosition; atSeconds:number; label:string; targetRegionId:string }[] = analyzerTimeline.cues.map(cue => ({ ...(cue.position ? { position: cue.position } : {}), atSeconds: cue.atSeconds, label: cue.phrase, targetRegionId: cue.targetRegionId }));
  const cuePlan = await reviewCuePlan(cueMarkers, input.cueFolder, join(reviewRoot,"live-assets","cues"), input.master.bpm, meter, input.ffmpegPath);
  const resolvedCueTargets = new Set(cuePlan.map(cue => cue.targetRegionId));
  const missingCueLabels = cueMarkers.filter(cue => !resolvedCueTargets.has(cue.targetRegionId)).map(cue => cue.label);
  const originalSongFacts = {
    id: songId(input.master.catalogId),
    title: input.master.title,
    artist: input.master.artist,
    vendor: input.master.vendor,
    originalKey: selectedKey,
    originalBpm: input.master.bpm,
    originalTimeSignature: meter,
  };
  const song: PreparedSong = {
    song: {
      ...originalSongFacts,
    },
    selectedKey,
    selectedBpm: input.master.bpm,
    timeSignature: meter,
    durationSeconds: duration,
    stems,
    regions,
    cues: cueMarkers.map(cue => ({ phrase: cue.label, ...("position" in cue ? { position: cue.position } : {}), atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId })),
    cacheFingerprint: analyzerAudioFingerprint(analyzerPackage.audioFiles),
    waveformPath,
    control: {
      sourceType: "reaper-import",
      sourceSha256: sourceFingerprint,
      proPresenterMidi: analyzerSlidesMidi(analyzerPackage),
      midiOutputName: null,
    },
    liveAssets: {
      click: {
        regularPath: input.clickRegularPath,
        accentPath: input.clickAccentPath,
        events: clickPlan.events,
        templateId: clickPlan.templateId,
      },
      cues: cuePlan,
      cueCountVersion: 2,
      repeatCuePath: join(input.cueFolder, "REPEAT.wav"),
      pad: { key: selectedKey, audioPath: join(input.padFolder, `Pad_${padFileKey(selectedKey)}.wav`) },
    },
  };

  const arrangementSongs: PreparedSong[] = [];
  const { control: _originalControl, waveformPath: _originalWaveformPath, ...arrangementBaseSong } = song;
  for (const arrangement of analyzerPackage.arrangements ?? []) {
    const arrangementMeter = arrangement.timeSignature ? parseTimeSignature(arrangement.timeSignature) : meter;
    const arrangementBpm = Number(arrangement.bpm ?? input.master.bpm);
    const arrangementDuration = analyzerArrangementDuration(arrangement, arrangementBpm, arrangementMeter, duration);
    const arrangementTimeline = mapAnalyzerArrangement(arrangement, arrangementDuration, arrangementBpm, arrangementMeter);
    if (!arrangementTimeline) continue;
    const arrangementCueMarkers = arrangementTimeline.cues.map(cue => ({ ...(cue.position ? { position: cue.position } : {}), atSeconds: cue.atSeconds, label: cue.phrase, targetRegionId: cue.targetRegionId }));
    const safeArrangementId = safeId(String(arrangement.id ?? arrangement.name ?? arrangement.sourcePath ?? `arrangement-${arrangementSongs.length + 1}`));
    const arrangementSourceStems = analyzerSourceStems(sourceFolder, arrangement.audioFiles ?? [], arrangementDuration);
    if (!arrangementSourceStems.length) continue;
    const arrangementStems = await prepareReviewStems(arrangementSourceStems, join(reviewRoot, "arrangements", safeArrangementId, "stems"), input.ffmpegPath);
    const arrangementMidi = analyzerArrangementSlidesMidi(arrangement);
    const arrangementSourceSha256 = createHash("sha256").update(JSON.stringify({
      sourcePath: arrangement.sourcePath ?? null,
      audioFiles: analyzerAudioFingerprint(arrangement.audioFiles ?? []),
      regions: arrangement.regions ?? [],
      cues: arrangement.cues ?? [],
      midi: arrangementMidi,
    })).digest("hex");
    arrangementSongs.push({
      ...arrangementBaseSong,
      selectedBpm: arrangementBpm,
      timeSignature: arrangementMeter,
      durationSeconds: arrangementDuration,
      stems: arrangementStems,
      regions: arrangementTimeline.regions,
      cues: arrangementCueMarkers.map(cue => ({ phrase: cue.label, ...("position" in cue ? { position: cue.position } : {}), atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId })),
      cacheFingerprint: createHash("sha256").update(JSON.stringify({
        arrangementId: safeArrangementId,
        sourceSha256: arrangementSourceSha256,
        bpm: arrangementBpm,
        timeSignature: arrangementMeter,
        durationSeconds: arrangementDuration,
        stemFingerprint: analyzerAudioFingerprint(arrangement.audioFiles ?? []),
      })).digest("hex"),
      liveAssets: {
        ...song.liveAssets!,
        cues: [],
      },
      arrangement: {
        id: safeArrangementId,
        name: String(arrangement.name ?? arrangement.sourcePath ?? `Arrangement ${arrangementSongs.length + 1}`),
        sourceType: "reaper-import",
        sourceSha256: arrangementSourceSha256,
        proPresenterMidi: arrangementMidi,
        midiOutputName: null,
      },
    });
  }

  const bundle = await loadOrBuildEditorWaveforms(song, bundlePath, 2400, input.ffmpegPath);
  await writeFile(waveformPath, JSON.stringify({ schemaVersion: 1, source: stems[0]!.sourcePath, sampleRate: 0, channels: 0, durationSeconds: duration, buckets: bundle.summary }));
  const manifest = {
    schemaVersion: 1,
    id: `review-${safeId(input.catalogId)}`,
    name: `Review · ${input.master.title}`,
    confirmedAt: new Date().toISOString(),
    songs: [song, ...arrangementSongs],
    show: DEFAULT_SHOW_STATE,
    review: { status: "needs-review", catalogId: input.catalogId, sourceFolder, performanceEligible: false, songMapVersion: ANALYZER_SONG_MAP_VERSION, sourceFingerprint, missingCueLabels, arrangementCount: arrangementSongs.length },
  } as ConfirmedSetManifest;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifestPath, manifest, updated: true };
}

export async function hydrateReviewSongLiveAssets(input: {
  readonly manifestPath: string;
  readonly songIndex: number;
  readonly cueFolder: string;
  readonly ffmpegPath: string;
}): Promise<ConfirmedSetManifest> {
  const manifest = JSON.parse(await readFile(input.manifestPath, "utf8")) as ConfirmedSetManifest;
  const song = manifest.songs[input.songIndex];
  if (!song) throw new Error("Prepared song is missing from review manifest");
  if (!song.liveAssets) return manifest;
  if ((song.liveAssets.cues?.length ?? 0) > 0) return manifest;
  const cueMarkers = song.cues.map((cue) => ({ ...(cue.position ? { position: cue.position } : {}), atSeconds: cue.atSeconds, label: cue.phrase, targetRegionId: cue.targetRegionId }));
  const assetKey = song.arrangement?.id ?? "original-song";
  const outputFolder = join(dirname(input.manifestPath), "live-assets", "arrangements", safeId(assetKey), "cues");
  const cuePlan = await reviewCuePlan(cueMarkers, input.cueFolder, outputFolder, song.selectedBpm, song.timeSignature, input.ffmpegPath);
  const songs = manifest.songs.map((candidate, index) => index === input.songIndex ? { ...candidate, liveAssets: { ...candidate.liveAssets!, cues: cuePlan } } : candidate);
  const updated = { ...manifest, songs } as ConfirmedSetManifest;
  const temporary = `${input.manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(updated, null, 2));
  await rename(temporary, input.manifestPath);
  return updated;
}

export async function selectedSongClickTemplate(sourceFolder: string, meter: TimeSignature): Promise<ClickTemplateId> {
  return (await selectedSongClickPlan(sourceFolder, meter)).templateId;
}

export async function selectedSongClickPlan(sourceFolder: string, meter: TimeSignature): Promise<{ templateId: ClickTemplateId; events: readonly ClickEvent[] }> {
  const analyzerPackage = await loadPlaybackAnalyzerPackage(sourceFolder);
  const packageSelected = analyzerPackage?.click?.playbackPattern?.templateId;
  if (!packageSelected) throw new Error("Analyzer playback-song.json must provide a click template before Playback can prepare this song");
  if (!(packageSelected in CLICK_TEMPLATES)) throw new Error(`Analyzer package selected an unknown click template: ${packageSelected}`);
  clickTemplate(packageSelected as ClickTemplateId, meter);
  const events = (analyzerPackage?.click?.playbackPattern?.events ?? []).map(event => ({
    atSeconds: Number.isFinite(Number(event.atSeconds)) ? Number(event.atSeconds) : Number(event.timeMs) / 1000,
    accent: event.accent === true,
    ...(Number.isFinite(Number(event.maxDurationSeconds)) ? { maxDurationSeconds: Number(event.maxDurationSeconds) } : {}),
  })).filter(event => Number.isFinite(event.atSeconds) && event.atSeconds >= 0).sort((a, b) => a.atSeconds - b.atSeconds);
  if (!events.length) throw new Error("Analyzer playback-song.json must provide click events before Playback can prepare this song");
  if (events[0]!.atSeconds !== 0) throw new Error("Analyzer click events must begin at measure 1 beat 1");
  return { templateId: packageSelected as ClickTemplateId, events };
}

function safeAnalyzerAudioPath(sourceFolder: string, analyzerPath: string) {
  const resolvedRoot = resolve(sourceFolder), resolvedPath = resolve(sourceFolder, analyzerPath), relation = relative(resolvedRoot, resolvedPath);
  if (!relation || relation.startsWith("..") || resolve(resolvedRoot, relation) !== resolvedPath) throw new Error(`Analyzer audio path escapes its song folder: ${analyzerPath}`);
  if (relation.split(/[\\/]+/).some((part) => part.toLowerCase() === "multitracks")) {
    throw new Error(`Analyzer audio path is stale after library flattening. Re-run Analyzer for this song: ${analyzerPath}`);
  }
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

function analyzerSlidesMidi(analyzerPackage: Awaited<ReturnType<typeof loadPlaybackAnalyzerPackage>>) {
  return (analyzerPackage?.control?.slidesMidi ?? []).map(event => ({
    ...(event.position ? { position: { measure: Number(event.position.measure), beat: Number(event.position.beat), tick: Number(event.position.tick ?? 0) } } : {}),
    atSeconds: Number.isFinite(Number(event.atSeconds)) ? Number(event.atSeconds) : Number(event.timeSeconds ?? 0),
    status: Number(event.status),
    data1: Number(event.data1),
    data2: Number(event.data2),
  })).filter(event => Number.isFinite(event.atSeconds) && event.atSeconds >= 0 && Number.isInteger(event.status) && Number.isInteger(event.data1) && Number.isInteger(event.data2));
}

function analyzerArrangementSlidesMidi(arrangement: AnalyzerArrangementFact) {
  return (arrangement.control?.slidesMidi ?? []).map(event => ({
    ...(event.position ? { position: { measure: Number(event.position.measure), beat: Number(event.position.beat), tick: Number(event.position.tick ?? 0) } } : {}),
    atSeconds: Number.isFinite(Number(event.atSeconds)) ? Number(event.atSeconds) : Number(event.timeSeconds ?? 0),
    status: Number(event.status),
    data1: Number(event.data1),
    data2: Number(event.data2),
  })).filter(event => Number.isFinite(event.atSeconds) && event.atSeconds >= 0 && Number.isInteger(event.status) && Number.isInteger(event.data1) && Number.isInteger(event.data2));
}

function mapAnalyzerArrangement(arrangement: AnalyzerArrangementFact, duration: number, bpm: number, meter: TimeSignature) {
  return mapAnalyzerTimelineFacts(arrangement.regions ?? [], arrangement.cues ?? [], duration, bpm, meter);
}

function analyzerArrangementDuration(arrangement: AnalyzerArrangementFact, bpm: number, meter: TimeSignature, fallbackDuration: number) {
  const explicitDuration = Number(arrangement.durationSeconds);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) return explicitDuration;
  const ends = (arrangement.regions ?? []).map(region => {
    const endPosition = region.end?.position;
    if (endPosition) return positionToSeconds({
      measure: Number(endPosition.measure),
      beat: Number(endPosition.beat),
      tick: Number(endPosition.tick ?? 0),
    }, bpm, meter);
    const endMs = Number(region.end?.timeMs);
    if (Number.isFinite(endMs)) return endMs / 1000;
    const endSeconds = Number(region.end?.timeSeconds ?? region.endSeconds);
    return Number.isFinite(endSeconds) ? endSeconds : 0;
  }).filter(value => Number.isFinite(value) && value > 0);
  return ends.length ? Math.max(...ends) : fallbackDuration;
}

function analyzerSourceStems(sourceFolder: string, audioFiles: readonly AnalyzerAudioFileFact[], durationSeconds: number) {
  return audioFiles.filter(isPlayableEditorStem).map(file => ({
    role: file.playbackBus ?? file.role ?? "music-stem",
    sourcePath: safeAnalyzerAudioPath(sourceFolder, file.path),
    durationSeconds,
    displayName: originalStemDisplayName(file.trackName ?? file.path),
  }));
}

function analyzerAudioFingerprint(audioFiles: readonly AnalyzerAudioFileFact[]) {
  return audioFiles.map(file => `${file.sha256 ?? ""}:${file.path}:${file.playbackBus ?? ""}:${file.role ?? ""}`).sort().join("|");
}

function analyzerArrangementFingerprint(arrangements: readonly AnalyzerArrangementFact[]) {
  return createHash("sha256").update(JSON.stringify(arrangements.map(arrangement => ({
    id: arrangement.id ?? null,
    name: arrangement.name ?? null,
    sourcePath: arrangement.sourcePath ?? null,
    bpm: arrangement.bpm ?? null,
    timeSignature: arrangement.timeSignature ?? null,
    durationSeconds: arrangement.durationSeconds ?? null,
    audioFiles: analyzerAudioFingerprint(arrangement.audioFiles ?? []),
    regions: arrangement.regions ?? [],
    cues: arrangement.cues ?? [],
    slidesMidi: arrangement.control?.slidesMidi ?? [],
  })))).digest("hex");
}

async function prepareReviewStems(stems: readonly { role: string; sourcePath: string; durationSeconds: number; displayName?: string }[], outputFolder: string, ffmpegPath: string) {
  await rm(outputFolder, { recursive: true, force: true });
  await mkdir(outputFolder, { recursive: true });
  const usedNames = new Set<string>();
  const prepared = [];
  for (const [index, stem] of stems.entries()) {
    const rawName = basename(stem.sourcePath);
    const wavName = extname(rawName).toLowerCase() === ".m4a" ? preparedAudioFilename(rawName) : rawName;
    const extension = extname(wavName) || ".wav";
    const safeName = `${String(index + 1).padStart(2, "0")}-${safeId(basename(wavName, extension))}${extension.toLowerCase()}`;
    if (usedNames.has(safeName.toLowerCase())) throw new Error(`Prepared review stem filename collision: ${safeName}`);
    usedNames.add(safeName.toLowerCase());
    const destination = join(outputFolder, safeName);
    await prepareAudioSource(stem.sourcePath, destination, ffmpegPath);
    prepared.push({ ...stem, sourcePath: destination });
  }
  return prepared;
}

function isPlayableEditorStem(file: AnalyzerAudioFileFact) {
  if (isReferenceAudio(file.path)) return false;
  if (file.role === "click-reference" || file.role === "cue-reference" || file.role === "ignore") return false;
  if (file.playLive === true) return true;
  return file.role === "vocal-stem" || file.playbackBus === "vocals";
}

function originalStemDisplayName(path: string) {
  return basename(path.replaceAll("\\", "/"), extname(path)).trim();
}

async function reviewCuePlan(markers: readonly { position?:MusicalPosition;atSeconds:number;label:string;targetRegionId:string }[], cueFolder: string, outputFolder:string, bpm:number, meter:TimeSignature, ffmpegPath:string) {
  await mkdir(outputFolder,{recursive:true});
  const rendered=new Map<string,string>(),plans=[];
  for(const marker of markers){
    try{
      const renderKey=marker.label;
      let audioPath=rendered.get(renderKey);
      if(!audioPath){const sourcePath=await resolveCueAudio(cueFolder,marker.label),destination=join(outputFolder,`${safeId(renderKey)}.wav`),temporary=`${destination}.${process.pid}.tmp.wav`;await writeCountedCue({sourcePath,destinationPath:temporary,numberDirectory:cueFolder,bpm,meter,ffmpegPath});await rm(destination,{force:true});await rename(temporary,destination);audioPath=destination;rendered.set(renderKey,audioPath);}
      plans.push({...marker,audioPath});
    }catch{}
  }
  return plans;
}

export function correctedReviewCueAt(regionStart: number, warningSeconds: number) {
  return Math.max(0, regionStart - warningSeconds);
}

export function cueAudioLookupNames(label: string) {
  const spaced = label.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])$/, "$1 $2").replace(/^Turnaround/i, "Turn Around").replace(/^Turn Arround/i, "Turn Around").replace(/-/g, " ");
  const normalized = spaced.toUpperCase();
  const base = spaced.replace(/\s+\d+$/,"").toUpperCase();
  const aliases: Record<string, string> = { START: "CountIn.wav", "COUNT OFF": "CountIn.wav", BUILD: "BUILDITUP.wav", "A CAPELLA": "ACAPPELLA.wav", ACAPELLA: "ACAPPELLA.wav" };
  return Array.from(new Set([
    aliases[normalized] ?? `${normalized}.wav`,
    `${normalized.replace(/\s+/g, "")}.wav`,
    ...(base !== normalized ? [aliases[base] ?? `${base}.wav`, `${base.replace(/\s+/g, "")}.wav`] : []),
  ]));
}

async function resolveCueAudio(directory: string, label: string) {
  const names = cueAudioLookupNames(label);
  for (const name of names) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {}
  }
  throw new Error(`No cue audio is available for analyzer region: ${label}`);
}

async function fingerprintFiles(paths: readonly string[]) {
  const values=[];
  for(const path of Array.from(new Set(paths)).sort()){
    try{values.push([path,createHash("sha256").update(await readFile(path)).digest("hex")]);}
    catch{values.push([path,"missing"]);}
  }
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
