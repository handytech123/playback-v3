import assert from "node:assert/strict";
import test from "node:test";
import { renderArrangementTracks } from "../src/reaper/arrangement-renderer.js";
import { songId } from "../src/domain/song.js";
import type { ArrangementVersion } from "../src/reaper/arrangement.js";

const base:ArrangementVersion={schemaVersion:1,id:"a",songId:songId("s"),name:"A",sourceType:"reaper-import",sourcePath:"x.rpp",sourceSha256:"h",importedAt:"now",selectedKey:"B",selectedBpm:72,timeSignature:{numerator:4,denominator:4},durationSeconds:10,regions:[],cueMarkers:[],markers:[],proPresenterMidi:[],slidesTrackName:"Slides",warnings:[],mediaItems:[{trackName:"Guitar",positionSeconds:0,lengthSeconds:10,sourcePath:"guitar.wav",sourceOffsetSeconds:0,playRate:1},{trackName:"Click",positionSeconds:0,lengthSeconds:10,sourcePath:"click.wav",sourceOffsetSeconds:0,playRate:1},{trackName:"Pad 1",positionSeconds:0,lengthSeconds:10,sourcePath:"pad.wav",sourceOffsetSeconds:0,playRate:1}]};
test("reuses full arranged stems and excludes Reaper click and pad tracks",async()=>{const stems=await renderArrangementTracks(base,"unused");assert.deepEqual(stems,[{role:"Guitar",sourcePath:"guitar.wav",durationSeconds:10,rendered:false}]);});
