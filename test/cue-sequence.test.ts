import assert from "node:assert/strict";
import test from "node:test";
import { countedCueDelays } from "../src/prep/cue-sequence.js";

test("every 4/4 cue carries spoken beats 2 3 4", () => {
  assert.deepEqual(countedCueDelays(60, { numerator: 4, denominator: 4 }), [
    { label: "2", delaySeconds: 1 }, { label: "3", delaySeconds: 2 }, { label: "4", delaySeconds: 3 },
  ]);
});

test("every 6/8 cue carries spoken eighth-note beats 2 through 6", () => {
  const events = countedCueDelays(120, { numerator: 6, denominator: 8 });
  assert.deepEqual(events.map((event) => event.label), ["2", "3", "4", "5", "6"]);
  events.forEach((event, index) => assert.ok(Math.abs(event.delaySeconds - (index + 1) / 2) < 1e-9));
});

test("Analyzer count patterns select the exact spoken number sequence",()=>{
  assert.deepEqual(countedCueDelays(60,{numerator:6,denominator:8},"456"),[
    {label:"4",delaySeconds:3},{label:"5",delaySeconds:4},{label:"6",delaySeconds:5},
  ]);
  assert.deepEqual(countedCueDelays(60,{numerator:6,denominator:8},"23456").map(event=>event.label),["2","3","4","5","6"]);
});
