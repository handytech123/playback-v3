import assert from "node:assert/strict";
import test from "node:test";
import { classifyStemOutput, DEFAULT_INSTRUMENT_OUTPUTS, PLAYBACK_OUTPUTS } from "../src/audio/output-layout.js";

test("defines the fixed 12-channel mono Playback output contract",()=>{
  assert.deepEqual(PLAYBACK_OUTPUTS.map(({output,danteLabel})=>[output,danteLabel]),[
    [1,"PB_CLICK"],[2,"PB_CUE"],[3,"PB_IEM"],[4,"PB_ACOUSTIC"],[5,"PB_ELECTRIC"],[6,"PB_BASS"],
    [7,"PB_KEYS"],[8,"PB_STRINGS"],[9,"PB_DRUMS"],[10,"PB_VOCALS"],[11,"PB_OTHER"],[12,"PB_PAD"],
  ]);
  assert.deepEqual(DEFAULT_INSTRUMENT_OUTPUTS,{acoustic:4,electric:5,bass:6,keys:7,strings:8,drums:9,vocals:10,other:11});
  assert.equal(PLAYBACK_OUTPUTS.every(output=>output.format==="mono"),true);
});

test("classifies common production stem labels into stable output buses",()=>{
  const cases:Record<string,string>={"DRUMS 2":"drums",SHAKER:"drums",LOOP:"drums",BASS:"bass","ACOUSTIC_1":"acoustic","ELECTRIC 3":"electric",PIANO:"keys",ORGAN:"keys",RHODES:"keys",KEYS:"keys",CELLO:"strings",ORCHESTRA:"strings",HORNS:"strings",TRUMPET:"strings",BGVS:"vocals",Pad_C:"pad",FX:"other","Tracks 1":"other"};
  for(const[label,bus]of Object.entries(cases))assert.equal(classifyStemOutput(label),bus,label);
});
