import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { validateConfirmedSet, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";
import { isMediaOnlySong, preparedControl, type PreparedSong } from "../domain/song.js";
import type { NativeReadyState } from "./native-engine-client.js";

export type PerformanceReadinessLevel = "ready" | "warning" | "blocked";
export interface PerformanceReadinessCheck { readonly id: string; readonly label: string; readonly level: PerformanceReadinessLevel; readonly detail: string; }
export interface PerformanceReadinessReport { readonly ready: boolean; readonly status: "Ready" | "Ready with warnings" | "Blocked"; readonly checks: readonly PerformanceReadinessCheck[]; }
export interface PerformanceReadinessInput { readonly manifest: ConfirmedSetManifest; readonly manifestPath: string; readonly songIndex: number; readonly native: NativeReadyState | null; readonly midiOutputName: string | null; readonly nativeError?: string | null; }

export async function evaluatePerformanceReadiness(input: PerformanceReadinessInput): Promise<PerformanceReadinessReport> {
  const checks: PerformanceReadinessCheck[] = [];
  const analyzerReview=(input.manifest as any).review;
  if(analyzerReview&&analyzerReview.performanceEligible!==true)checks.push(check("analyzer-review","Analyzer review","warning","Editor draft metadata; Performance entry is allowed"));
  const manifestReport = validateConfirmedSet(input.manifest, { requireSongAnnotations: false });
  checks.push(check("metadata", "Confirmed metadata", manifestReport.ready ? "ready" : "warning", manifestReport.ready ? `${input.manifest.songs.length} prepared song${input.manifest.songs.length === 1 ? "" : "s"}` : manifestReport.issues.map((issue) => `${issue.songTitle ? `${issue.songTitle}: ` : ""}${issue.message}`).join("; ")));
  const active = input.manifest.songs[input.songIndex];
  checks.push(check("selection", "Armed song", active ? "ready" : "warning", active ? `${active.song.title} · ${active.selectedKey} · ${active.selectedBpm} BPM` : `Song index ${input.songIndex} is outside the confirmed set`));
  // Labels, regions, and cue placement are editing aids, not playback readiness requirements.
    const stemIssues = validateConfirmedSet(input.manifest, { performanceOnly: true }).issues.map(issue => `${issue.songTitle}: ${issue.message}`);
    for (const song of input.manifest.songs) for (const stem of song.stems) {
        if (!stem.sourcePath) continue;
        try { const info = await stat(stem.sourcePath); if (!info.isFile() || info.size === 0) stemIssues.push(`${song.song.title}: ${stem.role} stem is missing or empty`); }
        catch { stemIssues.push(`${song.song.title}: ${stem.role} stem is unavailable`); }
    }
    checks.push(check("stems", "Stem audio", stemIssues.length ? "blocked" : "ready", stemIssues.length ? stemIssues.join("; ") : "All prepared stems are available"));
    const preparationNotices = input.manifest.songs.flatMap(song => (song as PreparedSong & { preparationWarnings?: string[] }).preparationWarnings ?? []);
    if (preparationNotices.length) checks.push(check("preparation", "Preparation notices", "warning", preparationNotices.join("; ")));
  const manifestDirectory = dirname(resolve(input.manifestPath));
  const packageRoot = basename(manifestDirectory).toLowerCase() === "performance" ? dirname(manifestDirectory) : manifestDirectory;
  const assetPaths = input.manifest.songs.flatMap(runtimeAssetPaths);
  const escaped = assetPaths.filter((path) => { const local = relative(packageRoot, resolve(path)); return local.startsWith("..") || isAbsolute(local); });
  checks.push(check("isolation", "Runtime cache isolation", escaped.length ? "warning" : "ready", escaped.length ? `${escaped.length} runtime asset${escaped.length === 1 ? "" : "s"} escape the confirmed package` : "No Dropbox, analyzer, Reaper, or library path is required"));
  const unavailable: string[] = [];
  for (const path of assetPaths) { try { if ((await stat(path)).size <= 0) unavailable.push(path); } catch { unavailable.push(path); } }
  checks.push(check("assets", "Prepared audio and waveform files", unavailable.length ? "warning" : "ready", unavailable.length ? `${unavailable.length} cached asset${unavailable.length === 1 ? " is" : "s are"} missing or empty` : `${assetPaths.length} cached assets verified`));
  if (!active || !input.native) {
    checks.push(check("engine", "Native audio engine", "warning", input.nativeError?.trim() || "Native engine is not armed"));
    checks.push(check("routing", "Performance routing", "warning", "No active audio device"));
    checks.push(check("midi", "Slides MIDI", hasMidi(active) ? "warning" : "ready", hasMidi(active) ? "MIDI cannot be verified until the engine is armed" : "No Slides MIDI in this arrangement"));
    checks.push(check("next", "Next-song preload", input.manifest.songs.length > input.songIndex + 1 ? "warning" : "ready", input.manifest.songs.length > input.songIndex + 1 ? "Next song is not armed" : "End of confirmed set"));
    return report(checks);
  }
  const mediaOnly=isMediaOnlySong(active),expectedClick = active.liveAssets?.click.events.length ?? 0, expectedCues = (active.liveAssets?.cues.length ?? 0) + (active.liveAssets?.countIn?.length ?? 0);
  const engineIssues = [input.native.stems !== active.stems.length ? `stems ${input.native.stems}/${active.stems.length}` : null, !mediaOnly&&input.native.clickEvents !== expectedClick ? `click events ${input.native.clickEvents ?? 0}/${expectedClick}` : null, !mediaOnly&&input.native.cueEvents !== expectedCues ? `cue events ${input.native.cueEvents ?? 0}/${expectedCues}` : null, !mediaOnly&&input.native.padKey !== active.selectedKey ? `pad ${input.native.padKey ?? "none"}/${active.selectedKey}` : null].filter((value): value is string => value !== null);
  checks.push(check("engine", "Native audio engine", engineIssues.length ? "warning" : "ready", engineIssues.length ? `Armed-state mismatch: ${engineIssues.join(", ")}` : mediaOnly?`${input.native.stems} media stem armed in ${input.native.armMs.toFixed(1)} ms`:`${input.native.stems} stems, ${expectedClick} click events, ${expectedCues} cues, ${active.selectedKey} pad armed in ${input.native.armMs.toFixed(1)} ms`));
  const channels = input.native.outputChannels ?? 0;
  checks.push(check("routing", "Performance routing", channels < 2 ? "warning" : input.native.routingReady ? "ready" : "warning", channels < 2 ? "Audio device has fewer than two active outputs" : input.native.routingReady ? `${channels} outputs armed for music/click/cue/pad` : `${channels}-output stereo fallback is active`));
  const expectedMidi = preparedControl(active)?.proPresenterMidi.length ?? 0;
  const midiCountMatches = (input.native.midiEvents ?? 0) === expectedMidi;
  const midiLevel: PerformanceReadinessLevel = !midiCountMatches ? "warning" : expectedMidi > 0 && (!input.midiOutputName || !input.native.midiEnabled) ? "warning" : "ready";
  checks.push(check("midi", "Slides MIDI", midiLevel, !midiCountMatches ? `Native scheduler has ${input.native.midiEvents ?? 0}/${expectedMidi} events` : expectedMidi === 0 ? "No Slides MIDI in this arrangement" : input.native.midiEnabled ? `${expectedMidi} events armed → ${input.midiOutputName}` : `${expectedMidi} events prepared; MIDI output is off or unavailable`));
  const hasNext = input.songIndex + 1 < input.manifest.songs.length;
  checks.push(check("next", "Next-song preload", hasNext && !input.native.nextReady ? "warning" : "ready", hasNext ? input.native.nextReady ? `Song ${input.native.nextIndex! + 1} is pre-armed` : "The next confirmed song failed to preload" : "End of confirmed set"));
  return report(checks);
}

export function manifestReadiness(manifest: ConfirmedSetManifest): PerformanceReadinessReport {
    const validated = validateConfirmedSet(manifest, { performanceOnly: true });
    return report([check("stems", "Stem audio", validated.ready ? "ready" : "blocked", validated.ready ? "Stem paths are configured; file availability is checked before playback" : validated.issues.map(issue => issue.message).join("; "))]);
}
function runtimeAssetPaths(song: PreparedSong): string[] { return [song.waveformPath, ...song.stems.map((stem) => stem.sourcePath), song.liveAssets?.click.regularPath, song.liveAssets?.click.accentPath, song.liveAssets?.repeatCuePath, song.liveAssets?.pad.audioPath, ...(song.liveAssets?.cues.map((cue) => cue.audioPath) ?? []), ...(song.liveAssets?.countIn?.map((event) => event.audioPath) ?? [])].filter((value): value is string => Boolean(value)); }
function hasMidi(song: PreparedSong | undefined) { return (preparedControl(song)?.proPresenterMidi.length ?? 0) > 0; }
function check(id: string, label: string, level: PerformanceReadinessLevel, detail: string): PerformanceReadinessCheck { return { id, label, level, detail }; }
function report(checks: readonly PerformanceReadinessCheck[]): PerformanceReadinessReport { const status = checks.some((item) => item.level === "blocked") ? "Blocked" : checks.some((item) => item.level === "warning") ? "Ready with warnings" : "Ready"; return { ready: status !== "Blocked", status, checks }; }
