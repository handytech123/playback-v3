import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { PreparedSong } from "../domain/song.js";
import type { WaveformBucket } from "../prep/wav-waveform.js";
import type { AppArrangementDraft } from "./arrangement-editor.js";

const execFile = promisify(execFileCallback);

export interface EditorStemWaveform {
  readonly id: string;
  readonly role: string;
  readonly sourcePath: string;
  readonly durationSeconds: number;
  readonly buckets: readonly WaveformBucket[];
}

export interface EditorWaveformBundle {
  readonly schemaVersion: 1;
  readonly sourceDurationSeconds: number;
  readonly bucketCount: number;
  readonly stems: readonly EditorStemWaveform[];
  readonly summary: readonly WaveformBucket[];
}

export interface ProjectedEditorWaveforms {
  readonly durationSeconds: number;
  readonly stems: readonly EditorStemWaveform[];
  readonly summary: readonly WaveformBucket[];
}

export async function loadOrBuildEditorWaveforms(
  song: PreparedSong,
  cachePath: string,
  bucketCount = 2400,
  ffmpegPath = "ffmpeg",
  displayLabels?: readonly string[],
): Promise<EditorWaveformBundle> {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as EditorWaveformBundle;
    if (
      cached.schemaVersion === 1 &&
      cached.bucketCount === bucketCount &&
      cached.stems.length === song.stems.length &&
      Math.abs(cached.sourceDurationSeconds - song.durationSeconds) < 0.001
    ) {
      if (!displayLabels || cached.stems.every((stem, index) => stem.role === displayLabels[index])) return cached;
      const relabelled = { ...cached, stems: cached.stems.map((stem, index) => ({ ...stem, role: displayLabels[index] ?? stem.role })) };
      await writeFile(cachePath, JSON.stringify(relabelled));
      return relabelled;
    }
  } catch {}
  const stems: EditorStemWaveform[] = [];
  for (const [index, stem] of song.stems.entries()) {
    const { stdout } = await execFile(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-i", stem.sourcePath,
      "-map", "0:a:0", "-ac", "1", "-ar", "1000", "-f", "s16le", "pipe:1",
    ], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    stems.push({
      id: `stem-${String(index + 1).padStart(2, "0")}`,
      role: displayLabels?.[index] ?? uniqueRole(stem.role, index, song.stems),
      sourcePath: stem.sourcePath,
      durationSeconds: stem.durationSeconds,
      buckets: bucketsFromPcm16(stdout as Buffer, bucketCount),
    });
  }
  const bundle: EditorWaveformBundle = {
    schemaVersion: 1,
    sourceDurationSeconds: song.durationSeconds,
    bucketCount,
    stems,
    summary: combineWaveforms(stems.map((stem) => stem.buckets), bucketCount),
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(bundle));
  return bundle;
}

export function editorStemDisplayLabels(
  song: PreparedSong,
  originalSong?: PreparedSong,
): readonly string[] {
  const roleCounts = new Map<string, number>();
  const originalByRole = new Map<string, PreparedSong["stems"]>();
  for (const original of originalSong?.stems ?? []) {
    const role = normalizedRoleKey(original.role);
    originalByRole.set(role, [...(originalByRole.get(role) ?? []), original]);
  }
  return song.stems.map((stem, index) => {
    if (stem.displayName?.trim()) return stem.displayName.trim();
    const role = normalizedRoleKey(stem.role);
    const roleIndex = roleCounts.get(role) ?? 0;
    roleCounts.set(role, roleIndex + 1);
    const original = originalByRole.get(role)?.[roleIndex] ?? originalSong?.stems[index];
    if (original?.displayName?.trim()) return original.displayName.trim();
    const sourceLabel = labelFromPath(original?.sourcePath ?? stem.sourcePath, index);
    if (sourceLabel) return sourceLabel;
    const displayRole = normalizeLabel(stem.role);
    return displayRole || `Stem ${index + 1}`;
  });
}

export function performanceStemDisplayLabels(song: PreparedSong): readonly string[] {
  return song.stems.map((stem, index) => {
    const role = normalizeLabel(stem.role);
    return role || `Stem ${index + 1}`;
  });
}

