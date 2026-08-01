import { mkdir, writeFile } from "node:fs/promises";
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
    "ffmpeg",
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
    durationSeconds: input.draft.durationSeconds,
    regions: input.draft.sections.map(
      ({ id: regionId, name, startSeconds, endSeconds }) => ({
        id: regionId,
        name,
        startSeconds,
        endSeconds,
      }),
    ),
    cueMarkers: input.draft.cues
      .filter((cue) => cue.enabled)
      .map(({ phrase, atSeconds, targetRegionId }) => ({ phrase, atSeconds, targetRegionId })),
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
  const savedPath = await saveArrangementVersion(input.metadataRoot, arrangement);
  const padFile = `Pad_${padKey(input.draft.selectedKey)}.wav`;
  const confirmed = await confirmArrangement({
    arrangement,
    stems,
    originalSong: input.source.song,
    outputDirectory: join(directory, "performance"),
    cueDirectory: productionDefaults.cueFolder,
    clickRegularPath: join(productionDefaults.clickFolder, "CLICK.wav"),
    clickAccentPath: join(productionDefaults.clickFolder, "CLICK ACCENT.wav"),
    padPath: join(productionDefaults.padFolder, padFile),
  });
  return { id, savedPath, manifestPath: confirmed.manifestPath, arrangement };
}

function padKey(key: string) {
  const aliases: Record<string, string> = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
  };
  return aliases[key] ?? key;
}
