import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { validateConfirmedSet } from "../dist/src/confirmed-set/manifest.js";
import { validateArrangementDraft } from "../dist/src/edit/arrangement-editor.js";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const root = path.resolve(".");
const arrangementsRoot = path.join(root, ".playback-cache", "arrangements");
let selected = null;
for (const entry of await readdir(arrangementsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(arrangementsRoot, entry.name, "performance", "confirmed-set.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.name === "Cornerstone Editor Workspace Validation") selected = { manifestPath, manifest, directory: path.join(arrangementsRoot, entry.name) };
  } catch {}
}
if (!selected) throw new Error("The in-app editor render was not found");
const report = validateConfirmedSet(selected.manifest);
if (!report.ready) throw new Error(report.issues.map((issue) => issue.message).join("; "));
const song = selected.manifest.songs[0];
if (song.song.originalKey !== "C" || song.song.originalBpm !== 72) throw new Error("Original Song facts changed");
if (song.selectedKey !== "D" || song.selectedBpm !== 80 || song.stems.length !== 9 || song.regions.length !== 2) throw new Error("Saved editor arrangement facts are incorrect");
const runtimePaths = [song.waveformPath, ...song.stems.map((stem) => stem.sourcePath), song.liveAssets.click.regularPath, song.liveAssets.click.accentPath, song.liveAssets.pad.audioPath, ...song.liveAssets.cues.map((cue) => cue.audioPath)];
for (const runtimePath of runtimePaths) {
  const relative = path.relative(selected.directory, runtimePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Runtime path escaped editor arrangement cache: ${runtimePath}`);
}
const draftRoot = path.join(root, ".playback-data", "editor-drafts");
const drafts = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(target);
    else if (entry.name.endsWith(".json")) drafts.push(JSON.parse(await readFile(target, "utf8")));
  }
}
await collect(draftRoot);
const savedDraft = drafts.find((draft) => draft.name === "Cornerstone Editor Workspace Validation");
if (!savedDraft || validateArrangementDraft(savedDraft).length) throw new Error("Saved editor draft was not restored as a valid draft");
const waveformDirectory = path.join(root, ".playback-cache", "editor-waveforms");
const waveformBundles = await Promise.all((await readdir(waveformDirectory)).filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(waveformDirectory, name), "utf8"))));
if (!waveformBundles.some((bundle) => bundle.stems.length === 9) || !waveformBundles.some((bundle) => bundle.stems.length === 13)) throw new Error("Summary/stacked waveform caches do not cover Original and Reaper arrangements");
const enginePath = path.join(root, "native", "build-local", "PlaybackEngineProbe_artefacts", "Release", "PlaybackEngineProbe.exe");
const engine = new NativeEngineClient();
const status = () => new Promise((resolveStatus, reject) => {
  const timeout = setTimeout(() => reject(new Error("Native status timeout")), 2000);
  engine.once("transport", (state) => { clearTimeout(timeout); resolveStatus(state); });
  engine.requestStatus();
});
let ready;
try {
  ready = await engine.start(enginePath, selected.manifestPath);
  engine.play(); await delay(150);
  const playing = await status(); if (playing.state !== "playing" || playing.positionSeconds <= 0) throw new Error("Saved editor arrangement did not play");
  engine.seek(4.5); const sought = await status(); if (Math.abs(sought.positionSeconds - 4.5) > .001) throw new Error("Saved editor arrangement seek failed");
  engine.stop(); const stopped = await status(); if (stopped.positionSeconds !== 0) throw new Error("Saved editor arrangement stop failed");
} finally { engine.close(); }
const summary = {ready:true,name:selected.manifest.name,manifestPath:selected.manifestPath,sourceType:song.arrangement.sourceType,originalPreserved:{key:song.song.originalKey,bpm:song.song.originalBpm},arrangement:{key:song.selectedKey,bpm:song.selectedBpm,regions:song.regions.length,stems:song.stems.length,cues:song.liveAssets.cues.length,pad:song.liveAssets.pad.key},waveformCaches:waveformBundles.map((bundle)=>bundle.stems.length),draftRestored:true,cacheIsolated:true,native:{armMs:ready.armMs,seekSeconds:4.5}};
await writeFile(path.join(root,"artifacts","editor-workspace-verification.json"),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
