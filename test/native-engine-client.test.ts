import assert from "node:assert/strict";
import test from "node:test";
import { nativeRoutingCommand,parseNativeLine,parseNativeMeters } from "../src/live/native-engine-client.js";

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

test("serializes an atomic one-based native routing update",()=>{
  assert.equal(nativeRoutingCommand({stems:[4,10],stemChannels:[1,1],click:1,clickChannels:1,cue:2,cueChannels:1,pad:12,padChannels:1,iem:3,iemChannels:1}),"routing 2 4 1 10 1 1 1 2 1 12 1 3 1");
});
