import type { PreparedSong } from "../domain/song.js";

export const CONFIRMED_SET_SCHEMA_VERSION = 1;

export interface ConfirmedSetManifest {
  readonly schemaVersion: typeof CONFIRMED_SET_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly confirmedAt: string;
  readonly songs: readonly PreparedSong[];
  readonly show?: ConfirmedSetShowState;
}

export interface ConfirmedSetShowState {
  readonly mixer: Readonly<Record<"music" | "click" | "cue" | "pad", number>>;
  readonly routing: Readonly<Record<"music" | "click" | "cue" | "pad", { readonly firstOutput: number; readonly channels: 1 | 2 }>>;
  readonly transition: { readonly cueNextEnablesPad: boolean; readonly stopBeforeSongChange: boolean };
  readonly panic: { readonly musicFadeMs: number; readonly padFadeMs: number; readonly recoveryAtSectionBoundary: boolean };
}

export const DEFAULT_SHOW_STATE: ConfirmedSetShowState = {
  mixer: { music: 1, click: 1, cue: 1, pad: 1 },
  routing: { music: { firstOutput: 15, channels: 1 }, click: { firstOutput: 1, channels: 1 }, cue: { firstOutput: 2, channels: 1 }, pad: { firstOutput: 16, channels: 1 } },
  transition: { cueNextEnablesPad: true, stopBeforeSongChange: true },
  panic: { musicFadeMs: 120, padFadeMs: 400, recoveryAtSectionBoundary: true },
};

export interface ReadinessIssue {
  readonly songTitle?: string;
  readonly message: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly issues: readonly ReadinessIssue[];
}

export function validateConfirmedSet(manifest: ConfirmedSetManifest): ReadinessReport {
  const issues: ReadinessIssue[] = [];
  if (manifest.schemaVersion !== CONFIRMED_SET_SCHEMA_VERSION) {
    issues.push({ message: `Unsupported schema version: ${manifest.schemaVersion}` });
  }
  if (manifest.songs.length === 0) issues.push({ message: "Setlist is empty" });

  for (const prepared of manifest.songs) {
    const songTitle = prepared.song.title;
    if (!prepared.cacheFingerprint) issues.push({ songTitle, message: "Prepared cache fingerprint is missing" });
    if (prepared.stems.length === 0) issues.push({ songTitle, message: "No playable music stems" });
    if (prepared.durationSeconds <= 0) issues.push({ songTitle, message: "Song duration must be positive" });
    if (prepared.selectedBpm <= 0) issues.push({ songTitle, message: "Selected BPM must be positive" });
    if (!prepared.selectedKey) issues.push({ songTitle, message: "Selected key is missing" });
    if (!prepared.waveformPath) issues.push({ songTitle, message: "Prepared waveform is missing" });
    if (!prepared.liveAssets) issues.push({ songTitle, message: "Prepared live assets are missing" });
    else {
      if (!prepared.liveAssets.click.regularPath || !prepared.liveAssets.click.accentPath || prepared.liveAssets.click.events.length === 0) issues.push({ songTitle, message: "Dynamic click plan is incomplete" });
      if (prepared.liveAssets.click.events[0]?.atSeconds !== 0) issues.push({ songTitle, message: "Dynamic click must begin at 0.000" });
      if (prepared.liveAssets.cues.length === 0) issues.push({ songTitle, message: "Dynamic cue plan is empty" });
      if (!prepared.liveAssets.repeatCuePath) issues.push({ songTitle, message: "Repeat cue is missing" });
      if (!prepared.liveAssets.pad.audioPath || prepared.liveAssets.pad.key !== prepared.selectedKey) issues.push({ songTitle, message: "Dynamic pad does not match selected key" });
      if (prepared.liveAssets.cues.some((cue) => cue.atSeconds < 0 || cue.atSeconds > prepared.durationSeconds || !cue.audioPath)) issues.push({ songTitle, message: "Dynamic cue plan contains an invalid event" });
    }
    for (const stem of prepared.stems) {
      if (!stem.sourcePath) issues.push({ songTitle, message: `Stem ${stem.role} has no cache path` });
    }
  }
  return { ready: issues.length === 0, issues };
}
