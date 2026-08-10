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
  assert.deepEqual(buildDynamicClickEvents(60, { numerator: 6, denominator: 8 }, 6, "6-8-full").slice(0, 7), [
    { atSeconds: 0, accent: true },
    { atSeconds: 1, accent: false },
    { atSeconds: 2, accent: false },
    { atSeconds: 3, accent: true },
    { atSeconds: 4, accent: false },
    { atSeconds: 5, accent: false },
    { atSeconds: 6, accent: true },
  ]);
});

test("4/4 eighth template inserts subdivisions without moving the measure accent",()=>{
  const events=buildDynamicClickEvents(60,{numerator:4,denominator:4},4,"4-4-eighth");
  assert.deepEqual(events.slice(0,9),[
    {atSeconds:0,accent:true},{atSeconds:.5,accent:false},{atSeconds:1,accent:false},{atSeconds:1.5,accent:false},
    {atSeconds:2,accent:false},{atSeconds:2.5,accent:false},{atSeconds:3,accent:false},{atSeconds:3.5,accent:false},{atSeconds:4,accent:true},
  ]);
});

test("V3 feel templates own their trigger and accent patterns",()=>{
  assert.deepEqual(buildDynamicClickEvents(60,{numerator:4,denominator:4},4,"4-4-half-time").map(event=>[event.atSeconds,event.accent]),[[0,true],[1,false],[2,true],[3,false],[4,true]]);
  assert.deepEqual(buildDynamicClickEvents(60,{numerator:6,denominator:8},6,"6-8-two-feel").map(event=>[event.atSeconds,event.accent]),[[0,true],[3,true],[6,true]]);
  assert.deepEqual(buildDynamicClickEvents(60,{numerator:12,denominator:8},12,"12-8-four-feel").map(event=>[event.atSeconds,event.accent]),[[0,true],[3,true],[6,true],[9,true],[12,true]]);
});

test("a click template cannot be applied to the wrong meter",()=>{
  assert.throws(()=>buildDynamicClickEvents(60,{numerator:6,denominator:8},6,"4-4-quarter"),/does not match 6\/8/);
});

test("4/4 Driving uses eighth-note placement with a short two-sound envelope",()=>{
  const events=buildDynamicClickEvents(60,{numerator:4,denominator:4},1,"4-4-driving");
  assert.deepEqual(events.slice(0,3),[
    {atSeconds:0,accent:true,maxDurationSeconds:.06},
    {atSeconds:.5,accent:false,maxDurationSeconds:.06},
    {atSeconds:1,accent:false,maxDurationSeconds:.06},
  ]);
});
