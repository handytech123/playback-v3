import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { productionDefaults } from "../config/settings.js";
import type { PreparedSong } from "../domain/song.js";
import type { ArrangementVersion } from "../reaper/arrangement.js";
import { confirmArrangement } from "../reaper/arrangement-confirm.js";
import { saveArrangementVersion } from "../reaper/arrangement-persistence.js";
import {
  arrangementFingerprint,
  validateArrangementDraft,
  type AppArrangementDraft,
} from "./arrangement-editor.js";
import { renderAppArrangement } from "./app-arrangement-renderer.js";

export interface SaveAppArrangementInput {
  readonly draft: AppArrangementDraft;
  readonly source: PreparedSong;
  readonly metadataRoot: string;
  readonly cacheRoot: string;
  readonly stemDisplayLabels?: readonly string[];
  readonly ffmpegPath?: string;
  readonly clickRegularPath?: string;
  readonly clickAccentPath?: string;
  readonly sharedArrangementRoot?: string;
  readonly sourceSongFolder?: string | null;
}

export async function saveAppArrangement(input: SaveAppArrangementInput) {
  const issues = validateArrangementDraft(input.draft);
  if (issues.length) {
    throw new Error(`Arrangement is not ready: ${issues.join("; ")}`);
  }
  const fingerprint = arrangementFingerprint(input.draft);
  const id = `app-${fingerprint.slice(0, 12)}`;
  const directory = join(input.cacheRoot, "arrangements", id);
  const draftPath = join(directory, "draft.json");
  await mkdir(directory, { recursive: true });
  await writeFile(draftPath, JSON.stringify(input.draft, null, 2));
  const stems = await renderAppArrangement(
    input.draft,
    input.source,
    join(directory, "rendered-stems"),
    input.ffmpegPath ?? "ffmpeg",
    input.stemDisplayLabels,
  );
  const arrangement: ArrangementVersion = {
    schemaVersion: 1,
    id,
    songId: input.source.song.id,
    name: input.draft.name,
    sourceType: "app-edit",
    sourcePath: draftPath,
    sourceSha256: fingerprint,
    importedAt: new Date().toISOString(),
    selectedKey: input.draft.selectedKey,
    selectedBpm: input.draft.selectedBpm,
    timeSignature: input.draft.timeSignature,
    clickTemplateId: input.draft.clickTemplateId,
    durationSeconds: input.draft.durationSeconds,
    regions: input.draft.sections.map(
      ({ id: regionId, name, startPosition, endPosition, startSeconds, endSeconds }) => ({
        id: regionId,
        name,
        ...(startPosition ? { startPosition } : {}),
        ...(endPosition ? { endPosition } : {}),
        startSeconds,
        endSeconds,
      }),
    ),
    cueMarkers: input.draft.cues
      .filter((cue) => cue.enabled)
      .map(({ phrase, position, atSeconds, targetRegionId }) => ({ phrase: phrase.replace(/\s+\d+$/, "").trim(), ...(position ? { position } : {}), atSeconds, targetRegionId })),
    markers: [],
    mediaItems: stems.map((stem) => ({
      trackName: stem.role,
      positionSeconds: 0,
      lengthSeconds: input.draft.durationSeconds,
      sourcePath: stem.sourcePath,
      sourceOffsetSeconds: 0,
      playRate: 1,
    })),
    proPresenterMidi: input.draft.midi.filter((event) => event.enabled).map((event) => ({
      ...(event.position ? { position: event.position } : {}),
      atSeconds: event.atSeconds,
      status: event.status,
      channel: (event.status & 15) + 1,
      data1: event.data1,
      data2: event.data2,
      kind:
        (event.status & 240) === 144 && event.data2 > 0
          ? "note-on"
          : (event.status & 240) === 128 || (event.status & 240) === 144
            ? "note-off"
            : (event.status & 240) === 176
              ? "control-change"
              : "other",
    })),
    slidesTrackName: input.draft.midi.length ? "Slides" : null,
    warnings: [],
  };
  const padFile = `Pad_${padKey(input.draft.selectedKey)}.wav`;
  const confirmed = await confirmArrangement({
    arrangement,
    stems,
    originalSong: input.source.song,
    outputDirectory: join(directory, "performance"),
    cueDirectory: productionDefaults.cueFolder,
    clickRegularPath: input.clickRegularPath ?? join(productionDefaults.clickFolder, "CLICK.wav"),
    clickAccentPath: input.clickAccentPath ?? join(productionDefaults.clickFolder, "CLICK ACCENT.wav"),
    padPath: join(productionDefaults.padFolder, padFile),
    ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {}),
  });
  // Publish discoverable arrangement metadata only after every performance asset
  // and the confirmed manifest have been created successfully.
  const savedPath = await saveArrangementVersion(input.metadataRoot, arrangement);
  const shared = input.sourceSongFolder
    ? await publishSourceArrangementPackage({
      localDirectory: directory,
      sourceSongFolder: input.sourceSongFolder,
      arrangement,
    })
    : input.sharedArrangementRoot
      ? await publishSharedArrangementPackage({
      localDirectory: directory,
      sharedRoot: input.sharedArrangementRoot,
      arrangement,
      songTitle: input.source.song.title,
    })
      : null;
  return { id, savedPath: shared?.arrangementPath ?? savedPath, manifestPath: confirmed.manifestPath, sharedManifestPath: shared?.manifestPath ?? null, arrangement };
}

