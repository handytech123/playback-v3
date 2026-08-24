import type { PreparedSong } from "../domain/song.js";
import { validateSongTransition, type SongTransitionPlan } from "../live/song-transition.js";

export const CONFIRMED_SET_SCHEMA_VERSION = 1;

export interface ConfirmedSetManifest {
  readonly schemaVersion: typeof CONFIRMED_SET_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly confirmedAt: string;
  readonly songs: readonly PreparedSong[];
  readonly transitions?:readonly SongTransitionPlan[];
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
  routing: { music: { firstOutput: 4, channels: 1 }, click: { firstOutput: 1, channels: 1 }, cue: { firstOutput: 2, channels: 1 }, pad: { firstOutput: 12, channels: 1 } },
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
  for(const transition of manifest.transitions??[]){try{validateSongTransition(transition,manifest.songs.length);}catch(error){issues.push({message:error instanceof Error?error.message:String(error)});}}

  for (const prepared of manifest.songs) {
    const songTitle = prepared.song.title;
    const audioMedia = prepared.song.vendor === "Playback Media" || String(prepared.song.id).startsWith("media-");
    const requiresMusicalLocations = Number((manifest as any).review?.songMapVersion ?? 0) >= 8;
    if (!prepared.cacheFingerprint) issues.push({ songTitle, message: "Prepared cache fingerprint is missing" });
    if(prepared.loudnessNormalization){const level=prepared.loudnessNormalization;if(level.version!==1||!Number.isFinite(level.measuredLufs)||!Number.isFinite(level.measuredTruePeakDbtp)||!Number.isFinite(level.appliedGainDb)||level.appliedGainDb < -6||level.appliedGainDb > 6)issues.push({songTitle,message:"Song loudness normalization is invalid"});}
    if (prepared.stems.length === 0) issues.push({ songTitle, message: "No playable music stems" });
    if (prepared.durationSeconds <= 0) issues.push({ songTitle, message: "Song duration must be positive" });
    if (prepared.selectedBpm <= 0) issues.push({ songTitle, message: "Selected BPM must be positive" });
    if (!prepared.selectedKey) issues.push({ songTitle, message: "Selected key is missing" });
    if (!prepared.waveformPath) issues.push({ songTitle, message: "Prepared waveform is missing" });
    if (!prepared.liveAssets) {
      if (!audioMedia) issues.push({ songTitle, message: "Prepared live assets are missing" });
    } else {
      if (!prepared.liveAssets.click.regularPath || !prepared.liveAssets.click.accentPath || prepared.liveAssets.click.events.length === 0) issues.push({ songTitle, message: "Dynamic click plan is incomplete" });
      if (prepared.liveAssets.click.events[0]?.atSeconds !== 0) issues.push({ songTitle, message: "Dynamic click must begin at measure 1 beat 1" });
      if (prepared.liveAssets.cues.length === 0) issues.push({ songTitle, message: "Dynamic cue plan is empty" });
      if (!prepared.liveAssets.repeatCuePath) issues.push({ songTitle, message: "Repeat cue is missing" });
      if (!prepared.liveAssets.pad.audioPath || prepared.liveAssets.pad.key !== prepared.selectedKey) issues.push({ songTitle, message: "Dynamic pad does not match selected key" });
      if (prepared.liveAssets.cues.some((cue) => cue.atSeconds < 0 || cue.atSeconds > prepared.durationSeconds || !cue.audioPath)) issues.push({ songTitle, message: "Dynamic cue plan contains an invalid event" });
      if (prepared.liveAssets.countIn?.some((event) => event.atSeconds < 0 || event.atSeconds > prepared.durationSeconds || !event.audioPath)) issues.push({ songTitle, message: "Dynamic count-in plan contains an invalid event" });
    }
    for (const stem of prepared.stems) {
      if (!stem.sourcePath) issues.push({ songTitle, message: `Stem ${stem.role} has no cache path` });
    }
    if (requiresMusicalLocations && prepared.regions.some(region => !region.startPosition || !region.endPosition)) issues.push({ songTitle, message: "A region is missing its measure-and-beat boundary" });
    if (requiresMusicalLocations && prepared.cues.some(cue => !cue.position)) issues.push({ songTitle, message: "A cue is missing its measure-and-beat location" });
  }
  return { ready: issues.length === 0, issues };
}
