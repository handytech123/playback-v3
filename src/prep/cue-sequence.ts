import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { secondsPerNotatedBeat } from "../domain/grid.js";
import type { TimeSignature } from "../domain/song.js";
import type { AnalyzerCountPattern } from "../library/analyzer-package.js";

const run = promisify(execFile);
const NUMBER_NAMES = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;

export function countedCueDelays(bpm: number, meter: TimeSignature, countPattern?: AnalyzerCountPattern): readonly { label: string; delaySeconds: number }[] {
  if (countPattern) {
    const beatSeconds = secondsPerNotatedBeat(bpm, meter);
    const positions: Record<AnalyzerCountPattern, readonly number[]> = { "234": [2,3,4], "456": [4,5,6], "23456": [2,3,4,5,6] };
    return positions[countPattern].map(position => ({ label: String(position), delaySeconds: (position - 1) * beatSeconds }));
  }
  if (meter.numerator < 2 || meter.numerator >= NUMBER_NAMES.length) return [];
  const beatSeconds = secondsPerNotatedBeat(bpm, meter);
  return Array.from({ length: meter.numerator - 1 }, (_, index) => ({ label: String(index + 2), delaySeconds: (index + 1) * beatSeconds }));
}

/** Writes one atomic section phrase: label on beat 1, then spoken beats 2..N. */
export async function writeCountedCue(input: { sourcePath: string; destinationPath: string; numberDirectory: string; bpm: number; meter: TimeSignature; countPattern?: AnalyzerCountPattern; ffmpegPath?: string }): Promise<void> {
  const delays = countedCueDelays(input.bpm, input.meter, input.countPattern);
  if (!delays.length) throw new Error(`Counted cues do not support ${input.meter.numerator}/${input.meter.denominator}`);
  const numberPaths = await Promise.all(delays.map(event => resolveNumberPath(input.numberDirectory, NUMBER_NAMES[Number(event.label)]!, input.meter)));
  const filters = delays.map((event, index) => `[${index + 1}:a]adelay=${Math.round(event.delaySeconds * 1000)}:all=1[n${event.label}]`);
  const mixInputs = ["[0:a]", ...delays.map((event) => `[n${event.label}]`)].join("");
  filters.push(`${mixInputs}amix=inputs=${delays.length + 1}:duration=longest:normalize=0,alimiter=limit=0.98[out]`);
  await run(input.ffmpegPath ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input.sourcePath,
    ...numberPaths.flatMap((path) => ["-i", path]),
    "-filter_complex", filters.join(";"), "-map", "[out]", "-map_metadata", "-1", "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", input.destinationPath,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if ((await stat(input.destinationPath)).size === 0) throw new Error(`Prepared counted cue is empty: ${input.sourcePath}`);
}

async function resolveNumberPath(directory: string, name: string, meter: TimeSignature): Promise<string> {
  const candidates = meter.numerator === 6 && meter.denominator === 8 ? [`${name} 6 8.wav`, `${name}.wav`] : [`${name}.wav`];
  for (const candidate of candidates) {
    const path = join(directory, candidate);
    try { if ((await stat(path)).isFile()) return path; } catch {}
  }
  return join(directory, candidates[0]!);
}
