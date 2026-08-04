import assert from "node:assert/strict";
import test from "node:test";
import { buildDynamicClickEvents, buildZeroBasedGrid, secondsPerNotatedBeat } from "../src/domain/grid.js";

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

test("6/8 exposes all six eighth positions and preserves its two musical pulses", () => {
  assert.equal(secondsPerNotatedBeat(60, { numerator: 6, denominator: 8 }), 1);
  const grid = buildZeroBasedGrid(60, { numerator: 6, denominator: 8 }, 6);
  assert.deepEqual(grid.slice(0, 7).map(({ measure, beat, isPulse }) => ({ measure, beat, isPulse })), [
    { measure: 1, beat: 1, isPulse: true },
    { measure: 1, beat: 2, isPulse: false },
    { measure: 1, beat: 3, isPulse: false },
    { measure: 1, beat: 4, isPulse: true },
    { measure: 1, beat: 5, isPulse: false },
    { measure: 1, beat: 6, isPulse: false },
    { measure: 2, beat: 1, isPulse: true },
  ]);
  assert.deepEqual(buildDynamicClickEvents(60, { numerator: 6, denominator: 8 }, 6).slice(0, 7), [
    { atSeconds: 0, accent: true },
    { atSeconds: 1, accent: false },
    { atSeconds: 2, accent: false },
    { atSeconds: 3, accent: false },
    { atSeconds: 4, accent: false },
    { atSeconds: 5, accent: false },
    { atSeconds: 6, accent: true },
  ]);
});

test("double click rate inserts subdivisions without moving the measure accent",()=>{
  const events=buildDynamicClickEvents(60,{numerator:4,denominator:4},4,2);
  assert.deepEqual(events.slice(0,9),[
    {atSeconds:0,accent:true},{atSeconds:.5,accent:false},{atSeconds:1,accent:false},{atSeconds:1.5,accent:false},
    {atSeconds:2,accent:false},{atSeconds:2.5,accent:false},{atSeconds:3,accent:false},{atSeconds:3.5,accent:false},{atSeconds:4,accent:true},
  ]);
});
