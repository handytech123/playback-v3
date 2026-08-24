import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { PreparedSong } from "../domain/song.js";
import { validateArrangementDraft, type AppArrangementDraft } from "./arrangement-editor.js";

const execFile = promisify(execFileCallback);

export type EditorReadinessLevel = "ready" | "warning" | "blocked";
export interface EditorReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly level: EditorReadinessLevel;
  readonly detail: string;
}
export interface EditorReadinessReport {
  readonly status: "Ready" | "Ready with warnings" | "Blocked";
  readonly checks: readonly EditorReadinessCheck[];
}
export interface EditorReadinessInput {
  readonly draft: AppArrangementDraft;
  readonly source: PreparedSong;
  readonly cacheRoot: string;
  readonly clickRegularPath: string;
  readonly clickAccentPath: string;
  readonly cueDirectory: string;
  readonly padPath: string;
  readonly routingReady: boolean;
  readonly midiOutputName: string | null;
  readonly ffmpegPath?: string;
}

export async function evaluateEditorReadiness(
  input: EditorReadinessInput,
): Promise<EditorReadinessReport> {
  const checks: EditorReadinessCheck[] = [];
  const draftIssues = validateArrangementDraft(input.draft);
  checks.push(check(
    "structure",
    "Arrangement structure",
    draftIssues.length ? "blocked" : "ready",
    draftIssues.length ? draftIssues.join("; ") : `${input.draft.sections.length} continuous sections`,
  ));
  const missingStems = await missing(input.source.stems.map((stem) => stem.sourcePath));
  checks.push(check(
    "stems",
    "Playable stems",
    missingStems.length ? "blocked" : "ready",
    missingStems.length ? `${missingStems.length} source stems are missing` : `${input.source.stems.length} stems available`,
  ));
  const cacheEscapes = input.source.stems.filter((stem) => {
    const path = relative(input.cacheRoot, stem.sourcePath);
    return path.startsWith("..") || isAbsolute(path);
  });
  checks.push(check(
    "cache",
    "Runtime cache isolation",
    cacheEscapes.length ? "warning" : "ready",
    cacheEscapes.length ? `${cacheEscapes.length} source stems will be rendered into the local arrangement cache when saved` : "All playable stems are local",
  ));
  const clickMissing = await missing([input.clickRegularPath, input.clickAccentPath]);
  checks.push(check(
    "click",
    "Dynamic click",
    clickMissing.length ? "blocked" : "ready",
    clickMissing.length ? "Click source audio is missing" : "Grid and click sources are available",
  ));
  const enabledCues = input.draft.cues.filter((cue) => cue.enabled);
  const cueMissing = await Promise.all(enabledCues.map(async (cue) => (await cueAvailable(input.cueDirectory, cue.phrase)) ? null : cue.phrase));
  const unavailableCues = cueMissing.filter((value): value is string => value !== null);
  checks.push(check(
    "cues",
    "Destination cues",
    unavailableCues.length ? "blocked" : "ready",
    unavailableCues.length ? `Missing cue audio: ${[...new Set(unavailableCues)].join(", ")}` : `${enabledCues.length} cues match destination sections`,
  ));
  const padMissing = (await missing([input.padPath])).length > 0;
  checks.push(check(
    "pad",
    "Key-matched pad",
    padMissing ? "blocked" : "ready",
    padMissing ? `No pad source for ${input.draft.selectedKey}` : `${input.draft.selectedKey} pad available`,
  ));
  const processingRequired = input.draft.selectedKey !== input.draft.baseKey || input.draft.selectedBpm !== input.draft.baseBpm;
  let processingAvailable = true;
  if (processingRequired) {
    try {
      const { stdout } = await execFile(input.ffmpegPath ?? "ffmpeg", ["-hide_banner", "-filters"], { maxBuffer: 16 * 1024 * 1024 });
      processingAvailable = stdout.includes("rubberband");
    } catch { processingAvailable = false; }
  }
  checks.push(check(
    "processing",
    "Key and tempo processing",
    processingAvailable ? "ready" : "blocked",
    processingRequired
      ? processingAvailable ? `${input.draft.baseKey}/${input.draft.baseBpm} -> ${input.draft.selectedKey}/${input.draft.selectedBpm}` : "FFmpeg rubberband processing is unavailable"
      : "No offline pitch or tempo change required",
  ));
  checks.push(check(
    "midi",
    "Slides MIDI",
    input.draft.midi.some((event) => event.enabled) && !input.midiOutputName ? "warning" : "ready",
    input.draft.midi.some((event) => event.enabled)
      ? input.midiOutputName ? `${input.draft.midi.filter((event) => event.enabled).length} events -> ${input.midiOutputName}` : "Events are prepared; MIDI output is disabled"
      : "No enabled Slides MIDI events",
  ));
  checks.push(check(
    "routing",
    "Performance routing",
    input.routingReady ? "ready" : "warning",
    input.routingReady ? "Six-output routing is armed" : "Stereo fallback is active",
  ));
  const status = checks.some((item) => item.level === "blocked")
    ? "Blocked"
    : checks.some((item) => item.level === "warning")
      ? "Ready with warnings"
      : "Ready";
  return { status, checks };
}

function check(id: string, label: string, level: EditorReadinessLevel, detail: string): EditorReadinessCheck {
  return { id, label, level, detail };
}

async function missing(paths: readonly string[]) {
  const result: string[] = [];
  for (const path of paths) {
    try { await access(path); } catch { result.push(path); }
  }
  return result;
}

async function cueAvailable(directory: string, label: string) {
  const normalized = normalizeCueFileLabel(label);
  const aliases: Record<string, string> = { START: "CountIn.wav", "A CAPELLA": "ACAPPELLA.wav", ACAPELLA: "ACAPPELLA.wav" };
  const direct = [
    aliases[normalized.toUpperCase()] ?? `${normalized.toUpperCase()}.wav`,
    `${normalized.toUpperCase().replace(/\s+/g, "")}.wav`,
  ];
  if ((await missing(direct.map((name) => join(directory, name)))).length < direct.length) return true;
  const match = normalized.match(/^(.*)\s+([1-6])$/);
  if (!match) return false;
  const numbers = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];
  return (await missing([
    join(directory, `${match[1]!.toUpperCase()}.wav`),
    join(directory, `${numbers[Number(match[2])]}.wav`),
  ])).length === 0;
}

function normalizeCueFileLabel(label: string) {
  return label
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])$/, "$1 $2")
    .replace(/^Turn\s*Arround/i, "Turn Around")
    .replace(/^Turnaround/i, "Turn Around")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}
