import assert from "node:assert/strict";
import test from "node:test";
import { defaultGlobalBusRouting,deriveAudioRouting,migrateGlobalBusRouting } from "../src/audio/global-bus-routing.js";

test("global bus routing is independent of the selected song",()=>{
  const global={...defaultGlobalBusRouting(),keys:{output:17,channels:1 as const},drums:{output:22,channels:1 as const}};
  assert.deepEqual(deriveAudioRouting(global,["Piano.wav","Drums.wav"]).stems,[17,22]);
  assert.deepEqual(deriveAudioRouting(global,["Bass.wav"]).stems,[6]);
  assert.equal(global.keys.output,17);
});

test("legacy per-song routing migrates matching buses once",()=>{
  const legacy={stems:[0,8,7,7],stemChannels:[1,1,1,1] as const,click:1,clickChannels:1 as const,cue:2,cueChannels:1 as const,pad:4,padChannels:1 as const,iem:3,iemChannels:1 as const};
  const migrated=migrateGlobalBusRouting(null,legacy,["Piano.wav","Bass.wav","Drums.wav","Perc.wav"]);
  assert.equal(migrated.keys.output,0);
  assert.equal(migrated.bass.output,8);
  assert.equal(migrated.drums.output,7);
});
