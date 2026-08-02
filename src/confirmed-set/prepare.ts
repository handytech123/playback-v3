import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { CONFIRMED_SET_SCHEMA_VERSION, DEFAULT_SHOW_STATE, validateConfirmedSet, type ConfirmedSetManifest, type ConfirmedSetShowState, type ReadinessReport } from "./manifest.js";
import type { PreparedSong } from "../domain/song.js";
import { writeWaveformSummary } from "../prep/wav-waveform.js";
import { prepareAudioSource, preparedAudioFilename } from "../prep/audio-source.js";

export interface StemSource {
  readonly relativePath: string;
  readonly role: string;
  readonly durationSeconds: number;
  readonly sha256: string;
}

export interface SongPreparationInput {
  readonly preparedSong: PreparedSong;
  readonly sourceFolder: string;
  readonly stems: readonly StemSource[];
  readonly liveAssets?: LiveAssetSources;
}

export interface LiveAssetSources {
  readonly click: { readonly regularPath: string; readonly accentPath: string; readonly events: readonly { atSeconds: number; accent: boolean }[] };
  readonly cues: readonly { atSeconds: number; label: string; sourcePath: string; targetRegionId: string }[];
  readonly repeatCuePath: string;
  readonly pad: { readonly key: string; readonly sourcePath: string };
}

export interface ConfirmSetInput {
  readonly setId: string;
  readonly setName: string;
  readonly cacheRoot: string;
  readonly songs: readonly SongPreparationInput[];
  readonly show?: ConfirmedSetShowState;
  readonly ffmpegPath?: string;
}

export interface ConfirmSetResult {
  readonly manifestPath: string;
  readonly manifest: ConfirmedSetManifest;
  readonly readiness: ReadinessReport;
  readonly copiedBytes: number;
}

export async function confirmSet(input: ConfirmSetInput): Promise<ConfirmSetResult> {
  assertSafeId(input.setId);
  const finalDirectory = join(input.cacheRoot, input.setId);
  const temporaryDirectory = `${finalDirectory}.preparing-${process.pid}-${Date.now()}`;
  await assertDoesNotExist(finalDirectory);
  await mkdir(temporaryDirectory, { recursive: true });
  let copiedBytes = 0;

  try {
    const songs: PreparedSong[] = [];
    for (const [songIndex, inputSong] of input.songs.entries()) {
      const songDirectory = join(temporaryDirectory, "songs", String(songIndex).padStart(3, "0"));
      await mkdir(songDirectory, { recursive: true });
      const cachedStems = [];

      const destinationNames = new Set<string>();
      for (const source of inputSong.stems) {
        const sourcePath = join(inputSong.sourceFolder, source.relativePath);
        const sourceName = basename(source.relativePath);
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
        cachedStems.push({ role: source.role, sourcePath: destinationPath, durationSeconds: source.durationSeconds });
      }

      const waveformPath = join(songDirectory, "waveform.json");
      const waveformSource = cachedStems.find((stem) => stem.role === "music-stem") ?? cachedStems[0];
      if (!waveformSource) throw new Error(`No waveform source available for ${inputSong.preparedSong.song.title}`);
      await writeWaveformSummary(waveformSource.sourcePath, waveformPath);
      const liveAssets = inputSong.liveAssets ? await prepareLiveAssets(inputSong.liveAssets, songDirectory, input.ffmpegPath) : undefined;
      songs.push({ ...inputSong.preparedSong, stems: cachedStems, waveformPath, ...(liveAssets ? { liveAssets } : {}) });
    }

    const draftManifest: ConfirmedSetManifest = {
      schemaVersion: CONFIRMED_SET_SCHEMA_VERSION,
      id: input.setId,
      name: input.setName,
      confirmedAt: new Date().toISOString(),
      songs,
      show: input.show ?? DEFAULT_SHOW_STATE,
    };
    const draftReport = validateConfirmedSet(draftManifest);
    if (!draftReport.ready) {
      throw new Error(`Readiness validation failed: ${draftReport.issues.map((issue) => issue.message).join("; ")}`);
    }

    await writeFile(join(temporaryDirectory, "confirmed-set.json"), JSON.stringify(draftManifest, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporaryDirectory, finalDirectory);

    // Paths are made final only after the directory is atomically published.
    const manifest = replacePathPrefix(draftManifest, temporaryDirectory, finalDirectory);
    const manifestPath = join(finalDirectory, "confirmed-set.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return { manifestPath, manifest, readiness: validateConfirmedSet(manifest), copiedBytes };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
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
        repeatCuePath: join(to, song.liveAssets.repeatCuePath.slice(from.length)),
        pad: { ...song.liveAssets.pad, audioPath: join(to, song.liveAssets.pad.audioPath.slice(from.length)) },
      } } : {}),
    })),
  };
}

async function prepareLiveAssets(sources: LiveAssetSources, songDirectory: string, ffmpegPath?: string) {
  const assetDirectory = join(songDirectory, "live-assets"); await mkdir(assetDirectory, { recursive: true });
  const regularPath = join(assetDirectory, "click-regular.wav"), accentPath = join(assetDirectory, "click-accent.wav");
  await prepareAudioSource(sources.click.regularPath, regularPath, ffmpegPath); await prepareAudioSource(sources.click.accentPath, accentPath, ffmpegPath);
  const cueDirectory = join(assetDirectory, "cues"); await mkdir(cueDirectory, { recursive: true });
  const copied = new Map<string, string>();
  const cues = [];
  for (const cue of sources.cues) {
    let audioPath = copied.get(cue.sourcePath);
    if (!audioPath) { audioPath = join(cueDirectory, `${safeFilename(cue.label)}.wav`); await prepareAudioSource(cue.sourcePath, audioPath, ffmpegPath); copied.set(cue.sourcePath, audioPath); }
    cues.push({ atSeconds: cue.atSeconds, label: cue.label, audioPath, targetRegionId: cue.targetRegionId });
  }
  const repeatCuePath = join(cueDirectory, "repeat.wav"); await prepareAudioSource(sources.repeatCuePath, repeatCuePath, ffmpegPath);
  const padPath = join(assetDirectory, `pad-${safeFilename(sources.pad.key)}.wav`); await prepareAudioSource(sources.pad.sourcePath, padPath, ffmpegPath);
  return { click: { regularPath, accentPath, events: sources.click.events }, cues, repeatCuePath, pad: { key: sources.pad.key, audioPath: padPath } };
}

function safeFilename(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