function padKey(key: string) {
  const aliases: Record<string, string> = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
  };
  const tonalCenter = key.replace(/m$/i, "");
  return aliases[tonalCenter] ?? tonalCenter;
}

async function publishSharedArrangementPackage(input: {
  readonly localDirectory: string;
  readonly sharedRoot: string;
  readonly arrangement: ArrangementVersion;
  readonly songTitle: string;
}) {
  const sharedDirectory = join(input.sharedRoot, "app-arrangements", safePathPart(input.songTitle), safePathPart(input.arrangement.name), input.arrangement.id);
  await rm(sharedDirectory, { recursive: true, force: true });
  await mkdir(sharedDirectory, { recursive: true });
  await cp(input.localDirectory, sharedDirectory, { recursive: true, force: true });
  const arrangement = rewritePathPrefix(input.arrangement, input.localDirectory, sharedDirectory) as ArrangementVersion;
  const arrangementPath = join(sharedDirectory, "arrangement.json");
  await writeFile(arrangementPath, JSON.stringify(arrangement, null, 2), "utf8");
  const manifestPath = join(sharedDirectory, "performance", "confirmed-set.json");
  const manifest = rewritePathPrefix(JSON.parse(await readFile(manifestPath, "utf8")), input.localDirectory, sharedDirectory);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { arrangementPath, manifestPath };
}

async function publishSourceArrangementPackage(input: {
  readonly localDirectory: string;
  readonly sourceSongFolder: string;
  readonly arrangement: ArrangementVersion;
}) {
  const arrangementDirectory = join(input.sourceSongFolder, "Arrangements", safePathPart(input.arrangement.name));
  const sharedDirectory = join(arrangementDirectory, input.arrangement.id);
  await rm(arrangementDirectory, { recursive: true, force: true });
  await mkdir(sharedDirectory, { recursive: true });
  await cp(input.localDirectory, sharedDirectory, { recursive: true, force: true });
  const arrangement = rewritePathPrefix(input.arrangement, input.localDirectory, sharedDirectory) as ArrangementVersion;
  const arrangementPath = join(sharedDirectory, "arrangement.json");
  await writeFile(arrangementPath, JSON.stringify(arrangement, null, 2), "utf8");
  const manifestPath = join(sharedDirectory, "performance", "confirmed-set.json");
  const manifest = rewritePathPrefix(JSON.parse(await readFile(manifestPath, "utf8")), input.localDirectory, sharedDirectory);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { arrangementPath, manifestPath };
}

function rewritePathPrefix(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value.startsWith(from) ? join(to, value.slice(from.length)) : value;
  if (Array.isArray(value)) return value.map((item) => rewritePathPrefix(item, from, to));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewritePathPrefix(item, from, to)]));
  return value;
}

function safePathPart(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Arrangement";
}
