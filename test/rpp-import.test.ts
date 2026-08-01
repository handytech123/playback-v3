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

test("imports regions, advance cues, and Slides MIDI into a new arrangement",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-import-")),path=join(root,"Cornerstone 72 B.RPP");await writeFile(path,fixture);const preview=await importReaperProject(path,songId("cornerstone"));assert.equal(preview.defaultAction,"import-as-new-version");assert.equal(preview.arrangement.selectedKey,"B");assert.equal(preview.arrangement.selectedBpm,72);assert.deepEqual(preview.arrangement.regions.map((x)=>x.name),["Intro","Verse"]);assert.equal(preview.arrangement.cueMarkers[1]?.targetRegionId,"reaper-region-0002");assert.equal(preview.arrangement.slidesTrackName,"Slides");assert.equal(preview.arrangement.proPresenterMidi[0]?.kind,"note-on");assert.equal(preview.arrangement.proPresenterMidi[0]?.channel,1);assert.equal(preview.arrangement.proPresenterMidi[0]?.data1,0x13);assert.ok(Math.abs(preview.arrangement.proPresenterMidi[0]!.atSeconds-60/72)<1e-9);const saved=await saveArrangementVersion(join(root,"metadata"),preview.arrangement);assert.equal(await saveArrangementVersion(join(root,"metadata"),preview.arrangement),saved);});

test("does not classify MIDI outside a Slides track as ProPresenter",async()=>{const root=await mkdtemp(join(tmpdir(),"rpp-no-slides-")),path=join(root,"Song 72 C.RPP");await writeFile(path,fixture.replace("NAME Slides","NAME Lighting"));const preview=await importReaperProject(path,songId("song"));assert.equal(preview.arrangement.proPresenterMidi.length,0);assert.match(preview.arrangement.warnings.join(" "),/No Slides track/);});
