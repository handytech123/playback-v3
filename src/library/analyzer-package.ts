import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { positionToGridBeats, positionToSeconds, secondsToMusicalPosition } from "../domain/grid.js";
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
  readonly click?: {
    readonly playbackPattern?: {
      readonly templateId?: string;
      readonly events?: readonly { readonly atSeconds?: number; readonly timeMs?: number; readonly accent?: boolean; readonly maxDurationSeconds?: number }[];
    };
  };
  readonly regions?: readonly AnalyzerRegionFact[];
  readonly cues: readonly (AnalyzerCueFact | AnalyzerTimelineCueFact)[];
  readonly keyAnalysis?: { readonly approvedKey?: string | null; readonly detectedKey?: string | null };
  readonly readiness?: { readonly operatorReviewRequired?: boolean; readonly performanceEligible?: boolean };
  readonly control?: {
    readonly slidesMidi?: readonly {
      readonly timeSeconds?: number;
      readonly atSeconds?: number;
      readonly position?: { readonly measure: number; readonly beat: number; readonly tick?: number };
      readonly status: number;
      readonly data1: number;
      readonly data2: number;
    }[];
  };
  readonly arrangements?: readonly AnalyzerArrangementFact[];
}

export interface AnalyzerTimingFact {
  readonly timeMs?: number;
  readonly timeSeconds?: number;
  readonly position?: { readonly measure: number; readonly beat: number; readonly tick?: number };
}

export interface AnalyzerRegionFact {
  readonly id?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly sectionType?: string;
  readonly start?: AnalyzerTimingFact;
  readonly end?: AnalyzerTimingFact;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
  readonly confidence?: number;
  readonly reviewStatus?: string;
}

export interface AnalyzerTimelineCueFact {
  readonly id?: string;
  readonly phrase?: string;
  readonly name?: string;
  readonly spokenPhrase?: string;
  readonly cueStart?: AnalyzerTimingFact;
  readonly start?: AnalyzerTimingFact;
  readonly atSeconds?: number;
  readonly targetRegionId?: string;
  readonly destinationRegionId?: string;
  readonly confidence?: number;
  readonly reviewStatus?: string;
}

export interface AnalyzerArrangementFact {
  readonly id?: string;
  readonly name?: string;
  readonly sourcePath?: string;
  readonly bpm?: number;
  readonly timeSignature?: string;
  readonly regions?: readonly AnalyzerRegionFact[];
  readonly cues?: readonly AnalyzerTimelineCueFact[];
  readonly control?: {
    readonly slidesMidi?: readonly {
      readonly timeSeconds?: number;
      readonly atSeconds?: number;
      readonly position?: { readonly measure: number; readonly beat: number; readonly tick?: number };
      readonly status: number;
      readonly data1: number;
      readonly data2: number;
    }[];
  };
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

export function mapAnalyzerTimelinePackage(packageData: PlaybackAnalyzerPackage, durationSeconds: number, bpm: number, meter: TimeSignature): { regions: Region[]; cues: readonly { phrase: string; position?: MusicalPosition; atSeconds: number; targetRegionId: string }[] } | null {
  return mapAnalyzerTimelineFacts(packageData.regions ?? [], packageData.cues ?? [], durationSeconds, bpm, meter);
}

export function mapAnalyzerTimelineFacts(sourceRegions: readonly AnalyzerRegionFact[], sourceCues: readonly (AnalyzerCueFact | AnalyzerTimelineCueFact)[], durationSeconds: number, bpm: number, meter: TimeSignature): { regions: Region[]; cues: readonly { phrase: string; position?: MusicalPosition; atSeconds: number; targetRegionId: string }[] } | null {
  if (!sourceRegions.length) return null;
  const regions = sourceRegions.map((region, index) => {
    const start = timingFromAnalyzer(region.start, region.startSeconds, bpm, meter), end = timingFromAnalyzer(region.end, region.endSeconds, bpm, meter);
    if (!start || !end) throw new Error(`Analyzer region ${region.id || index + 1} is missing timing`);
    const name = String(region.name ?? region.displayName ?? region.sectionType ?? `Region ${index + 1}`).trim();
    return { id: String(region.id ?? `analyzer-region-${String(index + 1).padStart(3, "0")}`), name: name || `Region ${index + 1}`, startPosition: start.position, endPosition: end.position, startSeconds: start.seconds, endSeconds: end.seconds };
  }).filter(region => region.endSeconds > region.startSeconds).sort((a, b) => positionToGridBeats(a.startPosition!, meter) - positionToGridBeats(b.startPosition!, meter));
  if (!regions.length) throw new Error("Analyzer package regions are empty after timing validation");
  const cues = sourceCues.map((cue, index) => {
    const timelineCue = cue as AnalyzerTimelineCueFact, phrase = String(timelineCue.phrase ?? timelineCue.name ?? timelineCue.spokenPhrase ?? "").trim();
    const start = timingFromAnalyzer(timelineCue.cueStart ?? timelineCue.start, timelineCue.atSeconds, bpm, meter);
    if (!phrase || !start) return null;
    const targetRegionId = timelineCue.targetRegionId ?? timelineCue.destinationRegionId;
    if (!targetRegionId || !regions.some(region => region.id === targetRegionId)) return null;
    return { phrase, position: start.position, atSeconds: start.seconds, targetRegionId };
  }).filter((cue): cue is { phrase: string; position: MusicalPosition; atSeconds: number; targetRegionId: string } => cue !== null && cue.atSeconds <= durationSeconds);
  return { regions, cues };
}

function timingFromAnalyzer(timing: AnalyzerTimingFact | undefined, fallbackSeconds: unknown, bpm: number, meter: TimeSignature): { position: MusicalPosition; seconds: number } | null {
  const position = timing?.position ? { measure: Number(timing.position.measure), beat: Number(timing.position.beat), tick: Number(timing.position.tick ?? 0) } : undefined;
  const seconds = position ? positionToSeconds(position, bpm, meter) : Number(timing?.timeMs) / 1000;
  const resolved = Number.isFinite(seconds) ? seconds : Number(timing?.timeSeconds ?? fallbackSeconds);
  if (!Number.isFinite(resolved) || resolved < 0) return null;
  return { position: position ?? secondsToMusicalPosition(resolved, bpm, meter), seconds: resolved };
}
