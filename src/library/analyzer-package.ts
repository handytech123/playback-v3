import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addGridBeats, positionToGridBeats, positionToSeconds, secondsToMusicalPosition } from "../domain/grid.js";
import type { MusicalPosition, Region, TimeSignature } from "../domain/song.js";

export type AnalyzerCountPattern = "234" | "34" | "456" | "23456";

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
  readonly audioFiles: readonly AnalyzerAudioFileFact[];
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

export interface AnalyzerAudioFileFact {
  readonly path: string;
  readonly sha256?: string;
  readonly role?: string;
  readonly playbackBus?: string | null;
  readonly playLive?: boolean;
  readonly trackName?: string;
  readonly durationSeconds?: number;
  readonly durationMs?: number;
}

export interface AnalyzerRegionFact {
  readonly id?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly sectionType?: string;
  readonly sourceCueId?: string;
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
  readonly durationSeconds?: number;
  readonly audioFiles?: readonly AnalyzerAudioFileFact[];
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
  if (!sourceRegions.length) return deriveTimelineFromCueFacts(sourceCues, durationSeconds, bpm, meter);
  const regions = sourceRegions.map((region, index) => {
    const start = timingFromAnalyzer(region.start, region.startSeconds, bpm, meter), end = timingFromAnalyzer(region.end, region.endSeconds, bpm, meter);
    if (!start || !end) throw new Error(`Analyzer region ${region.id || index + 1} is missing timing`);
    const name = String(region.name ?? region.displayName ?? region.sectionType ?? `Region ${index + 1}`).trim();
    return { id: String(region.id ?? `analyzer-region-${String(index + 1).padStart(3, "0")}`), name: name || `Region ${index + 1}`, startPosition: start.position, endPosition: end.position, startSeconds: start.seconds, endSeconds: end.seconds };
  }).filter(region => region.endSeconds > region.startSeconds).sort((a, b) => positionToGridBeats(a.startPosition!, meter) - positionToGridBeats(b.startPosition!, meter));
  if (!regions.length) throw new Error("Analyzer package regions are empty after timing validation");
  const sourceCueToRegion = new Map<string, string>();
  sourceRegions.forEach((region, index) => {
    if (region.sourceCueId) sourceCueToRegion.set(normalizedAnalyzerId(region.sourceCueId), regions[index]?.id ?? String(region.id ?? ""));
  });
  const cues = sourceCues.map((cue, index) => {
    const timelineCue = cue as AnalyzerTimelineCueFact, phrase = String(timelineCue.phrase ?? timelineCue.name ?? timelineCue.spokenPhrase ?? "").trim();
    const start = timingFromAnalyzer(timelineCue.cueStart ?? timelineCue.start, timelineCue.atSeconds, bpm, meter);
    if (!phrase || !start) return null;
    const cueId = normalizedAnalyzerId(timelineCue.id);
    const declaredTargetRegionId = timelineCue.targetRegionId ?? timelineCue.destinationRegionId ?? sourceCueToRegion.get(cueId) ?? targetRegionByLead(cue as AnalyzerCueFact, start, regions, bpm, meter);
    const targetRegionId = repairImplausibleCueTarget(declaredTargetRegionId, start.seconds, regions, bpm, meter);
    if (!targetRegionId || !regions.some(region => region.id === targetRegionId)) return null;
    return { phrase, position: start.position, atSeconds: start.seconds, targetRegionId };
  }).filter((cue): cue is { phrase: string; position: MusicalPosition; atSeconds: number; targetRegionId: string } => cue !== null && cue.atSeconds <= durationSeconds);
  return { regions, cues };
}

function repairImplausibleCueTarget(declaredTargetRegionId: string | undefined, cueSeconds: number, regions: readonly Region[], bpm: number, meter: TimeSignature): string | undefined {
  const declared = regions.find(region => region.id === declaredTargetRegionId);
  const nearestFollowing = regions
    .filter(region => region.startSeconds >= cueSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds)[0];
  if (!declared || !nearestFollowing || declared.id === nearestFollowing.id) return declaredTargetRegionId;
  const measureSeconds = (60 / bpm) * meter.numerator * (4 / meter.denominator);
  const maximumNormalLead = measureSeconds * 2 + 0.001;
  const declaredLead = declared.startSeconds - cueSeconds;
  const nearestLead = nearestFollowing.startSeconds - cueSeconds;
  return declaredLead > maximumNormalLead && nearestLead <= maximumNormalLead
    ? nearestFollowing.id
    : declaredTargetRegionId;
}

