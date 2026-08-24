import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PerformanceSession, DEFAULT_ROUTES } from "../dist/src/live/performance-session.js";
import { evaluatePerformanceReadiness } from "../dist/src/live/performance-readiness.js";
import { NativeEngineClient } from "../dist/src/live/native-engine-client.js";

const root = path.resolve(".");
const manifestPath = path.join(root, ".playback-cache", "arrangements", "reaper-72091bdc9061", "performance", "confirmed-set.json");
const enginePath = path.join(root, "native", "build-local", "PlaybackEngineProbe_artefacts", "Release", "PlaybackEngineProbe.exe");
const settingsPath = path.join(root, ".playback-data", "device-settings.json");
const outputRoot = path.join(root, "artifacts", "production-performance");
const captureScript = path.join(root, "tools", "capture-process-window.ps1");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const settings = JSON.parse(await readFile(settingsPath, "utf8"));
const song = manifest.songs[0];
assert.equal(song.selectedKey, "B");
assert.equal(song.arrangement?.proPresenterMidi.length, 59);
const slidesTrack = "Slides";

const pp = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process ProPresenter -ErrorAction Stop | Select-Object -First 1).Id"], { encoding: "utf8" }).trim();
assert.match(pp, /^\d+$/);
const preferences = await readFile(path.join(process.env.APPDATA, "RenewedVision", "ProPresenter", "Preferences", "CommunicationsPreferences.proPref"), "utf8");
assert.match(preferences, /loopMIDI Port/);
await mkdir(outputRoot, { recursive: true });

const engine = new NativeEngineClient(), nativeLines = [];
engine.on("native-line", (line) => nativeLines.push(line));
const midiOutput = "Playback V3 to ProPresenter";
const native = await engine.start(enginePath, manifestPath, 0, midiOutput, settings.audioDevice);
assert.equal(native.midiEnabled, true);
assert.equal(native.midiEvents, song.arrangement.proPresenterMidi.length);
const readiness = await evaluatePerformanceReadiness({ manifest, manifestPath, songIndex: 0, native, midiOutputName: midiOutput });
assert.equal(readiness.ready, true, readiness.checks.map((item) => `${item.label}: ${item.detail}`).join("\n"));

const effects = {
  play: () => engine.play(), pause: () => engine.pause(), stop: () => engine.stop(), seek: (seconds) => engine.seek(seconds), panic: () => engine.panic(),
  announceRecovery: (id, at, repeatAt) => engine.announceRecovery(id, at, repeatAt), cancelTransition: () => engine.cancelTransition(), recover: () => engine.recover(),
  setBus: (bus, enabled) => ({ music: enabled ? engine.musicOn : engine.musicOff, click: enabled ? engine.clickOn : engine.clickOff, cue: enabled ? engine.cueOn : engine.cueOff, pad: enabled ? engine.padOn : engine.padOff })[bus].call(engine),
  selectSong: async () => readiness,
};
const session = new PerformanceSession(manifest, effects, DEFAULT_ROUTES, readiness);
for (const bus of ["music", "click", "cue", "pad"]) effects.setBus(bus, false);

const captures = {}, states = {};
await capture("00-baseline");
session.play(); await delay(1100); session.pause(); await delay(150); await capture("01-play-start-slide-1");
const pausedState = states.play = await state(); await delay(500); const pausedAgain = states.pause = await state();
assert.equal(pausedState.midi_dispatched, pausedAgain.midi_dispatched, "MIDI advanced while paused");
await capture("02-pause-stable-slide-1");

const verse1 = region("Verse 1"), verse2 = region("Verse 2");
engine.seek(verse1.startSeconds); session.updatePosition(verse1.startSeconds); await delay(200); await capture("03-seek-verse-1-slide-2");
states.seek = await state(); assert.ok(states.seek.midi_dispatched > states.pause.midi_dispatched);
engine.seek(39.0); session.updatePosition(39.0); session.play(); await delay(450); session.pause(); await delay(100); await capture("04-play-from-playhead-slide-3");
states.playFromPlayhead = await state(); assert.ok(states.playFromPlayhead.midi_dispatched > states.seek.midi_dispatched);

session.stop(); session.jumpToRegion(verse2.id); await delay(200); await capture("05-region-jump-verse-2-slide-4");
states.jump = await state(); assert.ok(states.jump.midi_dispatched > states.playFromPlayhead.midi_dispatched);

session.play(); engine.seek(69.2); session.updatePosition(69.2); await delay(150); session.toggleLoop(verse2.id); session.updatePosition(verse2.endSeconds); await delay(200); session.pause(); await capture("06-loop-return-slide-4");
states.loop = await state(); assert.ok(states.loop.midi_dispatched > states.jump.midi_dispatched);
session.toggleLoop(verse2.id);

session.play(); engine.seek(69.2); session.updatePosition(69.2); await delay(150); session.repeatOnce(verse1.id); session.updatePosition(verse2.endSeconds); await delay(200); session.pause(); await capture("07-repeat-once-slide-2");
states.repeatOnce = await state(); assert.ok(states.repeatOnce.midi_dispatched > states.loop.midi_dispatched);

session.play(); engine.seek(69.2); session.updatePosition(69.2); await delay(150); session.panic(); session.armRecovery(verse1.id); session.updatePosition(verse2.endSeconds); await delay(200); session.pause(); await capture("08-panic-recovery-slide-2");
states.panicRecovery = await state(); assert.ok(states.panicRecovery.midi_dispatched > states.repeatOnce.midi_dispatched);
const beforeStop = await state(); session.stop(); await delay(200); const afterStop = await state(); await capture("09-stop-holds-slide");
assert.equal(afterStop.midi_cursor, 0);
assert.ok(afterStop.midi_flushes > beforeStop.midi_flushes);

await engine.closeAndWait();
const result = { ready: true, fixture: "Cornerstone 72 B", proPresenterPid: Number(pp), slidesTrack, midiEvents: native.midiEvents, midiOutput, readiness, transportAcceptance: { play: true, pause: true, seek: true, playFromPlayhead: true, regionJump: true, loop: true, repeatOnce: true, panicRecovery: true, stopFlushesAndHoldsSlide: true }, states, nativeBeforeStop: beforeStop, nativeAfterStop: afterStop, screenshotHashes: captures, nativeLines };
await writeFile(path.join(outputRoot, "verification.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

function region(name) { const found = song.regions.find((item) => item.name === name); assert.ok(found, `Missing ${name}`); return found; }
async function capture(name) { const file = path.join(outputRoot, `${name}.png`); execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", captureScript, "-ProcessId", pp, "-OutputPath", file], { stdio: "pipe" }); const hash = createHash("sha256").update(await readFile(file)).digest("hex"); captures[name] = hash; return file; }
async function state() { const start = nativeLines.length; engine.requestStatus(); const line = await waitFor(() => nativeLines.slice(start).find((item) => item.startsWith("STATE ")), 3000); return Object.fromEntries(line.split(/\s+/).slice(1).map((part) => { const at = part.indexOf("="); const value = part.slice(at + 1); return [part.slice(0, at), Number.isFinite(Number(value)) ? Number(value) : value]; })); }
function waitFor(read, timeout) { return new Promise((resolve, reject) => { const started = Date.now(), timer = setInterval(() => { const value = read(); if (value) { clearInterval(timer); resolve(value); } else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error(`Timed out. Native output:\n${nativeLines.join("\n")}`)); } }, 10); }); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
