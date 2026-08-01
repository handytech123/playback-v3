import assert from"node:assert/strict";import test from"node:test";import{keyDistance}from"../src/edit/app-arrangement-renderer.js";
test("computes shortest chromatic pitch changes with flat and sharp aliases",()=>{assert.equal(keyDistance("C","D"),2);assert.equal(keyDistance("B","Bb"),-1);assert.equal(keyDistance("Gb","C"),-6);assert.throws(()=>keyDistance("H","C"),/Unsupported/);});
