import assert from "node:assert/strict";
import test from "node:test";
import { classifyStemOutput, DEFAULT_INSTRUMENT_OUTPUTS, PLAYBACK_OUTPUTS } from "../src/audio/output-layout.js";

test("defines the fixed 16-channel Playback output contract",()=>{
  assert.deepEqual(PLAYBACK_OUTPUTS.map(({output,danteLabel})=>[output,danteLabel]),[
    [1,"PB_CLICK"],[2,"PB_CUE"],[3,"PB_IEM_L"],[4,"PB_IEM_R"],[5,"PB_DRUMS"],[6,"PB_PERC"],[7,"PB_BASS"],[8,"PB_ACOUSTIC"],
    [9,"PB_ELECTRIC"],[10,"PB_PIANO"],[11,"PB_ORGAN"],[12,"PB_SYNTHS"],[13,"PB_ORCHESTRA"],[14,"PB_VOCALS"],[15,"PB_AUX"],[16,"PB_PAD"],
  ]);
  assert.deepEqual(DEFAULT_INSTRUMENT_OUTPUTS,{drums:5,percussion:6,bass:7,acoustic:8,electric:9,piano:10,organ:11,synths:12,orchestra:13,vocals:14,auxiliary:15});
  assert.equal(PLAYBACK_OUTPUTS.every(output=>output.format==="mono"),true);
});

test("classifies common production stem labels into stable output buses",()=>{
  const cases:Record<string,string>={"DRUMS 2":"drums",SHAKER:"percussion",BASS:"bass","ACOUSTIC_1":"acoustic","ELECTRIC 3":"electric",PIANO:"piano",ORGAN:"organ",KEYS:"synths",CELLO:"orchestra",BGVS:"vocals",Pad_C:"pad","Tracks 1":"auxiliary"};
  for(const[label,bus]of Object.entries(cases))assert.equal(classifyStemOutput(label),bus,label);
});
