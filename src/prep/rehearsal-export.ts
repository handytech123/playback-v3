import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { promisify } from "node:util";
import type { PreparedSong, StemMixSetting } from "../domain/song.js";

const run = promisify(execFile);
const EXCLUDED_REHEARSAL_ROLES = new Set([
  "click",
  "cue",
  "guide",
  "dynamic-click",
  "dynamic-cue",
]);

export interface RehearsalSongExportInput {
  readonly song: PreparedSong;
  readonly setName: string;
  readonly songIndex: number;
  readonly destinationPath: string;
  readonly ffmpegPath?: string;
}

export interface RehearsalSongExportResult {
  readonly path: string;
  readonly stemCount: number;
  readonly liveEventCount: number;
  readonly bytes: number;
}

export async function exportRehearsalSong(
  input: RehearsalSongExportInput,
): Promise<RehearsalSongExportResult> {
  const outputPath = ensureWavExtension(input.destinationPath);
  const selectedStems = rehearsalStems(input.song);
  const liveEvents = rehearsalLiveEvents(input.song);
  if (!selectedStems.length && !liveEvents.length) throw new Error("No rehearsal audio is available to export");

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp.wav`;
  await rm(temporaryPath, { force: true });

  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  const liveInputPaths = [...new Set(liveEvents.map((event) => event.sourcePath))];
  for (const item of selectedStems) args.push("-i", item.sourcePath);
  for (const sourcePath of liveInputPaths) args.push("-i", sourcePath);

  const filters: string[] = [];
  const mixLabels: string[] = [];
  let labelIndex = 0;
  for (const [index, item] of selectedStems.entries()) {
    const label = `s${labelIndex++}`;
    filters.push(`[${index}:a]volume=${item.gain.toFixed(6)}[${label}]`);
    mixLabels.push(`[${label}]`);
  }
  for (const [liveInputIndex, sourcePath] of liveInputPaths.entries()) {
    const inputIndex = selectedStems.length + liveInputIndex;
    const events = liveEvents.filter((event) => event.sourcePath === sourcePath);
    if (events.length === 1) {
      const label = `s${labelIndex++}`;
      filters.push(`[${inputIndex}:a]volume=${events[0]!.gain.toFixed(6)},adelay=${events[0]!.delayMs}:all=1[${label}]`);
      mixLabels.push(`[${label}]`);
      continue;
    }
    const splitLabels = events.map((_, eventIndex) => `l${liveInputIndex}_${eventIndex}`);
    filters.push(`[${inputIndex}:a]asplit=${events.length}${splitLabels.map((label) => `[${label}]`).join("")}`);
    for (const [eventIndex, event] of events.entries()) {
      const label = `s${labelIndex++}`;
      filters.push(`[${splitLabels[eventIndex]}]volume=${event.gain.toFixed(6)},adelay=${event.delayMs}:all=1[${label}]`);
      mixLabels.push(`[${label}]`);
    }
  }
  const mixInputs = mixLabels.join("");
  filters.push(
    `${mixInputs}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,alimiter=limit=0.98,atrim=duration=${Math.max(0.1, input.song.durationSeconds).toFixed(3)},aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[out]`,
  );
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", outputPath === temporaryPath ? outputPath : temporaryPath);

  try {
    await run(input.ffmpegPath ?? "ffmpeg", args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const written = await stat(temporaryPath);
    if (written.size <= 44) throw new Error("Rehearsal WAV export is empty");
    await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
    return { path: outputPath, stemCount: selectedStems.length, liveEventCount: liveEvents.length, bytes: written.size };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function rehearsalLiveEvents(song: PreparedSong) {
  if (!song.liveAssets) return [];
  const clickEvents = song.liveAssets.click.events.map((event) => ({
    sourcePath: event.accent ? song.liveAssets!.click.accentPath : song.liveAssets!.click.regularPath,
    delayMs: Math.max(0, Math.round(event.atSeconds * 1000)),
    gain: 1,
  }));
  const cueEvents = song.liveAssets.cues.map((cue) => ({
    sourcePath: cue.audioPath,
    delayMs: Math.max(0, Math.round(cue.atSeconds * 1000)),
    gain: 1,
  }));
  const countInEvents = (song.liveAssets.countIn ?? []).map((count) => ({
    sourcePath: count.audioPath,
    delayMs: Math.max(0, Math.round(count.atSeconds * 1000)),
    gain: 1,
  }));
  return [...clickEvents, ...cueEvents, ...countInEvents];
}

export function rehearsalExportFilename(song: PreparedSong, songIndex: number): string {
  const arrangement = song.arrangement?.name && song.arrangement.name !== "Original Song" ? ` ${song.arrangement.name}` : "";
  return `${safeFilename(
    `${String(songIndex + 1).padStart(2, "0")} ${song.song.title} ${song.selectedKey}${arrangement}`,
  )}.wav`;
}

function rehearsalStems(song: PreparedSong) {
  const mixByIndex = new Map<number, StemMixSetting>();
  for (const mix of song.stemMix ?? []) mixByIndex.set(mix.index, mix);
  const hasSolo = [...mixByIndex.values()].some((mix) => mix.solo);
  return song.stems
    .map((stem, index) => ({ stem, index, mix: mixByIndex.get(index) }))
    .filter(({ stem }) => !EXCLUDED_REHEARSAL_ROLES.has(stem.role.toLowerCase()))
    .filter(({ mix }) => !mix?.muted)
    .filter(({ mix }) => !hasSolo || mix?.solo)
    .map(({ stem, mix }) => ({
      sourcePath: stem.sourcePath,
      displayName: stem.displayName ?? basename(stem.sourcePath),
      gain: clampGain(mix?.gain ?? 1),
    }));
}

function clampGain(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1;
}

function ensureWavExtension(path: string): string {
  return extname(path).toLowerCase() === ".wav" ? path : `${path}.wav`;
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "rehearsal-song"
  );
}
