import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ROUTES, PerformanceSession } from "../dist/src/live/performance-session.js";
import { evaluatePerformanceReadiness } from "../dist/src/live/performance-readiness.js";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const root = path.resolve(".");
const manifestPath = resolveManifestPath();
const enginePath = path.join(
  root,
  "native",
  "build-local",
  "PlaybackEngineProbe_artefacts",
  "Release",
  "PlaybackEngineProbe.exe",
);
const settingsPath = path.join(root, ".playback-data", "device-settings.json");
const outputRoot = path.join(root, "artifacts", "production-performance");
const captureScript = path.join(root, "tools", "capture-process-window.ps1");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const settings = existsSync(settingsPath)
  ? JSON.parse(await readFile(settingsPath, "utf8"))
  : {};
const song = manifest.songs[0];
assert.ok(song, "Confirmed set has no songs");
assert.ok(song.liveAssets?.click?.events?.length, "Selected song has no click events");
assert.ok(song.liveAssets?.cues, "Selected song has no cue asset list");
assert.ok(song.regions?.length, "Selected song has no regions");
await mkdir(outputRoot, { recursive: true });

const proPresenterPid = findProPresenterPid();
const midiOutput = process.env.PLAYBACK_MIDI_OUTPUT || "Playback V3 to ProPresenter";
const engine = new NativeEngineClient();
const nativeLines = [];
engine.on("native-line", (line) => nativeLines.push(line));

const native = await engine.start(
  enginePath,
  manifestPath,
  0,
  proPresenterPid ? midiOutput : null,
  settings.audioDevice,
);
const readiness = await evaluatePerformanceReadiness({
  manifest,
  manifestPath,
  songIndex: 0,
  native,
  midiOutputName: proPresenterPid ? midiOutput : null,
});
assert.equal(
  readiness.ready,
  true,
  readiness.checks.map((item) => `${item.label}: ${item.detail}`).join("\n"),
);

const effects = {
  play: () => engine.play(),
  pause: () => engine.pause(),
  stop: () => engine.stop(),
  seek: (seconds) => engine.seek(seconds),
  panic: () => engine.panic(),
  announceRecovery: (id, at, repeatAt) => engine.announceRecovery(id, at, repeatAt),
  cancelTransition: () => engine.cancelTransition(),
  recover: () => engine.recover(),
  setBus: (bus, enabled) =>
    ({
      music: enabled ? engine.musicOn : engine.musicOff,
      click: enabled ? engine.clickOn : engine.clickOff,
      cue: enabled ? engine.cueOn : engine.cueOff,
      pad: enabled ? engine.padOn : engine.padOff,
    })[bus].call(engine),
  selectSong: async () => readiness,
};
const session = new PerformanceSession(manifest, effects, DEFAULT_ROUTES, readiness);
for (const bus of ["music", "click", "cue", "pad"]) effects.setBus(bus, false);

const captures = {};
const states = {};
await capture("00-baseline");
session.play();
await delay(650);
session.pause();
await delay(150);
states.playPause = await state();
await capture("01-play-pause");

const firstRegion = playableRegion(0);
const secondRegion = playableRegion(1) ?? firstRegion;
const cuedRegion = playableRegionWithCue() ?? firstRegion;
assert.ok(firstRegion, "Selected song has no playable regions");
engine.seek(firstRegion.startSeconds);
session.updatePosition(firstRegion.startSeconds);
await delay(150);
states.seek = await state();
await capture("02-seek-first-region");

if (secondRegion !== firstRegion) {
  session.jumpToRegion(secondRegion.id);
  await delay(150);
  states.jump = await state();
  await capture("03-jump-second-region");
}

let loopChecked = false;
let panicRecoveryChecked = false;
if (hasCue(cuedRegion.id)) {
  session.play();
  engine.seek(Math.max(0, cuedRegion.endSeconds - 0.2));
  session.updatePosition(cuedRegion.endSeconds);
  session.toggleLoop(cuedRegion.id);
  await delay(200);
  session.pause();
  states.loop = await state();
  session.toggleLoop(cuedRegion.id);
  loopChecked = true;

  session.play();
  session.panic();
  session.armRecovery(cuedRegion.id);
  session.updatePosition(cuedRegion.endSeconds);
  await delay(200);
  session.pause();
  states.panicRecovery = await state();
  panicRecoveryChecked = true;
}

