import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  applyArrangementCommand,
  createArrangementDraft,
} from "../dist/src/edit/arrangement-editor.js";
import { saveAppArrangement } from "../dist/src/edit/app-arrangement-save.js";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const execFile = promisify(execFileCallback);
const root = path.resolve(".");
const sourceManifest = JSON.parse(
  await readFile(
    path.resolve(
      ".playback-cache/milestone-1-cornerstone-performance-v3/confirmed-set.json",
    ),
    "utf8",
  ),
);
const source = sourceManifest.songs[0];
let draft = createArrangementDraft(
  source,
  "Cornerstone Automated Edit Validation",
);
draft = applyArrangementCommand(draft, { type: "trim-end", atPosition: { measure: 6, beat: 1, tick: 0 } });
draft = applyArrangementCommand(draft, {
  type: "set-key-tempo",
  key: "D",
  bpm: 80,
});
draft = applyArrangementCommand(draft, {
  type: "rename-section",
  sectionId: draft.sections[0].id,
  name: "Start",
});

const result = await saveAppArrangement({
  draft,
  source,
  metadataRoot: path.resolve(".playback-metadata"),
  cacheRoot: path.resolve(".playback-cache"),
});
const renderedManifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
const renderedSong = renderedManifest.songs[0];
const performanceRoot = path.dirname(result.manifestPath);
const arrangementCacheRoot = path.dirname(performanceRoot);
const runtimePaths = [
  renderedSong.waveformPath,
  ...renderedSong.stems.map((stem) => stem.sourcePath),
  renderedSong.liveAssets.click.regularPath,
  renderedSong.liveAssets.click.accentPath,
  renderedSong.liveAssets.pad.audioPath,
  ...renderedSong.liveAssets.cues.map((cue) => cue.audioPath),
];
for (const runtimePath of runtimePaths) {
  const relative = path.relative(arrangementCacheRoot, runtimePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Runtime asset escaped the confirmed cache: ${runtimePath}`);
  }
}
const { stdout: durationOutput } = await execFile("ffprobe", [
  "-v",
  "error",
  "-show_entries",
  "format=duration",
  "-of",
  "default=noprint_wrappers=1:nokey=1",
  renderedSong.stems[0].sourcePath,
]);
const renderedStemDurationSeconds = Number(durationOutput.trim());
if (Math.abs(renderedStemDurationSeconds - draft.durationSeconds) > 0.001) {
  throw new Error(
    `Rendered stem duration ${renderedStemDurationSeconds} does not match ${draft.durationSeconds}`,
  );
}

const enginePath = path.join(
  root,
  "native",
  "build",
  "PlaybackEngineProbe_artefacts",
  "Release",
  "PlaybackEngineProbe.exe",
);
const engine = new NativeEngineClient();
const status = () =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Native state timeout")),
      2_000,
    );
    engine.once("transport", (state) => {
      clearTimeout(timeout);
      resolve(state);
    });
    engine.requestStatus();
  });
let ready;
let sought;
try {
  ready = await engine.start(enginePath, result.manifestPath);
  if (
    ready.stems !== 9 ||
    ready.clickEvents < 1 ||
    ready.cueEvents !== 2 ||
    ready.padKey !== "D"
  ) {
    throw new Error("Native engine did not arm every rendered live asset");
  }
  engine.play();
  await delay(150);
  const playing = await status();
  if (playing.state !== "playing" || playing.positionSeconds <= 0) {
    throw new Error("Rendered arrangement did not play");
  }
  engine.seek(4.5);
  sought = await status();
  if (Math.abs(sought.positionSeconds - 4.5) > 0.001) {
    throw new Error("Rendered arrangement seek was not exact");
  }
  engine.stop();
  const stopped = await status();
  if (stopped.positionSeconds !== 0) {
    throw new Error("Rendered arrangement did not stop at zero");
  }
} finally {
  engine.close();
}

const summary = {
  ready: true,
  id: result.id,
  name: result.arrangement.name,
  key: result.arrangement.selectedKey,
  bpm: result.arrangement.selectedBpm,
  durationSeconds: result.arrangement.durationSeconds,
  renderedStemDurationSeconds,
  regions: result.arrangement.regions.length,
  stems: result.arrangement.mediaItems.length,
  manifestPath: result.manifestPath,
  cacheIsolated: true,
  native: {
    armMs: ready.armMs,
    stems: ready.stems,
    clickEvents: ready.clickEvents,
    cueEvents: ready.cueEvents,
    padKey: ready.padKey,
    seekPositionSeconds: sought.positionSeconds,
  },
  originalPreserved: {
    key: source.song.originalKey,
    bpm: source.song.originalBpm,
    durationSeconds: source.durationSeconds,
  },
};
await writeFile(
  path.resolve("artifacts/app-arrangement-verification.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
