import assert from "node:assert/strict";
import test from "node:test";
import { buildZeroBasedGrid, secondsPerNotatedBeat } from "../src/domain/grid.js";

test("4/4 grid begins at 1.1 = 0 and advances quarter notes", () => {
  const grid = buildZeroBasedGrid(120, { numerator: 4, denominator: 4 }, 2);
  assert.deepEqual(grid.slice(0, 5).map(({ measure, beat, timeSeconds }) => ({ measure, beat, timeSeconds })), [
    { measure: 1, beat: 1, timeSeconds: 0 },
    { measure: 1, beat: 2, timeSeconds: 0.5 },
    { measure: 1, beat: 3, timeSeconds: 1 },
    { measure: 1, beat: 4, timeSeconds: 1.5 },
    { measure: 2, beat: 1, timeSeconds: 2 },
  ]);
});

test("6/8 dotted-quarter BPM exposes all six eighth positions and two pulses", () => {
  assert.equal(secondsPerNotatedBeat(60, { numerator: 6, denominator: 8 }), 1 / 3);
  const grid = buildZeroBasedGrid(60, { numerator: 6, denominator: 8 }, 2);
  assert.deepEqual(grid.slice(0, 7).map(({ measure, beat, isPulse }) => ({ measure, beat, isPulse })), [
    { measure: 1, beat: 1, isPulse: true },
    { measure: 1, beat: 2, isPulse: false },
    { measure: 1, beat: 3, isPulse: false },
    { measure: 1, beat: 4, isPulse: true },
    { measure: 1, beat: 5, isPulse: false },
    { measure: 1, beat: 6, isPulse: false },
    { measure: 2, beat: 1, isPulse: true },
  ]);
});

