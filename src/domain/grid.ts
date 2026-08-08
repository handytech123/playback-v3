import type { ClickEvent, TimeSignature } from "./song.js";
import { clickTemplate, requiredDefaultClickTemplate, type ClickTemplateId } from "./click-templates.js";

export interface GridPosition {
  readonly measure: number;
  readonly beat: number;
  readonly timeSeconds: number;
  readonly isPulse: boolean;
}

export function secondsPerNotatedBeat(bpm: number, meter: TimeSignature): number {
  assertMeterAndTempo(bpm, meter);
  const compoundEighthMeter = meter.denominator === 8 && meter.numerator % 3 === 0 && meter.numerator > 3;
  if (compoundEighthMeter) return 60 / bpm;
  return (60 / bpm) * (4 / meter.denominator);
}

/** Builds click events exclusively from the V3 template registry. */
export function buildDynamicClickEvents(bpm: number, meter: TimeSignature, durationSeconds: number, templateId: ClickTemplateId = requiredDefaultClickTemplate(meter)): readonly ClickEvent[] {
  const profile = clickTemplate(templateId, meter);
  const measureSeconds = secondsPerNotatedBeat(bpm, meter) * meter.numerator;
  const step = measureSeconds / profile.positionsPerMeasure;
  const count = Math.floor((durationSeconds + Number.EPSILON) / step);
  const triggers = new Set(profile.triggerPositions), accents = new Set(profile.accentPositions);
  const events: ClickEvent[] = [];
  for (let index = 0; index <= count; index += 1) {
    const position = index % profile.positionsPerMeasure + 1;
    if (triggers.has(position)) events.push({ atSeconds: index * step, accent: accents.has(position) });
  }
  return events;
}

export function buildZeroBasedGrid(
  bpm: number,
  meter: TimeSignature,
  durationSeconds: number,
): readonly GridPosition[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error("Duration must be a finite non-negative number");
  }
  const step = secondsPerNotatedBeat(bpm, meter);
  const positions: GridPosition[] = [];
  const count = Math.floor((durationSeconds + Number.EPSILON) / step);
  const compound = meter.denominator === 8 && meter.numerator % 3 === 0 && meter.numerator > 3;

  for (let index = 0; index <= count; index += 1) {
    const beatIndex = index % meter.numerator;
    positions.push({
      measure: Math.floor(index / meter.numerator) + 1,
      beat: beatIndex + 1,
      timeSeconds: index * step,
      isPulse: compound ? beatIndex % 3 === 0 : true,
    });
  }
  return positions;
}

function assertMeterAndTempo(bpm: number, meter: TimeSignature): void {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("BPM must be positive");
  if (!Number.isInteger(meter.numerator) || meter.numerator <= 0) {
    throw new Error("Time-signature numerator must be a positive integer");
  }
  if (![2, 4, 8, 16].includes(meter.denominator)) {
    throw new Error("Unsupported time-signature denominator");
  }
}
