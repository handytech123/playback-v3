import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PreparedSong } from "../domain/song.js";
import type { AppArrangementDraft } from "./arrangement-editor.js";
import type { RenderedArrangementStem } from "../reaper/arrangement-renderer.js";

export async function renderAppArrangement(draft: AppArrangementDraft, source: PreparedSong, outputDirectory: string, ffmpegPath = "ffmpeg", displayLabels?: readonly string[]): Promise<readonly RenderedArrangementStem[]> {
  if (!source.stems.length) throw new Error("Source song has no playable stems");
  await mkdir(outputDirectory, { recursive: true });
  const filter = buildArrangementFilter(draft);
  const result: RenderedArrangementStem[] = [];
  for (const [stemIndex, stem] of source.stems.entries()) {
    const displayName = displayLabels?.[stemIndex] ?? stem.displayName ?? stem.role;
    const output = join(outputDirectory, `${String(stemIndex + 1).padStart(2, "0")}-${safe(displayName)}.wav`);
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", stem.sourcePath, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s24le", output]);
    result.push({ role: stem.role, displayName, sourcePath: output, durationSeconds: draft.durationSeconds, rendered: true });
  }
  return result;
}

/** Assemble the arrangement before processing so Rubber Band incurs latency once per stem, not once per section. */
export function buildArrangementFilter(draft: AppArrangementDraft): string {
  if (!draft.sections.length) throw new Error("Arrangement has no sections");
  const tempo = draft.selectedBpm / draft.baseBpm;
  const pitch = Math.pow(2, keyDistance(draft.baseKey, draft.selectedKey) / 12);
  const filters = draft.sections.map((section, index) => `[0:a]atrim=start=${section.sourceStartSeconds}:end=${section.sourceEndSeconds},asetpts=PTS-STARTPTS[s${index}]`);
  const inputs = draft.sections.map((_, index) => `[s${index}]`).join("");
  filters.push(`${inputs}concat=n=${draft.sections.length}:v=0:a=1[arranged]`);
  const processing = near(tempo, 1) && near(pitch, 1) ? "" : `rubberband=tempo=${tempo}:pitch=${pitch},`;
  // Catalog duration can exceed the physical source by a few samples. Always
  // deliver an exact arrangement-length stem to keep click/cues synchronized.
  filters.push(`[arranged]${processing}apad=whole_dur=${draft.durationSeconds},atrim=duration=${draft.durationSeconds},asetpts=PTS-STARTPTS[out]`);
  return filters.join(";");
}

export function keyDistance(from: string, to: string): number {
  const values: Record<string, number> = { C: 0, "B#": 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, FB: 4, "E#": 5, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11, CB: 11 };
  const a = values[from.trim().toUpperCase()], b = values[to.trim().toUpperCase()];
  if (a === undefined || b === undefined) throw new Error(`Unsupported key change: ${from} to ${to}`);
  let distance = b - a;
  if (distance > 6) distance -= 12;
  if (distance < -6) distance += 12;
  return distance;
}

function run(command: string, args: string[]): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] }); let error = ""; child.stderr.on("data", chunk => error += chunk); child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Arrangement render failed (${code}): ${error.trim()}`))); }); }
function safe(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stem"; }
function near(a: number, b: number) { return Math.abs(a - b) < .000001; }