export function projectEditorWaveforms(
  bundle: EditorWaveformBundle,
  draft: AppArrangementDraft,
): ProjectedEditorWaveforms {
  const stems = bundle.stems.map((stem) => ({
    ...stem,
    durationSeconds: draft.durationSeconds,
    buckets: projectBuckets(stem.buckets, bundle.sourceDurationSeconds, draft),
  }));
  return {
    durationSeconds: draft.durationSeconds,
    stems,
    summary: combineWaveforms(stems.map((stem) => stem.buckets), bundle.bucketCount),
  };
}

export function bucketsFromPcm16(bytes: Buffer, bucketCount: number): WaveformBucket[] {
  const samples = Math.floor(bytes.length / 2);
  if (!samples) return Array.from({ length: bucketCount }, () => ({ min: 0, max: 0 }));
  const result: WaveformBucket[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket / bucketCount) * samples);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / bucketCount) * samples));
    let min = 1;
    let max = -1;
    for (let sample = start; sample < Math.min(end, samples); sample += 1) {
      const value = bytes.readInt16LE(sample * 2) / 32768;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    result.push({ min: min === 1 ? 0 : min, max: max === -1 ? 0 : max });
  }
  return result;
}

export function projectBuckets(
  source: readonly WaveformBucket[],
  sourceDurationSeconds: number,
  draft: AppArrangementDraft,
): WaveformBucket[] {
  const result: WaveformBucket[] = [];
  const scale = draft.baseBpm / draft.selectedBpm;
  let sectionIndex = 0;
  for (let index = 0; index < source.length; index += 1) {
    const at = ((index + 0.5) / source.length) * draft.durationSeconds;
    while (
      sectionIndex < draft.sections.length - 1 &&
      at >= draft.sections[sectionIndex]!.endSeconds
    ) sectionIndex += 1;
    const section = draft.sections[sectionIndex]!;
    const sourceAt = section.sourceStartSeconds + Math.max(0, at - section.startSeconds) / scale;
    const sourceIndex = Math.max(
      0,
      Math.min(source.length - 1, Math.floor((sourceAt / sourceDurationSeconds) * source.length)),
    );
    result.push(source[sourceIndex] ?? { min: 0, max: 0 });
  }
  return result;
}

export function combineWaveforms(
  waveforms: readonly (readonly WaveformBucket[])[],
  bucketCount: number,
): WaveformBucket[] {
  return Array.from({ length: bucketCount }, (_, index) => {
    let min = 0;
    let max = 0;
    for (const waveform of waveforms) {
      const bucket = waveform[index];
      if (!bucket) continue;
      min = Math.min(min, bucket.min);
      max = Math.max(max, bucket.max);
    }
    return { min, max };
  });
}

export async function pathsExist(paths: readonly string[]) {
  const results = await Promise.all(paths.map(async (path) => {
    try { await access(path); return true; } catch { return false; }
  }));
  return results.every(Boolean);
}

function uniqueRole(role: string, index: number, stems: PreparedSong["stems"]) {
  return stems.filter((stem) => stem.role === role).length > 1 ? `${role} ${index + 1}` : role;
}

function labelFromPath(sourcePath: string, index: number) {
  const filename = sourcePath.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? `Music ${index + 1}`;
  const withoutRenderPrefix = filename.replace(/^\d{2}[-_ ]+(?=.+)/, "").replace(/^music-stem(?:-\d+)?$/i, "");
  if (!withoutRenderPrefix) return `Music ${index + 1}`;
  return withoutRenderPrefix.trim();
}

function normalizedRoleKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeLabel(value: string) {
  const corrected = value.trim().replace(/^elcrectic\b/i, "Electric").replace(/^sopranno\b/i, "Soprano");
  if (/^[A-Z0-9 _-]+$/.test(corrected)) return corrected.toLowerCase().split(/[ _-]+/).map((part) => part === "bgvs" ? "BGVS" : part[0]!.toUpperCase() + part.slice(1)).join(" ");
  return corrected.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
