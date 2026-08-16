import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { songId } from "../src/domain/song.js";
import { importReaperProject } from "../src/reaper/rpp-import.js";
import { saveArrangementVersion } from "../src/reaper/arrangement-persistence.js";

const fixture=`<REAPER_PROJECT 0.1 "7.0/x64" 1
  TEMPO 72 4 4 0
  MARKER 1 0 Intro 0 0 1
  MARKER 1 3.333333333 Intro 1 0 1 R {A} 0
  MARKER 1 10 "" 1
  MARKER 2 6.666666667 Verse1 0 0 1
  MARKER 2 10 Verse1 1 0 1 R {B} 0
  MARKER 2 20 "" 1
  <TRACK {T}
    NAME Slides
    <ITEM
      POSITION 0
      LENGTH 20
      PLAYRATE 1 1 0 -1 0 0.0025
      <SOURCE MIDI
        HASDATA 1 960 QN
        E 960 90 13 08
        E 320 80 13 00
      >
    >
  >
>`;

test("imports regions, advance cues, and Slides MIDI into a new arrangement",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-import-")),path=join(root,"Cornerstone 72 B.RPP");await writeFile(path,fixture);const preview=await importReaperProject(path,songId("cornerstone"));assert.equal(preview.defaultAction,"import-as-new-version");assert.equal(preview.arrangement.selectedKey,"B");assert.equal(preview.arrangement.selectedBpm,72);assert.deepEqual(preview.arrangement.regions.map((x)=>x.name),["Intro","Verse1"]);assert.equal(preview.arrangement.cueMarkers[1]?.targetRegionId,"reaper-region-0002");assert.equal(preview.arrangement.slidesTrackName,"Slides");assert.equal(preview.arrangement.proPresenterMidi[0]?.kind,"note-on");assert.equal(preview.arrangement.proPresenterMidi[0]?.channel,1);assert.equal(preview.arrangement.proPresenterMidi[0]?.data1,0x13);assert.ok(Math.abs(preview.arrangement.proPresenterMidi[0]!.atSeconds-60/72)<1e-9);const saved=await saveArrangementVersion(join(root,"metadata"),preview.arrangement);assert.equal(await saveArrangementVersion(join(root,"metadata"),preview.arrangement),saved);});

test("does not classify MIDI outside a Slides track as ProPresenter",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-no-slides-")),path=join(root,"Song 72 C.RPP");await writeFile(path,fixture.replace("NAME Slides","NAME Lighting"));const preview=await importReaperProject(path,songId("song"));assert.equal(preview.arrangement.proPresenterMidi.length,0);assert.match(preview.arrangement.warnings.join(" "),/No Slides track/);});

test("reads underscore-delimited keys and ignores REAPER FILE flags",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-file-flags-")),path=join(root,"ITISWELL_65_G.rpp"),withAudio=fixture.replace("  <TRACK {T}",`  <TRACK {AUDIO}
    NAME Music
    <ITEM
      POSITION 0
      LENGTH 20
      <SOURCE WAVE
        FILE "song mix.wav" 1
      >
    >
  >
  <TRACK {T}`);await writeFile(path,withAudio);const preview=await importReaperProject(path,songId("song"));assert.equal(preview.arrangement.selectedKey,"G");assert.equal(preview.arrangement.mediaItems[0]?.sourcePath,join(root,"song mix.wav"));});

test("imports region flag variants and infers ending regions from orphan advance cues",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-ending-cues-")),path=join(root,"Song_C_72.rpp"),ending=`<REAPER_PROJECT 0.1 "7.0/x64" 1
 TEMPO 72 4 4 0
 MARKER 1 0 Intro 0
 MARKER 1 3.333333 Intro 1
 MARKER 1 10 "" 1
 MARKER 2 6.666667 Verse 0
 MARKER 2 10 Verse 9
 MARKER 2 20 "" 9
 MARKER 3 16.666667 Tag 0
 MARKER 4 26.666667 End 0
 <TRACK {AUDIO}
  NAME Music
  <ITEM
   POSITION 0
   LENGTH 40
   <SOURCE WAVE
    FILE "music.wav"
   >
  >
 >
>`;await writeFile(path,ending);const preview=await importReaperProject(path,songId("song"));assert.deepEqual(preview.arrangement.regions.map(region=>region.name),["Intro","Verse","Tag","End"]);assert.ok(Math.abs(preview.arrangement.regions.at(-1)!.endSeconds-40)<.001);assert.deepEqual(preview.arrangement.cueMarkers.map(cue=>cue.phrase),["Intro","Verse","Tag","End"]);});

test("preserves Reaper region labels instead of normalizing unfamiliar sections to Other",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-preserve-labels-")),path=join(root,"Blessed Assurance Abridged - G - 68.5.rpp"),content=`<REAPER_PROJECT 0.1 "7.0/x64" 1
 TEMPO 68.5 6 8 0
 MARKER 1 0 "Count Off" 1
 MARKER 1 5.255474452554745 "" 1
 MARKER 2 5.255474452554745 Intro 1
 MARKER 2 26.277372262773724 "" 1
 MARKER 3 26.277372262773724 Refrain 1
 MARKER 3 42.043795620437955 "" 1
 MARKER 1 0 "Count Off" 0
 MARKER 2 5.255474452554745 Intro 0
 MARKER 3 26.277372262773724 Refrain 0
>`;await writeFile(path,content);const preview=await importReaperProject(path,songId("blessed-assurance"));assert.deepEqual(preview.arrangement.regions.map(region=>region.name),["Count Off","Intro","Refrain"]);assert.deepEqual(preview.arrangement.cueMarkers.map(cue=>cue.phrase),["Count Off","Intro","Refrain"]);assert.deepEqual(preview.arrangement.regions[0]?.startPosition,{measure:1,beat:1,tick:0});assert.deepEqual(preview.arrangement.regions[1]?.startPosition,{measure:3,beat:1,tick:0});});

test("recognizes a numbered ProPresenter MIDI item on an unnamed Reaper track",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-numbered-midi-")),path=join(root,"Abridged.rpp"),content=`<REAPER_PROJECT 0.1 "7.0/x64" 1
 TEMPO 120 4 4 0
 MARKER 1 0 Intro 1
 MARKER 1 4 "" 1
 <TRACK {MIDI}
  NAME ""
  <ITEM
   POSITION 0
   LENGTH 4
   NAME 15-MIDI
   <SOURCE MIDI
    HASDATA 1 960 QN
    E 0 90 11 01
    E 120 90 12 02
    E 120 90 13 03
   >
  >
 >
>`;await writeFile(path,content);const preview=await importReaperProject(path,songId("abridged"));assert.equal(preview.arrangement.slidesTrackName,"15-MIDI");assert.deepEqual(preview.arrangement.proPresenterMidi.map(event=>event.data1),[17,18,19]);assert.doesNotMatch(preview.arrangement.warnings.join(" "),/No Slides track/);});
