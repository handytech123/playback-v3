import assert from "node:assert/strict";
import test from "node:test";
import { songId } from "../src/domain/song.js";
import { addSetlistSong,createSetlist,moveSetlistSong,removeSetlistSong } from "../src/setlist/setlist.js";
test("builds, orders, and removes stable setlist items",()=>{let set=createSetlist("sunday","Sunday");set=addSetlistSong(set,{id:"one",songId:songId("song-1"),arrangementId:"original"});set=addSetlistSong(set,{id:"two",songId:songId("song-2"),arrangementId:"original"});set=moveSetlistSong(set,1,0);assert.deepEqual(set.items.map((item)=>item.id),["two","one"]);set=removeSetlistSong(set,"one");assert.deepEqual(set.items.map((item)=>item.id),["two"]);});
