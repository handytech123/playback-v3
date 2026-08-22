import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { CONFIRMED_SET_SCHEMA_VERSION, DEFAULT_SHOW_STATE, validateConfirmedSet, type ConfirmedSetManifest, type ConfirmedSetShowState, type ReadinessReport } from "./manifest.js";
import type { MusicalPosition, PreparedMidiEvent, PreparedSong } from "../domain/song.js";
import { writeCombinedWaveformSummary } from "../prep/wav-waveform.js";
import { prepareAudioSource, preparedAudioFilename } from "../prep/audio-source.js";
import type { SongTransitionPlan } from "../live/song-transition.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import type { ClickTemplateId } from "../domain/click-templates.js";
import { measureSongLoudness } from "../audio/song-loudness.js";

export interface StemSource {
  readonly relativePath: string;
  readonly sourcePath?: string;
  readonly role: string;
  readonly durationSeconds: number;
  readonly sha256: string;
  readonly displayName?: string;
}

export interface SongPreparationInput {
  readonly preparedSong: PreparedSong;
  readonly sourceFolder: string;
  readonly stems: readonly StemSource[];
  readonly liveAssets?: LiveAssetSources;
}

export interface LiveAssetSources {
  readonly click: { readonly regularPath: string; readonly accentPath: string; readonly events: readonly { atSeconds: number; accent: boolean }[]; readonly templateId: ClickTemplateId };
  readonly cues: readonly { position?: MusicalPosition; atSeconds: number; label: string; sourcePath: string; targetRegionId: string }[];
  readonly countIn?: readonly { atSeconds: number; label: string; sourcePath: string }[];
  readonly repeatCuePath: string;
  readonly pad: { readonly key: string; readonly sourcePath: string };
}

export interface ConfirmSetInput {
  readonly setId: string;
  readonly setName: string;
  readonly cacheRoot: string;
  readonly songs: readonly SongPreparationInput[];
  readonly transitions?:readonly SongTransitionPlan[];
  readonly show?: ConfirmedSetShowState;
  readonly ffmpegPath?: string;
  readonly onProgress?:(status:{progress:number;label:string})=>void;
}

export interface ConfirmSetResult {
  readonly manifestPath: string;
  readonly manifest: ConfirmedSetManifest;
  readonly readiness: ReadinessReport;
  readonly copiedBytes: number;
}

