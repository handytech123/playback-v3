import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { validateConfirmedSet, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { preparedControl, type PreparedSong } from "../domain/song.js";
import { positionToGridBeats } from "../domain/grid.js";
import type { NativeReadyState } from "./native-engine-client.js";

export type PerformanceReadinessLevel = "ready" | "warning" | "blocked";
export interface PerformanceReadinessCheck { readonly id: string; readonly label: string; readonly level: PerformanceReadinessLevel; readonly detail: string; }
export interface PerformanceReadinessReport { readonly ready: boolean; readonly status: "Ready" | "Ready with warnings" | "Blocked"; readonly checks: readonly PerformanceReadinessCheck[]; }
export interface PerformanceReadinessInput { readonly manifest: ConfirmedSetManifest; readonly manifestPath: string; readonly songIndex: number; readonly native: NativeReadyState | null; readonly midiOutputName: string | null; readonly nativeError?: string | null; }

export async function evaluatePerformanceReadiness(input: PerformanceReadinessInput): Promise<PerformanceReadinessReport> {
  const checks: PerformanceReadinessCheck[] = [];
  const analyzerReview=(input.manifest as any).review;
  if(analyzerReview&&analyzerReview.performanceEligible!==true)checks.push(check("analyzer-review","Analyzer review","blocked","This song map is an Editor draft and requires operator approval before Performance Mode"));
  const manifestReport = validateConfirmedSet(input.manifest);
  checks.push(check("metadata", "Confirmed metadata", manifestReport.ready ? "ready" : "blocked", manifestReport.ready ? `${input.manifest.songs.length} prepared song${input.manifest.songs.length === 1 ? "" : "s"}` : manifestReport.issues.map((issue) => `${issue.songTitle ? `${issue.songTitle}: ` : ""}${issue.message}`).join("; ")));
  const active = input.manifest.songs[input.songIndex];
  checks.push(check("selection", "Armed song", active ? "ready" : "blocked", active ? `${active.song.title} - ${active.selectedKey} - ${active.selectedBpm} BPM` : `Song index ${input.songIndex} is outside the confirmed set`));
  const structureIssues = input.manifest.songs.flatMap((song) => validatePreparedStructure(song).map((message) => `${song.song.title}: ${message}`));
  const controlPrerolls=input.manifest.songs.filter(hasValidMusicalPreroll);
  checks.push(check("structure", "Song structure", structureIssues.length ? "warning" : "ready", structureIssues.length ? structureIssues.join("; ") : controlPrerolls.length?`Regions and cues are valid; ${controlPrerolls.map(song=>song.song.title).join(", ")} includes a measure-and-beat control preroll` : "Regions, cues, duration, key, BPM, and grid are internally consistent"));
  const manifestDirectory = dirname(resolve(input.manifestPath));
  const packageRoot = basename(manifestDirectory).toLowerCase() === "performance" ? dirname(manifestDirectory) : manifestDirectory;
  const assetPaths = input.manifest.songs.flatMap(runtimeAssetPaths);
  const escaped = assetPaths.filter((path) => { const local = relative(packageRoot, resolve(path)); return local.startsWith("..") || isAbsolute(local); });
  checks.push(check("isolation", "Runtime cache isolation", escaped.length ? "blocked" : "ready", escaped.length ? `${escaped.length} runtime asset${escaped.length === 1 ? "" : "s"} escape the confirmed package` : "No Dropbox, analyzer, Reaper, or library path is required"));
  const unavailable: string[] = [];
  for (const path of assetPaths) { try { if ((await stat(path)).size <= 0) unavailable.push(path); } catch { unavailable.push(path); } }
  checks.push(check("assets", "Prepared audio and waveform files", unavailable.length ? "blocked" : "ready", unavailable.length ? `${unavailable.length} cached asset${unavailable.length === 1 ? " is" : "s are"} missing or empty` : `${assetPaths.length} cached assets verified`));
  if (!active || !input.native) {
    checks.push(check("engine", "Native audio engine", "blocked", input.nativeError?.trim() || "Native engine is not armed"));
    checks.push(check("routing", "Performance routing", "blocked", "No active audio device"));
    checks.push(check("midi", "Slides MIDI", hasMidi(active) ? "warning" : "ready", hasMidi(active) ? "MIDI cannot be verified until the engine is armed" : "No Slides MIDI in this arrangement"));
    checks.push(check("next", "Next-song preload", input.manifest.songs.length > input.songIndex + 1 ? "blocked" : "ready", input.manifest.songs.length > input.songIndex + 1 ? "Next song is not armed" : "End of confirmed set"));
    return report(checks);
  }
  const audioMedia = active.song.vendor === "Playback Media" || String(active.song.id).startsWith("media-");
  const expectedClick = active.liveAssets?.click.events.length ?? 0, expectedCues = (active.liveAssets?.cues.length ?? 0) + (active.liveAssets?.countIn?.length ?? 0);
  const engineIssues = [input.native.stems !== active.stems.length ? `stems ${input.native.stems}/${active.stems.length}` : null, input.native.clickEvents !== expectedClick ? `click events ${input.native.clickEvents ?? 0}/${expectedClick}` : null, input.native.cueEvents !== expectedCues ? `cue events ${input.native.cueEvents ?? 0}/${expectedCues}` : null, !audioMedia && input.native.padKey !== active.selectedKey ? `pad ${input.native.padKey ?? "none"}/${active.selectedKey}` : null].filter((value): value is string => value !== null);
  checks.push(check("engine", "Native audio engine", engineIssues.length ? "blocked" : "ready", engineIssues.length ? `Armed-state mismatch: ${engineIssues.join(", ")}` : audioMedia ? `${input.native.stems} media stem armed in ${input.native.armMs.toFixed(1)} ms` : `${input.native.stems} stems, ${expectedClick} click events, ${expectedCues} cues, ${active.selectedKey} pad armed in ${input.native.armMs.toFixed(1)} ms`));
  const channels = input.native.outputChannels ?? 0;
  checks.push(check("routing", "Performance routing", channels < 2 ? "blocked" : input.native.routingReady ? "ready" : "warning", channels < 2 ? "Audio device has fewer than two active outputs" : input.native.routingReady ? `${channels} outputs armed for music/click/cue/pad` : `${channels}-output stereo fallback is active`));
  const expectedMidi = preparedControl(active)?.proPresenterMidi.length ?? 0;
  const midiCountMatches = (input.native.midiEvents ?? 0) === expectedMidi;
  const midiLevel: PerformanceReadinessLevel = !midiCountMatches ? "blocked" : expectedMidi > 0 && (!input.midiOutputName || !input.native.midiEnabled) ? "warning" : "ready";
  checks.push(check("midi", "Slides MIDI", midiLevel, !midiCountMatches ? `Native scheduler has ${input.native.midiEvents ?? 0}/${expectedMidi} events` : expectedMidi === 0 ? "No Slides MIDI in this arrangement" : input.native.midiEnabled ? `${expectedMidi} events armed -> ${input.midiOutputName}` : `${expectedMidi} events prepared; MIDI output is off or unavailable`));
  const hasNext = input.songIndex + 1 < input.manifest.songs.length;
  checks.push(check("next", "Next-song preload", hasNext && !input.native.nextReady ? "blocked" : "ready", hasNext ? input.native.nextReady ? `Song ${input.native.nextIndex! + 1} is pre-armed` : "The next confirmed song failed to preload" : "End of confirmed set"));
  return report(checks);
}

export function manifestReadiness(manifest: ConfirmedSetManifest): PerformanceReadinessReport {
  const validated = validateConfirmedSet(manifest);
  const analyzerReview=(manifest as any).review,checks=[check("metadata", "Confirmed metadata", validated.ready ? "ready" : "blocked", validated.ready ? "Confirmed manifest is valid" : validated.issues.map((issue) => issue.message).join("; "))];
  if(analyzerReview&&analyzerReview.performanceEligible!==true)checks.push(check("analyzer-review","Analyzer review","blocked","Operator approval is required"));
  return report(checks);
}
function validatePreparedStructure(song: PreparedSong): string[] {
  const issues: string[] = [];
  if (!song.regions.length) issues.push("no regions");
  if (song.regions[0] && Math.abs(song.regions[0].startSeconds) > .001&&!hasValidMusicalPreroll(song)) issues.push("first region has no valid measure-and-beat preroll");
  for (let index = 0; index < song.regions.length; index += 1) { const region = song.regions[index]!; if (!region.id || !region.name.trim() || region.endSeconds <= region.startSeconds) issues.push(`invalid region ${index + 1}`); const next = song.regions[index + 1]; if (next && Math.abs(region.endSeconds - next.startSeconds) > .001) issues.push(`gap or overlap after ${region.name}`); }
  const final = song.regions.at(-1); if (final && Math.abs(final.endSeconds - song.durationSeconds) > .05) issues.push("final region does not match song duration");
  const ids = new Set(song.regions.map((region) => region.id)); if (song.liveAssets?.cues.some((cue) => !ids.has(cue.targetRegionId))) issues.push("cue targets a missing region");
  return issues;
}
function hasValidMusicalPreroll(song:PreparedSong):boolean{const first=song.regions[0];if(!first)return false;if(first.startPosition){const firstBeat=positionToGridBeats(first.startPosition,song.timeSignature),cue=song.cues.find(item=>item.targetRegionId===first.id&&item.position);if(cue?.position){const lead=firstBeat-positionToGridBeats(cue.position,song.timeSignature);if(lead>0&&lead<=song.timeSignature.numerator)return true;}}const start=first.startSeconds,midi=preparedControl(song)?.proPresenterMidi??[],measureSeconds=song.timeSignature.numerator*(60/song.selectedBpm)*(4/song.timeSignature.denominator);return song.arrangement?.sourceType==="reaper-import"&&start>.001&&start<=measureSeconds+.05&&midi.some(event=>event.atSeconds>=0&&event.atSeconds<start);}
function runtimeAssetPaths(song: PreparedSong): string[] { return [song.waveformPath, ...song.stems.map((stem) => stem.sourcePath), song.liveAssets?.click.regularPath, song.liveAssets?.click.accentPath, song.liveAssets?.repeatCuePath, song.liveAssets?.pad.audioPath, ...(song.liveAssets?.cues.map((cue) => cue.audioPath) ?? []), ...(song.liveAssets?.countIn?.map((event) => event.audioPath) ?? [])].filter((value): value is string => Boolean(value)); }
function hasMidi(song: PreparedSong | undefined) { return (preparedControl(song)?.proPresenterMidi.length ?? 0) > 0; }
function check(id: string, label: string, level: PerformanceReadinessLevel, detail: string): PerformanceReadinessCheck { return { id, label, level, detail }; }
function report(checks: readonly PerformanceReadinessCheck[]): PerformanceReadinessReport { const status = checks.some((item) => item.level === "blocked") ? "Blocked" : checks.some((item) => item.level === "warning") ? "Ready with warnings" : "Ready"; return { ready: status !== "Blocked", status, checks }; }
