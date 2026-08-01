import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeLine,parseNativeMeters } from "../src/live/native-engine-client.js";

test("parses native ready measurements", () => {
  assert.deepEqual(parseNativeLine("READY device_open_ms=143.2 arm_ms=125.7 stems=11"), { deviceOpenMs: 143.2, armMs: 125.7, stems: 11 });
});

test("parses audio-clock transport state", () => {
  assert.deepEqual(parseNativeLine("STATE state=playing position_seconds=30.125"), { state: "playing", positionSeconds: 30.125 });
});

test("parses native DAW meter packets and IEM readiness",()=>{
  assert.deepEqual(parseNativeMeters("METERS master=0.8 channels=0.1,0.2,0"),{master:.8,channels:[.1,.2,0]});
  assert.deepEqual(parseNativeLine("READY device_open_ms=10 arm_ms=20 stems=3 output_channels=8 routing_ready=1 iem_ready=1"),{deviceOpenMs:10,armMs:20,stems:3,outputChannels:8,routingReady:true,iemReady:true});
});
