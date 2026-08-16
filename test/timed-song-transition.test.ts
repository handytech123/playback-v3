import assert from "node:assert/strict";
import test from "node:test";
import { runTimedSongTransition } from "../src/live/timed-song-transition.js";

test("production timed-transition fallback waits to the boundary and starts the next song", async () => {
  const calls: string[] = [];
  const ready = { ready: true, status: "Ready" as const, checks: [] };
  const result = await runTimedSongTransition(
    { fromSongIndex: 0, toSongIndex: 1, type: "crossfade", durationSeconds: 5, continuePad: true },
    {
      wait: async milliseconds => { calls.push(`wait:${milliseconds}`); },
      stop: () => calls.push("stop"),
      selectSong: async index => { calls.push(`select:${index}`); return ready; },
      setPad: enabled => calls.push(`pad:${enabled}`),
      play: () => calls.push("play"),
    },
  );
  assert.equal(result, ready);
  assert.deepEqual(calls, ["wait:5000", "stop", "select:1", "pad:true", "play"]);
});

test("timed-transition fallback does not play a next song that fails readiness", async () => {
  const calls: string[] = [];
  const blocked = { ready: false, status: "Blocked" as const, checks: [{ id: "assets", label: "Assets", level: "blocked" as const, detail: "missing stem" }] };
  const result = await runTimedSongTransition(
    { fromSongIndex: 0, toSongIndex: 1, type: "overlap", durationSeconds: 2, continuePad: false },
    {
      wait: async () => {},
      stop: () => calls.push("stop"),
      selectSong: async () => blocked,
      setPad: () => calls.push("pad"),
      play: () => calls.push("play"),
    },
  );
  assert.equal(result, blocked);
  assert.deepEqual(calls, ["stop"]);
});
