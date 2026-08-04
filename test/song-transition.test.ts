import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSongTransitionSettings, transitionDuration, validateSongTransition } from "../src/live/song-transition.js";

test("uses distinct MultiTracks-compatible transition durations",()=>{
  assert.equal(transitionDuration("crossfade",12,8),5);
  assert.equal(transitionDuration("overlap",3,8),3);
  assert.equal(transitionDuration("overlap",12,4),4);
  assert.equal(transitionDuration("auto-link",12,8),0);
  assert.equal(transitionDuration("cue-next",12,8),0);
  assert.equal(transitionDuration("stay-in-song",12,8),0);
});

test("applies saved transition timing presets and clamps unsafe values",()=>{
  const settings=normalizeSongTransitionSettings({overlapSeconds:2.5,crossfadeSeconds:3.5});
  assert.equal(transitionDuration("overlap",8,6,settings),2.5);
  assert.equal(transitionDuration("crossfade",8,6,settings),3.5);
  assert.deepEqual(normalizeSongTransitionSettings({overlapSeconds:20,crossfadeSeconds:0}),{overlapSeconds:5,crossfadeSeconds:.5});
});

test("validates adjacent confirmed-set transition plans",()=>{
  assert.doesNotThrow(()=>validateSongTransition({fromSongIndex:0,toSongIndex:1,type:"crossfade",durationSeconds:5,continuePad:true},2));
  assert.throws(()=>validateSongTransition({fromSongIndex:0,toSongIndex:2,type:"cue-next",durationSeconds:0,continuePad:true},3),/adjacent/);
  assert.throws(()=>validateSongTransition({fromSongIndex:0,toSongIndex:1,type:"auto-link",durationSeconds:1,continuePad:true},2),/cannot have/);
});
