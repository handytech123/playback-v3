import type { TimeSignature } from "../domain/song.js";

export interface MasterSongRow {
  readonly catalogId: string;
  readonly title: string;
  readonly artist: string;
  readonly vendor: string;
  readonly bpm: number;
  readonly key: string | null;
  readonly timeSignature: string;
  readonly folderPath: string;
}

export function parseTimeSignature(value: string): TimeSignature {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time signature: ${value}`);
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}
