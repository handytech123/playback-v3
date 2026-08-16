import assert from "node:assert/strict";
import test from "node:test";
import { defaultGlobalBusRouting,deriveAudioRouting,migrateGlobalBusRouting } from "../src/audio/global-bus-routing.js";

test("global bus routing is independent of the selected song",()=>{
  const global={...defaultGlobalBusRouting(),keys:{output:17,channels:1 as const},drums:{output:22,channels:1 as const}};
  assert.deepEqual(deriveAudioRouting(global,["Piano.wav","Drums.wav"]).stems,[17,22]);
  assert.deepEqual(deriveAudioRouting(global,["Bass.wav"]).stems,[6]);
  assert.equal(global.keys.output,17);
});

test("songs choose buses while the global matrix chooses physical outputs",()=>{
  const matrix={...defaultGlobalBusRouting(),acoustic:{output:7,channels:1 as const},keys:{output:9,channels:1 as const}};
  const routing=deriveAudioRouting(matrix,["Acoustic.wav","Piano.wav"]);
  assert.deepEqual(routing.stems,[7,9]);
});

test("legacy per-song routing cannot scramble the canonical global bus table",()=>{
  const legacy={stems:[0,8,7,7],stemChannels:[1,1,1,1] as const,click:1,clickChannels:1 as const,cue:2,cueChannels:1 as const,pad:4,padChannels:1 as const,iem:3,iemChannels:1 as const};
  const migrated=migrateGlobalBusRouting(null,legacy,["Piano.wav","Bass.wav","Drums.wav","Perc.wav"]);
  assert.deepEqual(migrated,defaultGlobalBusRouting());
});
