import type { ClickTemplateId } from "./click-templates.js";

export type SongId = string & { readonly __songId: unique symbol };

export interface TimeSignature {
  readonly numerator: number;
  readonly denominator: number;
}

export interface OriginalSongFacts {
  readonly id: SongId;
  readonly title: string;
  readonly artist: string;
  readonly vendor: string;
  readonly originalKey: string;
  readonly originalBpm: number;
  readonly originalTimeSignature: TimeSignature;
}

export interface AudioStem {
  readonly role: string;
  readonly sourcePath: string;
  readonly durationSeconds: number;
}

export interface Region {
  readonly id: string;
  readonly name: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface Cue {
  readonly phrase: string;
  readonly atSeconds: number;
  readonly targetRegionId: string;
}

export interface PreparedSong {
  readonly song: OriginalSongFacts;
  readonly selectedKey: string;
  readonly selectedBpm: number;
  readonly timeSignature: TimeSignature;
  readonly durationSeconds: number;
  readonly stems: readonly AudioStem[];
  readonly regions: readonly Region[];
  readonly cues: readonly Cue[];
  readonly cacheFingerprint: string;
  readonly waveformPath?: string;
  readonly liveAssets?: LiveAssetPlan;
  readonly control?: PreparedControlMetadata;
  readonly arrangement?: PreparedArrangementMetadata;
}

export interface PreparedMidiEvent { readonly atSeconds: number; readonly status: number; readonly data1: number; readonly data2: number; }
export interface PreparedControlMetadata {
  readonly sourceType: "reaper-import" | "app-edit";
  readonly sourceSha256: string;
  readonly proPresenterMidi: readonly PreparedMidiEvent[];
  readonly midiOutputName: string | null;
}
export interface PreparedArrangementMetadata extends PreparedControlMetadata {
  readonly id: string;
  readonly name: string;
}

export function preparedControl(song: PreparedSong | undefined): PreparedControlMetadata | null { return song?.control ?? song?.arrangement ?? null; }

export interface ClickEvent { readonly atSeconds: number; readonly accent: boolean; }
export interface CueEvent { readonly atSeconds: number; readonly label: string; readonly audioPath: string; readonly targetRegionId: string; }
export interface CountInEvent { readonly atSeconds: number; readonly label: string; readonly audioPath: string; }
export interface LiveAssetPlan {
  readonly click: { readonly regularPath: string; readonly accentPath: string; readonly events: readonly ClickEvent[]; readonly templateId?: ClickTemplateId };
  readonly cues: readonly CueEvent[];
  readonly countIn?: readonly CountInEvent[];
  readonly cueCountVersion?: 1 | 2;
  readonly repeatCuePath: string;
  readonly pad: { readonly key: string; readonly audioPath: string };
}

export function songId(value: string): SongId {
  if (!value.trim()) throw new Error("Song ID must not be empty");
  return value as SongId;
}
