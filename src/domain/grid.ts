import type { ClickEvent, MusicalPosition, TimeSignature } from "./song.js";
import { clickTemplate, requiredDefaultClickTemplate, type ClickTemplateId } from "./click-templates.js";

export interface GridPosition extends MusicalPosition {
  readonly timeSeconds: number;
  readonly isPulse: boolean;
}

export const TICKS_PER_BEAT = 960;

export function musicalPosition(measure: number, beat: number, tick = 0, meter?: TimeSignature): MusicalPosition {
  if (!Number.isInteger(measure) || measure < 1 || !Number.isInteger(beat) || beat < 1 || !Number.isInteger(tick) || tick < 0 || tick >= TICKS_PER_BEAT) throw new Error("Musical position is invalid");
  if (meter && beat > meter.numerator) throw new Error(`Beat must be between 1 and ${meter.numerator}`);
  return { measure, beat, tick };
}

export function positionToGridBeats(position: MusicalPosition, meter: TimeSignature): number {
  musicalPosition(position.measure, position.beat, position.tick, meter);
  return (position.measure - 1) * meter.numerator + (position.beat - 1) + position.tick / TICKS_PER_BEAT;
}

export function gridBeatsToPosition(gridBeats: number, meter: TimeSignature): MusicalPosition {
  if (!Number.isFinite(gridBeats) || gridBeats < 0) throw new Error("Grid-beat location is invalid");
  const whole = Math.floor(gridBeats + 1e-9), fraction = Math.max(0, gridBeats - whole);
  return musicalPosition(Math.floor(whole / meter.numerator) + 1, whole % meter.numerator + 1, Math.min(TICKS_PER_BEAT - 1, Math.round(fraction * TICKS_PER_BEAT)), meter);
}

export function addGridBeats(position: MusicalPosition, count: number, meter: TimeSignature): MusicalPosition {
  if (!Number.isFinite(count)) throw new Error("Grid-beat offset is invalid");
  return gridBeatsToPosition(positionToGridBeats(position, meter) + count, meter);
}

/** The only musical-grid to clock-time conversion used before audio rendering/scheduling. */
export function positionToSeconds(position: MusicalPosition, bpm: number, meter: TimeSignature): number {
  return positionToGridBeats(position, meter) * secondsPerNotatedBeat(bpm, meter);
}

export function secondsToMusicalPosition(seconds: number, bpm: number, meter: TimeSignature): MusicalPosition {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Clock time is invalid");
  return gridBeatsToPosition(seconds / secondsPerNotatedBeat(bpm, meter), meter);
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
    if (triggers.has(position)) events.push({ atSeconds: index * step, accent: accents.has(position), ...(profile.maxDurationSeconds ? { maxDurationSeconds: profile.maxDurationSeconds } : {}) });
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
      tick: 0,
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