export function analyzerPackageHasTimeline(packageData: PlaybackAnalyzerPackage): boolean {
  if (packageData.regions?.length) return true;
  return (packageData.cues ?? []).some((cue) => {
    const candidate = cue as AnalyzerCueFact;
    return Boolean(candidate.phrase && candidate.cueStart?.position && Number.isFinite(Number(candidate.leadGridBeats)));
  });
}

function deriveTimelineFromCueFacts(sourceCues: readonly (AnalyzerCueFact | AnalyzerTimelineCueFact)[], durationSeconds: number, bpm: number, meter: TimeSignature): { regions: Region[]; cues: readonly { phrase: string; position?: MusicalPosition; atSeconds: number; targetRegionId: string }[] } | null {
  const facts = sourceCues.map((cue, index) => {
    const candidate = cue as AnalyzerCueFact;
    const phrase = String(candidate.phrase ?? "").trim();
    const cueStart = timingFromAnalyzer(candidate.cueStart, undefined, bpm, meter);
    const leadGridBeats = Number(candidate.leadGridBeats);
    if (!phrase || !cueStart || !Number.isFinite(leadGridBeats)) return null;
    const regionStartPosition = addGridBeats(cueStart.position, leadGridBeats, meter);
    const regionStartSeconds = positionToSeconds(regionStartPosition, bpm, meter);
    if (!Number.isFinite(regionStartSeconds) || regionStartSeconds < 0 || regionStartSeconds >= durationSeconds) return null;
    return { index, phrase, cueStart, regionStartPosition, regionStartSeconds };
  }).filter((fact): fact is NonNullable<typeof fact> => fact !== null).sort((a, b) => positionToGridBeats(a.regionStartPosition, meter) - positionToGridBeats(b.regionStartPosition, meter));
  if (!facts.length) return null;

  const occurrence = new Map<string, number>();
  const regions: Region[] = facts.map((fact, index) => {
    const count = (occurrence.get(fact.phrase.toLowerCase()) ?? 0) + 1;
    occurrence.set(fact.phrase.toLowerCase(), count);
    const next = facts[index + 1];
    const endSeconds = next?.regionStartSeconds ?? durationSeconds;
    const endPosition = next?.regionStartPosition ?? secondsToMusicalPosition(durationSeconds, bpm, meter);
    const name = count > 1 ? `${fact.phrase} ${count}` : fact.phrase;
    return {
      id: `derived-region-${String(index + 1).padStart(3, "0")}`,
      name,
      startPosition: fact.regionStartPosition,
      endPosition,
      startSeconds: fact.regionStartSeconds,
      endSeconds,
    };
  }).filter(region => region.endSeconds > region.startSeconds);
  if (!regions.length) return null;

  const cues = facts.map((fact) => {
    const regionIndex = regions.findIndex(region => region.startSeconds === fact.regionStartSeconds);
    if (regionIndex < 0) return null;
    return {
      phrase: fact.phrase,
      position: fact.cueStart.position,
      atSeconds: fact.cueStart.seconds,
      targetRegionId: regions[regionIndex]!.id,
    };
  }).filter((cue): cue is { phrase: string; position: MusicalPosition; atSeconds: number; targetRegionId: string } => cue !== null && cue.atSeconds <= durationSeconds);
  return { regions, cues };
}

function normalizedAnalyzerId(value: unknown): string {
  return String(value ?? "").replace(/-(0+)(\d+)$/, "-$2");
}

function targetRegionByLead(cue: AnalyzerCueFact, start: { position: MusicalPosition }, regions: readonly Region[], bpm: number, meter: TimeSignature): string | undefined {
  const leadGridBeats = Number(cue.leadGridBeats);
  if (!Number.isFinite(leadGridBeats)) return undefined;
  const targetPosition = addGridBeats(start.position, leadGridBeats, meter);
  const targetSeconds = positionToSeconds(targetPosition, bpm, meter);
  return regions.find(region => Math.abs(region.startSeconds - targetSeconds) < 0.001)?.id;
}

function timingFromAnalyzer(timing: AnalyzerTimingFact | undefined, fallbackSeconds: unknown, bpm: number, meter: TimeSignature): { position: MusicalPosition; seconds: number } | null {
  const position = timing?.position ? { measure: Number(timing.position.measure), beat: Number(timing.position.beat), tick: Number(timing.position.tick ?? 0) } : undefined;
  const seconds = position ? positionToSeconds(position, bpm, meter) : Number(timing?.timeMs) / 1000;
  const resolved = Number.isFinite(seconds) ? seconds : Number(timing?.timeSeconds ?? fallbackSeconds);
  if (!Number.isFinite(resolved) || resolved < 0) return null;
  return { position: position ?? secondsToMusicalPosition(resolved, bpm, meter), seconds: resolved };
}
