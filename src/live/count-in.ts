import { join } from "node:path";
import { secondsPerNotatedBeat } from "../domain/grid.js";
import type { PreparedSong } from "../domain/song.js";

const NUMBER_NAMES = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;

export interface CountInSourceEvent {
  readonly atSeconds: number;
  readonly label: string;
  readonly sourcePath: string;
}

/** Spoken beats 2..N follow the first section cue and finish at its boundary. */
export function buildCountInSources(song: PreparedSong, cueDirectory: string): readonly CountInSourceEvent[] {
  const firstCue = [...(song.liveAssets?.cues ?? [])].sort((a, b) => a.atSeconds - b.atSeconds)[0];
  const beats = song.timeSignature.numerator;
  if (!firstCue || beats < 2 || beats >= NUMBER_NAMES.length) return [];
  const target = song.regions.find((region) => region.id === firstCue.targetRegionId);
  if (!target) return [];
  const beatSeconds = secondsPerNotatedBeat(song.selectedBpm, song.timeSignature);
  return Array.from({ length: beats - 1 }, (_, index) => {
    const number = index + 2;
    return { atSeconds: firstCue.atSeconds + (number - 1) * beatSeconds, label: String(number), sourcePath: join(cueDirectory, `${NUMBER_NAMES[number]}.wav`) };
  }).filter((event) => event.atSeconds < target.startSeconds - 0.001);
}
