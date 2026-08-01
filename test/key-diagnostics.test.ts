import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKeyReadinessReport,createKeyApproval,evaluateSongKey,type RawKeyEstimate } from "../src/library/key-diagnostics.js";
import { loadKeyApproval,saveKeyApproval } from "../src/library/key-approval-persistence.js";

const estimate=(key:string|null,confidence=.7):RawKeyEstimate=>({key,confidence,alternatives:key?[[key,.8]]:[],stems:[{path:"PIANO.wav",key:key??"",confidence,eligible:true,reason:null},{path:"DRUMS.wav",key:"",confidence:0,eligible:false,reason:"non-harmonic"}]});
const master=(key:string|null)=>({catalogId:"song:1",title:"Song",key});
test("master key remains authoritative when evidence agrees",()=>{const result=evaluateSongKey(master("C"),estimate("C major"));assert.equal(result.status,"confirmed");assert.equal(result.effectiveKey,"C");assert.equal(result.excludedStems.length,1);});
test("strong disagreement is a conflict and never a silent override",()=>{const result=evaluateSongKey(master("C"),estimate("G major"));assert.equal(result.status,"conflict");assert.equal(result.effectiveKey,"C");assert.equal(result.detectedKey,"G");});
test("missing master keys remain estimated until atomic operator approval",async()=>{const diagnostic=evaluateSongKey(master(null),estimate("A minor"));assert.equal(diagnostic.status,"estimated");assert.equal(diagnostic.effectiveKey,"Am");const approval=createKeyApproval(diagnostic,"Am","Luis",new Date(0).toISOString()),root=await mkdtemp(join(tmpdir(),"key-approval-"));const path=await saveKeyApproval(root,approval);assert.ok(path.endsWith("song_1.json"));assert.deepEqual(await loadKeyApproval(root,"song:1"),approval);assert.equal(evaluateSongKey(master(null),estimate("A minor"),approval).status,"confirmed");});
test("weak evidence stays unknown and library report separates every status",()=>{const unknown=evaluateSongKey(master(null),estimate("G major",.2)),confirmed=evaluateSongKey(master("C"),estimate("C major")),report=buildKeyReadinessReport([unknown,confirmed]);assert.equal(unknown.status,"unknown");assert.deepEqual({total:report.total,confirmed:report.confirmed,unknown:report.unknown,missingMaster:report.missingMaster},{total:2,confirmed:1,unknown:1,missingMaster:1});});
