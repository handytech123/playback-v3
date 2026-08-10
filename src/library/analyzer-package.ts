import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addGridBeats, positionToGridBeats, positionToSeconds, secondsToMusicalPosition } from "../domain/grid.js";
import type { MusicalPosition, Region, TimeSignature } from "../domain/song.js";

export type AnalyzerCountPattern = "234" | "456" | "23456";

export interface AnalyzerCueFact {
  readonly id: string;
  readonly phrase: string;
  readonly countPattern: AnalyzerCountPattern;
  readonly leadGridBeats: number;
  readonly cueStart: {
    readonly sampleFrame?: number;
    readonly timeMs: number;
    readonly position: { readonly measure: number; readonly beat: number; readonly tick?: number };
  };
  readonly confidence?: number;
  readonly reviewStatus?: string;
}

export interface PlaybackAnalyzerPackage {
  readonly schema: "playback-analyzer-package/v1";
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly review: { readonly status: string };
  readonly master: {
    readonly catalogId: string;
    readonly title: string;
    readonly originalKey?: string | null;
  };
  readonly timeline: { readonly durationMs: number };
  readonly audioFiles: readonly {
    readonly path: string;
    readonly sha256?: string;
    readonly role?: string;
    readonly playbackBus?: string | null;
    readonly playLive?: boolean;
  }[];
  readonly click?: { readonly playbackPattern?: { readonly templateId?: string } };
  readonly regions?: readonly unknown[];
  readonly cues: readonly AnalyzerCueFact[];
  readonly keyAnalysis?: { readonly approvedKey?: string | null; readonly detectedKey?: string | null };
  readonly readiness?: { readonly operatorReviewRequired?: boolean; readonly performanceEligible?: boolean };
}

export async function loadPlaybackAnalyzerPackage(sourceFolder: string): Promise<PlaybackAnalyzerPackage | null> {
  try {
    const parsed = JSON.parse(await readFile(join(sourceFolder, "playback-song.json"), "utf8"));
    if (parsed?.schema !== "playback-analyzer-package/v1" || parsed?.schemaVersion !== 1) throw new Error("Unsupported playback analyzer package");
    if (!Array.isArray(parsed.cues) || !Array.isArray(parsed.audioFiles)) throw new Error("Playback analyzer package is incomplete");
    return parsed as PlaybackAnalyzerPackage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function deriveRegionsFromAnalyzerCues(cues: readonly AnalyzerCueFact[], durationSeconds: number, bpm: number, meter: TimeSignature): { regions: Region[]; cues: readonly { phrase: string; position: MusicalPosition; atSeconds: number; targetRegionId: string; countPattern: AnalyzerCountPattern; leadGridBeats: number }[] } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Analyzer duration is unavailable");
  const facts = cues.map((cue, index) => {
    const rawPosition = cue.cueStart?.position;
    const position = rawPosition ? { measure: Number(rawPosition.measure), beat: Number(rawPosition.beat), tick: Number(rawPosition.tick ?? 0) } : null;
    const leadGridBeats = Number(cue.leadGridBeats);
    if (!cue.phrase?.trim() || !position || !Number.isFinite(leadGridBeats) || leadGridBeats < 0) throw new Error(`Analyzer cue ${cue.id || index + 1} is incomplete`);
    if (!["234", "456", "23456"].includes(cue.countPattern)) throw new Error(`Analyzer cue ${cue.id || index + 1} has an unsupported count pattern`);
    const atSeconds = positionToSeconds(position, bpm, meter), startPosition = addGridBeats(position, leadGridBeats, meter), startSeconds = positionToSeconds(startPosition, bpm, meter);
    return { id: cue.id || `cue-${index + 1}`, phrase: cue.phrase.trim(), position, atSeconds, countPattern: cue.countPattern, leadGridBeats, startPosition, startSeconds };
  }).filter(item => item.startSeconds < durationSeconds).sort((a, b) => positionToGridBeats(a.startPosition, meter) - positionToGridBeats(b.startPosition, meter));
  const totals = new Map<string, number>();
  for (const fact of facts) totals.set(canonicalPhrase(fact.phrase), (totals.get(canonicalPhrase(fact.phrase)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const candidates = facts.map((fact, index) => {
    const canonical = canonicalPhrase(fact.phrase), occurrence = (seen.get(canonical) ?? 0) + 1;
    seen.set(canonical, occurrence);
    const name = (totals.get(canonical) ?? 0) > 1 ? `${fact.phrase} ${occurrence}` : fact.phrase;
    const next = facts[index + 1];
    return { fact, region: { id: `analyzer-region-${String(index + 1).padStart(3, "0")}`, name, startPosition: fact.startPosition, endPosition: next?.startPosition ?? secondsToMusicalPosition(durationSeconds, bpm, meter), startSeconds: fact.startSeconds, endSeconds: next?.startSeconds ?? durationSeconds } };
  });
  const kept = candidates.filter(({ region }) => region.endSeconds > region.startSeconds);
  const regions = kept.map(({ region }) => region);
  const regionAtStart = new Map(kept.map(({ region }) => [region.startSeconds, region.id]));
  return { regions, cues: facts.map((fact) => ({ phrase: fact.phrase, position: fact.position, atSeconds: fact.atSeconds, targetRegionId: regionAtStart.get(fact.startSeconds) ?? "", countPattern: fact.countPattern, leadGridBeats: fact.leadGridBeats })).filter(cue => cue.targetRegionId) };
}

function canonicalPhrase(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
