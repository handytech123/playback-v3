import test from "node:test";
import assert from "node:assert/strict";
import { PlaybackCommandBus, parsePlaybackCommand } from "../src/control/command-bus.js";
import { encodeOscMessage, decodeOscMessage, oscToPlaybackCommand } from "../src/control/osc.js";
import { PerformanceSession, type PerformanceEffects } from "../src/live/performance-session.js";
import type { ConfirmedSetManifest } from "../src/confirmed-set/manifest.js";
import { songId } from "../src/domain/song.js";

function setup() {
  const calls: string[] = [], effects: PerformanceEffects = { play: () => calls.push("play"), pause: () => calls.push("pause"), stop: () => calls.push("stop"), seek: value => calls.push(`seek:${value}`), panic: () => calls.push("panic"), announceRecovery: () => {}, cancelTransition: () => {}, recover: () => {}, setBus: (bus, enabled) => calls.push(`${bus}:${enabled}`), setBusGain: (bus, gain) => calls.push(`${bus}:${gain}`), selectSong: async index => { calls.push(`song:${index}`); } };
  const song = (name: string) => ({ song: { id: songId(name), title: name, artist: "Artist", vendor: "Vendor", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } }, selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 8, stems: [{ role: "music" as const, sourcePath: "cache/audio.wav", durationSeconds: 8 }], regions: [{ id: `${name}-verse`, name: "Verse", startSeconds: 0, endSeconds: 4 }, { id: `${name}-chorus`, name: "Chorus", startSeconds: 4, endSeconds: 8 }], cues: [], cacheFingerprint: name, liveAssets: { click: { regularPath: "click", accentPath: "accent", events: [{ atSeconds: 0, accent: true }] }, repeatCuePath: "repeat", cues: [{ atSeconds: 3, label: "Chorus", audioPath: "cue", targetRegionId: `${name}-chorus` }], pad: { key: "C", audioPath: "pad" } } });
  const manifest: ConfirmedSetManifest = { schemaVersion: 1, id: "set", name: "Sunday", confirmedAt: "now", songs: [song("One"), song("Two")] };
  const bus = new PlaybackCommandBus(new PerformanceSession(manifest, effects), manifest.name);
  return { bus, calls };
}

test("normalized command bus serializes commands and publishes authoritative state", async () => { const { bus, calls } = setup(), revisions: number[] = []; bus.onState(state => revisions.push(state.revision)); const [play, gain, stop] = await Promise.all([bus.dispatch({ type: "transport.play" }, "remote"), bus.dispatch({ type: "bus.gain", bus: "music", gain: .8 }, "osc"), bus.dispatch({ type: "transport.stop" }, "ui")]); assert.equal(play.ok, true); assert.equal(gain.ok, true); assert.equal(stop.state.playing, false); assert.deepEqual(calls, ["play", "music:0.8", "stop"]); assert.deepEqual(revisions, [1, 2, 3]); assert.equal(bus.state().songs.length, 2); });
test("invalid remote commands are rejected before reaching playback", () => { assert.throws(() => parsePlaybackCommand({ type: "song.select", index: -1 }), /non-negative/); assert.throws(() => parsePlaybackCommand({ type: "bus.gain", bus: "music", gain: 2 }), /between/); assert.throws(() => parsePlaybackCommand({ type: "section.jump" }), /regionId/); });
test("OSC codec maps atomic remote gestures into the same normalized commands", () => { const packet = encodeOscMessage({ address: "/playback/jump", args: ["One-chorus"] }), decoded = decodeOscMessage(packet); assert.deepEqual(decoded, { address: "/playback/jump", args: ["One-chorus"] }); assert.deepEqual(oscToPlaybackCommand(decoded), { type: "section.jump", regionId: "One-chorus" }); assert.deepEqual(oscToPlaybackCommand(decodeOscMessage(encodeOscMessage({ address: "/playback/gain/pad", args: [.75] }))), { type: "bus.gain", bus: "pad", gain: assertClose(.75) }); });

function assertClose(value: number): number { assert.ok(Math.abs(value - .75) < .0001); return value; }