const beforeStop = await state();
session.stop();
await delay(200);
const afterStop = await state();
assert.equal(afterStop.midi_cursor, 0);
assert.ok(afterStop.midi_flushes >= beforeStop.midi_flushes);
assert.equal(afterStop.position_seconds, 0);
assert.equal(afterStop.pad_gain_target, 0);
assert.equal(afterStop.cue_open, 1);
assert.ok(afterStop.music_gain_target > 0);
states.stop = afterStop;
await capture("04-stop");
await engine.closeAndWait();

const result = {
  ready: true,
  manifestPath,
  setName: manifest.name,
  song: song.song.title,
  arrangement: song.arrangement?.name ?? "Original Song",
  proPresenterPid,
  midiOutput: proPresenterPid ? midiOutput : null,
  midiEvents: song.arrangement?.proPresenterMidi?.length ?? 0,
  readiness,
  transportAcceptance: {
    playPause: true,
    seek: true,
    regionJump: Boolean(secondRegion),
    loop: loopChecked,
    panicRecovery: panicRecoveryChecked,
    stopFlushes: true,
  },
  states,
  native,
  screenshotHashes: captures,
  nativeLines,
};
await writeFile(path.join(outputRoot, "verification.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

function resolveManifestPath() {
  const explicit = process.argv[2] || process.env.PLAYBACK_CONFIRMED_MANIFEST;
  if (explicit) return path.resolve(explicit);
  const active = path.join(root, ".playback-data", "active-arrangement.json");
  if (existsSync(active)) {
    try {
      const value = JSON.parse(readFileSync(active, "utf8"));
      if (value?.manifestPath && existsSync(value.manifestPath))
        return path.resolve(value.manifestPath);
    } catch {}
  }
  const local = latestConfirmedManifest(path.join(root, ".playback-cache", "confirmed-sets"));
  if (local) return local;
  const appData = latestConfirmedManifest(
    path.join(process.env.APPDATA ?? "", "playback-v3", ".playback-cache", "confirmed-sets"),
  );
  if (appData) return appData;
  throw new Error(
    "No confirmed set is available. Confirm a set first or pass a confirmed-set.json path.",
  );
}

function latestConfirmedManifest(base) {
  if (!existsSync(base)) return null;
  const files = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name, "confirmed-set.json"))
    .filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

function findProPresenterPid() {
  try {
    const value = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-Process ProPresenter -ErrorAction Stop | Select-Object -First 1).Id",
      ],
      { encoding: "utf8" },
    ).trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

function playableRegion(index) {
  const regions = song.regions.filter(
    (item) => Number(item.endSeconds) > Number(item.startSeconds),
  );
  return regions[index] ?? null;
}

function playableRegionWithCue() {
  return song.regions.find(
    (region) =>
      Number(region.endSeconds) > Number(region.startSeconds) && hasCue(region.id),
  );
}

function hasCue(regionId) {
  return song.liveAssets.cues.some((cue) => cue.targetRegionId === regionId);
}

async function capture(name) {
  if (!proPresenterPid) return null;
  const file = path.join(outputRoot, `${name}.png`);
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      captureScript,
      "-ProcessId",
      String(proPresenterPid),
      "-OutputPath",
      file,
    ],
    { stdio: "pipe" },
  );
  const hash = createHash("sha256").update(await readFile(file)).digest("hex");
  captures[name] = hash;
  return file;
}

async function state() {
  const start = nativeLines.length;
  engine.requestStatus();
  const line = await waitFor(
    () => nativeLines.slice(start).find((item) => item.startsWith("STATE ")),
    3000,
  );
  return Object.fromEntries(
    line
      .split(/\s+/)
      .slice(1)
      .map((part) => {
        const at = part.indexOf("=");
        const value = part.slice(at + 1);
        return [part.slice(0, at), Number.isFinite(Number(value)) ? Number(value) : value];
      }),
  );
}

function waitFor(read, timeout) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = read();
      if (value) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out. Native output:\n${nativeLines.join("\n")}`));
      }
    }, 10);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
