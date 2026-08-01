import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { productionDefaults } from "../dist/src/config/settings.js";
import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";
import { analyzeStemKeys } from "../dist/src/library/key-analyzer-client.js";
import { createKeyApproval,evaluateSongKey } from "../dist/src/library/key-diagnostics.js";

const root=path.resolve("."),python=process.env.PLAYBACK_PYTHON??"C:\\Users\\Luis\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",analyzer=path.resolve(root,"..","lyzer 2","src"),stemFolder=path.join(root,".playback-cache","milestone-1-cornerstone-performance-v3","songs","000");
const stemNames=["ACOUSTIC.wav","BASS.wav","DRUMS.wav","CLICK.wav","CUE.wav","Pad_C.wav","ELECTRIC_1.wav","ELECTRIC_2.wav","ELECTRIC_3.wav","PIANO.wav","STRINGS_1.wav","STRINGS_2.wav"],estimate=await analyzeStemKeys(python,analyzer,stemNames.map((name)=>path.join(stemFolder,name)));
assert.equal(estimate.key,"C major");assert.ok(estimate.confidence>=.45);for(const name of ["DRUMS.wav","CLICK.wav","CUE.wav","Pad_C.wav"])assert.equal(estimate.stems.find((stem)=>stem.path.endsWith(name))?.eligible,false,`${name} was not excluded`);
const catalog=await importMasterCatalog(productionDefaults.masterWorkbookPath),cornerstone=catalog.songs.find((song)=>song.title==="Cornerstone");assert.ok(cornerstone);const diagnostic=evaluateSongKey(cornerstone,estimate);assert.equal(diagnostic.status,"confirmed");assert.equal(diagnostic.effectiveKey,"C");
const great=catalog.songs.find((song)=>song.title==="Great Are You Lord");assert.ok(great);const greatFiles=(await readdir(great.folderPath)).filter((name)=>name.toLowerCase().endsWith(".wav")).map((name)=>path.join(great.folderPath,name)),greatEstimate=await analyzeStemKeys(python,analyzer,greatFiles),greatDiagnostic=evaluateSongKey(great,greatEstimate);assert.equal(greatEstimate.key,"A major");assert.equal(greatDiagnostic.status,"confirmed");assert.equal(greatDiagnostic.effectiveKey,"A");
const missing=catalog.songs.filter((song)=>!song.key);assert.equal(missing.length,132);const pending=evaluateSongKey(missing[0],estimate);assert.equal(pending.status,"estimated");const approval=createKeyApproval(pending,pending.effectiveKey,"verification");assert.equal(evaluateSongKey(missing[0],estimate,approval).status,"confirmed");
console.log(JSON.stringify({ready:true,catalogSongs:catalog.songs.length,masterKeysPresent:catalog.songs.length-missing.length,missingMasterKeys:missing.length,knownKeyValidation:[{song:"Cornerstone",expected:"C",detected:estimate.key,confidence:estimate.confidence},{song:"Great Are You Lord",expected:"A",detected:greatEstimate.key,confidence:greatEstimate.confidence}],excludedRoles:["drums","percussion","click","cue","pad"],estimateRequiresApproval:true,approvalPromotesToConfirmed:true},null,2));
