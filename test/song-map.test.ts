import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRegions } from "../src/edit/song-map.js";

test("numbers every occurrence when a canonical section repeats",()=>{
  const regions=[
    {id:"1",name:"Verse",startSeconds:0,endSeconds:10},{id:"2",name:"Chorus",startSeconds:10,endSeconds:20},
    {id:"3",name:"Verse 2",startSeconds:20,endSeconds:30},{id:"4",name:"Chorus 2 - Full",startSeconds:30,endSeconds:40},
    {id:"5",name:"Outro",startSeconds:40,endSeconds:50},
  ];
  const normalized=normalizeRegions(regions);
  assert.deepEqual(normalized.map((region)=>region.name),["Verse 1","Chorus 1","Verse 2","Chorus 2 - Full","Outro"]);
  assert.equal(normalized[0]!.sourceLabel,"Verse"); assert.equal(normalized[3]!.modifier,"Full");
});

test("normalizes Reaper-friendly spelling aliases",()=>{
  const regions=[{id:"1",name:"PreChorus",startSeconds:0,endSeconds:1},{id:"2",name:"Turn Around",startSeconds:1,endSeconds:2},{id:"3",name:"Down Chorus",startSeconds:2,endSeconds:3}];
  assert.deepEqual(normalizeRegions(regions).map((region)=>region.sectionType),["pre-chorus","turnaround","down-chorus"]);
});
