import assert from "node:assert/strict";
import test from "node:test";
import { parseKeyAnalyzerOutput } from "../src/library/key-analyzer-client.js";

test("parses complete analyzer evidence and rejects invalid confidence",()=>{const result=parseKeyAnalyzerOutput(JSON.stringify({key:"C major",confidence:.7,alternatives:[["C major",.8]],stems:[]}));assert.equal(result.key,"C major");assert.throws(()=>parseKeyAnalyzerOutput(JSON.stringify({key:"C",confidence:2,alternatives:[],stems:[]})),/confidence/);});