export async function confirmSet(input: ConfirmSetInput): Promise<ConfirmSetResult> {
  const totalUnits=Math.max(1,input.songs.reduce((total,song)=>total+song.stems.length+2,0));let completedUnits=0;
  const report=(label:string,progress?:number)=>input.onProgress?.({progress:Math.max(0,Math.min(100,Math.round(progress??completedUnits/totalUnits*90))),label});
  report("Preparing isolated set cache",1);
  assertSafeId(input.setId);
  const finalDirectory = join(input.cacheRoot, input.setId);
  const temporaryDirectory = `${finalDirectory}.preparing-${process.pid}-${Date.now()}`;
  await assertDoesNotExist(finalDirectory);
  await mkdir(temporaryDirectory, { recursive: true });
  let copiedBytes = 0;

  try {
    const songs: PreparedSong[] = [];
    for (const [songIndex, inputSong] of input.songs.entries()) {
      const renderFingerprint = await fingerprintSongRender(inputSong);
      const renderCacheDirectory = join(input.cacheRoot, SONG_RENDER_CACHE_FOLDER, renderFingerprint);
      report(`Caching ${inputSong.preparedSong.song.title}`);
      const songDirectory = join(temporaryDirectory, "songs", String(songIndex).padStart(3, "0"));
      await mkdir(songDirectory, { recursive: true });
      const reusableSong = await loadReusableSongRender(renderCacheDirectory, renderFingerprint);
      if (reusableSong) {
        await cloneDirectory(renderCacheDirectory, songDirectory, new Set([SONG_RENDER_METADATA]));
        songs.push(resolveSetlistPositionMidi(rewritePreparedSongPaths(reusableSong, renderCacheDirectory, songDirectory), songIndex));
        completedUnits += inputSong.stems.length + 2;
        report(`Reusing ${inputSong.preparedSong.song.title} · unchanged`);
        continue;
      }
      const cachedStems = [];

      const destinationNames = new Set<string>();
      for (const source of inputSong.stems) {
        const sourcePath = source.sourcePath ?? join(inputSong.sourceFolder, source.relativePath);
        const sourceName = basename(sourcePath);
        const destinationName = extname(sourceName).toLowerCase() === ".m4a" ? preparedAudioFilename(sourceName) : sourceName;
        if (destinationNames.has(destinationName.toLowerCase())) throw new Error(`Prepared stem filename collision: ${destinationName}`);
        destinationNames.add(destinationName.toLowerCase());
        const destinationPath = join(songDirectory, destinationName);
        const before = await stat(sourcePath);
        const sourceHash = await sha256File(sourcePath);
        if (sourceHash.toLowerCase() !== source.sha256.toLowerCase()) {
          throw new Error(`Hash verification failed for ${source.relativePath}`);
        }
        await prepareAudioSource(sourcePath, destinationPath, input.ffmpegPath);
        copiedBytes += before.size;
        cachedStems.push({ role: source.role, sourcePath: destinationPath, durationSeconds: source.durationSeconds, ...(source.displayName ? { displayName: source.displayName } : {}) });
        completedUnits+=1;report(`Caching ${inputSong.preparedSong.song.title} · ${source.role}`);
      }

      const waveformPath = join(songDirectory, "waveform.json");
      if (!cachedStems.length) throw new Error(`No waveform sources available for ${inputSong.preparedSong.song.title}`);
      await writeCombinedWaveformSummary(cachedStems.map((stem) => stem.sourcePath), waveformPath);
      completedUnits+=1;report(`Building ${inputSong.preparedSong.song.title} waveform`);
      report(`Matching ${inputSong.preparedSong.song.title} loudness`);
      const loudnessNormalization=await measureSongLoudness({stemPaths:cachedStems.map(stem=>stem.sourcePath),...(inputSong.preparedSong.stemMix?{stemMix:inputSong.preparedSong.stemMix}:{}),...(input.ffmpegPath?{ffmpegPath:input.ffmpegPath}:{})});
      const liveAssets = inputSong.liveAssets ? await prepareLiveAssets(inputSong.liveAssets, inputSong.preparedSong, songDirectory, input.ffmpegPath) : undefined;
      completedUnits+=1;report(`Preparing ${inputSong.preparedSong.song.title} click, cues, and pad`);
      const renderedSong: PreparedSong = { ...inputSong.preparedSong, stems: cachedStems, waveformPath, loudnessNormalization, ...(liveAssets ? { liveAssets } : {}) };
      await publishSongRenderCache(renderCacheDirectory, renderFingerprint, renderedSong, songDirectory);
      songs.push(resolveSetlistPositionMidi(renderedSong, songIndex));
    }

    const draftManifest: ConfirmedSetManifest = {
      schemaVersion: CONFIRMED_SET_SCHEMA_VERSION,
      id: input.setId,
      name: input.setName,
      confirmedAt: new Date().toISOString(),
      songs,
      ...(input.transitions?{transitions:input.transitions}:{}),
      show: input.show ?? DEFAULT_SHOW_STATE,
    };
    const draftReport = validateConfirmedSet(draftManifest);
    report("Validating the complete performance package",94);
    if (!draftReport.ready) {
      throw new Error(`Readiness validation failed: ${draftReport.issues.map((issue) => issue.message).join("; ")}`);
    }

    await writeFile(join(temporaryDirectory, "confirmed-set.json"), JSON.stringify(draftManifest, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporaryDirectory, finalDirectory);
    report("Publishing the confirmed set",98);

    // Paths are made final only after the directory is atomically published.
    const manifest = replacePathPrefix(draftManifest, temporaryDirectory, finalDirectory);
    const manifestPath = join(finalDirectory, "confirmed-set.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    report("Confirmed Set ready · opening Performance",100);return { manifestPath, manifest, readiness: validateConfirmedSet(manifest), copiedBytes };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

const SONG_RENDER_CACHE_VERSION = 1;
const SONG_RENDER_CACHE_FOLDER = ".song-render-cache";
const SONG_RENDER_METADATA = "render.json";

interface SongRenderCacheMetadata {
  readonly version: number;
  readonly fingerprint: string;
  readonly song: PreparedSong;
}

/** Note 18 selects the presentation by its current one-based setlist position. */
export function resolveSetlistPositionMidi(song: PreparedSong, songIndex: number): PreparedSong {
  const position = songIndex + 1;
  if (!Number.isInteger(position) || position < 1 || position > 127) throw new Error("ProPresenter setlist position must be between 1 and 127");
  const rewrite = (events: readonly PreparedMidiEvent[]) => events.map((event) =>
    (event.status & 0xf0) === 0x90 && event.data1 === 18 && event.data2 > 0
      ? { ...event, data2: position }
      : event,
  );
  if (song.control) return { ...song, control: { ...song.control, proPresenterMidi: rewrite(song.control.proPresenterMidi) } };
  if (song.arrangement) return { ...song, arrangement: { ...song.arrangement, proPresenterMidi: rewrite(song.arrangement.proPresenterMidi) } };
  return song;
}

export async function loadConfirmedSet(manifestPath: string): Promise<ConfirmedSetManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as ConfirmedSetManifest;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function assertDoesNotExist(path: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`Confirmed set cache already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function fingerprintSongRender(input: SongPreparationInput): Promise<string> {
  const stemInputs = [];
  for (const stem of input.stems) {
    const sourcePath = stem.sourcePath ?? join(input.sourceFolder, stem.relativePath);
    const actualHash = await sha256File(sourcePath);
    if (actualHash.toLowerCase() !== stem.sha256.toLowerCase()) throw new Error(`Hash verification failed for ${stem.relativePath}`);
    stemInputs.push({ relativePath: stem.relativePath, role: stem.role, durationSeconds: stem.durationSeconds, sha256: actualHash, displayName: stem.displayName ?? null });
  }
  const assetInputs = input.liveAssets ? {
    click: { events: input.liveAssets.click.events, templateId: input.liveAssets.click.templateId, regularSha256: await sha256File(input.liveAssets.click.regularPath), accentSha256: await sha256File(input.liveAssets.click.accentPath) },
    cues: await Promise.all(input.liveAssets.cues.map(async cue => ({ position: cue.position ?? null, atSeconds: cue.atSeconds, label: cue.label, targetRegionId: cue.targetRegionId, sha256: await sha256File(cue.sourcePath) }))),
    countIn: await Promise.all((input.liveAssets.countIn ?? []).map(async cue => ({ atSeconds: cue.atSeconds, label: cue.label, sha256: await sha256File(cue.sourcePath) }))),
    repeatCueSha256: await sha256File(input.liveAssets.repeatCuePath),
    pad: { key: input.liveAssets.pad.key, sha256: await sha256File(input.liveAssets.pad.sourcePath) },
  } : null;
  const preparedSong = { ...input.preparedSong, stems: input.preparedSong.stems.map(stem => ({ ...stem, sourcePath: basename(stem.sourcePath) })), waveformPath: undefined, liveAssets: undefined, loudnessNormalization: undefined, performanceMix: undefined };
  return createHash("sha256").update(stableJson({ version: SONG_RENDER_CACHE_VERSION, preparedSong, stemInputs, assetInputs })).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function loadReusableSongRender(directory: string, fingerprint: string): Promise<PreparedSong | null> {
  try {
    const metadata = JSON.parse(await readFile(join(directory, SONG_RENDER_METADATA), "utf8")) as SongRenderCacheMetadata;
    if (metadata.version !== SONG_RENDER_CACHE_VERSION || metadata.fingerprint !== fingerprint) return null;
    for (const path of preparedSongFiles(metadata.song)) {
      if (!path.startsWith(`${directory}\\`) && !path.startsWith(`${directory}/`)) return null;
      if ((await stat(path)).size <= 0) return null;
    }
    return metadata.song;
  } catch {
    return null;
  }
}

async function publishSongRenderCache(directory: string, fingerprint: string, song: PreparedSong, sourceDirectory: string): Promise<void> {
  const parent = dirname(directory);
  const staging = `${directory}.preparing-${process.pid}-${Date.now()}`;
  await mkdir(parent, { recursive: true });
  try {
    await mkdir(staging, { recursive: true });
    await cloneDirectory(sourceDirectory, staging);
    const cachedSong = rewritePreparedSongPaths(song, sourceDirectory, directory);
    await writeFile(join(staging, SONG_RENDER_METADATA), JSON.stringify({ version: SONG_RENDER_CACHE_VERSION, fingerprint, song: cachedSong }, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(staging, directory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function cloneDirectory(source: string, destination: string, excluded = new Set<string>()): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) await cloneDirectory(from, to, excluded);
    else {
      try { await link(from, to); }
      catch { await copyFile(from, to); }
    }
  }
}

function preparedSongFiles(song: PreparedSong): string[] {
  return [
    ...song.stems.map(stem => stem.sourcePath),
    ...(song.waveformPath ? [song.waveformPath] : []),
    ...(song.liveAssets ? [song.liveAssets.click.regularPath, song.liveAssets.click.accentPath, ...song.liveAssets.cues.map(cue => cue.audioPath), ...(song.liveAssets.countIn ?? []).map(cue => cue.audioPath), song.liveAssets.repeatCuePath, song.liveAssets.pad.audioPath] : []),
  ];
}

function rewritePreparedSongPaths(song: PreparedSong, from: string, to: string): PreparedSong {
  const rewrite = (path: string) => join(to, path.slice(from.length));
  return {
    ...song,
    stems: song.stems.map(stem => ({ ...stem, sourcePath: rewrite(stem.sourcePath) })),
    ...(song.waveformPath ? { waveformPath: rewrite(song.waveformPath) } : {}),
    ...(song.liveAssets ? { liveAssets: {
      ...song.liveAssets,
      click: { ...song.liveAssets.click, regularPath: rewrite(song.liveAssets.click.regularPath), accentPath: rewrite(song.liveAssets.click.accentPath) },
      cues: song.liveAssets.cues.map(cue => ({ ...cue, audioPath: rewrite(cue.audioPath) })),
      ...(song.liveAssets.countIn ? { countIn: song.liveAssets.countIn.map(cue => ({ ...cue, audioPath: rewrite(cue.audioPath) })) } : {}),
      repeatCuePath: rewrite(song.liveAssets.repeatCuePath),
      pad: { ...song.liveAssets.pad, audioPath: rewrite(song.liveAssets.pad.audioPath) },
    } } : {}),
  };
}

function assertSafeId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error("Set ID contains unsafe path characters");
}

function replacePathPrefix(manifest: ConfirmedSetManifest, from: string, to: string): ConfirmedSetManifest {
  return {
    ...manifest,
    songs: manifest.songs.map((song) => ({
      ...song,
      stems: song.stems.map((stem) => ({ ...stem, sourcePath: join(to, stem.sourcePath.slice(from.length)) })),
      ...(song.waveformPath ? { waveformPath: join(to, song.waveformPath.slice(from.length)) } : {}),
      ...(song.liveAssets ? { liveAssets: {
        click: { ...song.liveAssets.click, regularPath: join(to, song.liveAssets.click.regularPath.slice(from.length)), accentPath: join(to, song.liveAssets.click.accentPath.slice(from.length)) },
        cues: song.liveAssets.cues.map((cue) => ({ ...cue, audioPath: join(to, cue.audioPath.slice(from.length)) })),
        ...(song.liveAssets.cueCountVersion ? { cueCountVersion: song.liveAssets.cueCountVersion } : {}),
        ...(song.liveAssets.countIn ? { countIn: song.liveAssets.countIn.map((event) => ({ ...event, audioPath: join(to, event.audioPath.slice(from.length)) })) } : {}),
        repeatCuePath: join(to, song.liveAssets.repeatCuePath.slice(from.length)),
        pad: { ...song.liveAssets.pad, audioPath: join(to, song.liveAssets.pad.audioPath.slice(from.length)) },
      } } : {}),
    })),
  };
}

async function prepareLiveAssets(sources: LiveAssetSources, song: PreparedSong, songDirectory: string, ffmpegPath?: string) {
  const assetDirectory = join(songDirectory, "live-assets"); await mkdir(assetDirectory, { recursive: true });
  const regularPath = join(assetDirectory, "click-regular.wav"), accentPath = join(assetDirectory, "click-accent.wav");
  await prepareAudioSource(sources.click.regularPath, regularPath, ffmpegPath); await prepareAudioSource(sources.click.accentPath, accentPath, ffmpegPath);
  const cueDirectory = join(assetDirectory, "cues"); await mkdir(cueDirectory, { recursive: true });
  // Reserve the Repeat command asset first. A song map can also contain a
  // visible cue named "Repeat" that points at this same source file.
  const repeatCuePath = join(cueDirectory, "repeat-command.wav");
  await prepareAudioSource(sources.repeatCuePath, repeatCuePath, ffmpegPath);
  const copied = new Map<string, string>();
  const usedNames = new Set<string>(["repeat-command.wav"]);
  const cues = [];
  for (const cue of sources.cues) {
    let audioPath = copied.get(cue.sourcePath);
    if (!audioPath) {
      const base = safeFilename(cue.label) || "cue";
      let filename = `${base}.wav`;
      let suffix = 2;
      while (usedNames.has(filename.toLowerCase())) filename = `${base}-${suffix++}.wav`;
      usedNames.add(filename.toLowerCase());
      audioPath = join(cueDirectory, filename);
      if(song.liveAssets?.cueCountVersion===2)await prepareAudioSource(cue.sourcePath,audioPath,ffmpegPath);
      else await writeCountedCue({ sourcePath: cue.sourcePath, destinationPath: audioPath, numberDirectory: dirname(sources.repeatCuePath), bpm: song.selectedBpm, meter: song.timeSignature, ...(ffmpegPath ? { ffmpegPath } : {}) });
      copied.set(cue.sourcePath, audioPath);
    }
    cues.push({ ...(cue.position ? { position: cue.position } : {}), atSeconds: cue.atSeconds, label: cue.label, audioPath, targetRegionId: cue.targetRegionId });
  }
  const padPath = join(assetDirectory, `pad-${safeFilename(sources.pad.key)}.wav`); await prepareAudioSource(sources.pad.sourcePath, padPath, ffmpegPath);
  return { click: { regularPath, accentPath, events: sources.click.events, templateId: sources.click.templateId }, cues, cueCountVersion: 2 as const, repeatCuePath, pad: { key: sources.pad.key, audioPath: padPath } };
}

function safeFilename(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
