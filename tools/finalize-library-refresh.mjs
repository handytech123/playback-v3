import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { productionDefaults } from "../dist/src/config/settings.js";
import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";

const root = path.resolve(".");
const stagingRoot = path.join(root, ".playback-metadata", "analyzer-refresh-v3");
const keyReportPath = path.join(root, "artifacts", "library-key-analysis.json");
const outputPath = path.join(root, "artifacts", "analyzer-refresh-v3-comparison.json");
const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
const keyReport = await json(keyReportPath, { results: [] });
const keys = new Map((keyReport.results ?? []).map(item => [item.song?.catalogId, item]));
const pitchClasses = { C:0,"B#":0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,Fb:4,"E#":5,F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,A:9,"A#":10,Bb:10,B:11,Cb:11 };
const entries = [];

for (const song of catalog.songs) {
  const directory = path.join(stagingRoot, safeId(song.catalogId));
  const report = await json(path.join(directory, "raw-report.json"), null);
  const oldMetadata = await json(path.join(song.folderPath, "song-metadata.json"), null);
  const oldRegions = await json(path.join(song.folderPath, "analysis", "regions.json"), null);
  const keyEvidence = keys.get(song.catalogId) ?? null;
  if (!report?.ok || report.analysisStatus !== "complete") {
    entries.push({ catalogId:song.catalogId, title:song.title, status:"unavailable", reason:report?"Analyzer report is incomplete":"Fresh analyzer report is missing" });
    continue;
  }
  const files = (report.audioFiles ?? []).filter(file => !String(file.sourcePath ?? "").split(/[\\/]/).some(segment => segment.toLowerCase() === "reaper"));
  const cueCandidates = new Map((report.phase3CueAnalysis?.cueCandidates ?? []).map(item => [item.id, item]));
  const regions = (report.phase3CueAnalysis?.regionCandidates ?? [])
    .map(item => {
      const recognition = cueCandidates.get(item.sourceCueCandidateId)?.recognition ?? {};
      return {
        ...item,
        command:item.command ?? recognition.command ?? null,
        sectionType:item.sectionType ?? recognition.sectionType ?? null,
        sectionNumber:item.sectionNumber ?? recognition.sectionNumber ?? null,
        displayLabel:item.displayLabel ?? recognition.displayLabel ?? null,
      };
    })
    .filter(item => item.status !== "do-not-derive" && item.predictedRegionStart?.timeSeconds !== null && item.predictedRegionStart?.timeSeconds !== undefined)
    .map((item,index) => ({
      id:`candidate-${String(index+1).padStart(4,"0")}`,
      name:String(item.displayLabel ?? item.sourceCueText ?? "Section"),
      sectionType:item.sectionType ?? null,
      sectionNumber:item.sectionNumber ?? null,
      startSeconds:Number(item.predictedRegionStart.timeSeconds),
      cueAtSeconds:Number(item.cueMarker?.timeSeconds ?? item.predictedRegionStart.timeSeconds),
      measure:item.predictedRegionStart.measure ?? null,
      beat:item.predictedRegionStart.beatInMeasure ?? null,
      analyzerStatus:item.status ?? "review",
      approvalStatus:"review",
    }));
  const freshDuration = Math.max(0, ...files.map(file => Number(file.durationMs ?? 0) / 1000));
  const oldKey = String(oldMetadata?.musical?.key ?? oldMetadata?.key ?? "").trim() || null;
  const estimatedKey = keyEvidence?.estimate?.key ?? null;
  const keyAgreement = oldKey && estimatedKey ? samePitch(oldKey, estimatedKey) : null;
  const oldRegionCount = Array.isArray(oldRegions?.regions) ? oldRegions.regions.length : Array.isArray(oldRegions) ? oldRegions.length : 0;
  const candidate = {
    schema:"playback-v3-analyzer-candidate", schemaVersion:2, catalogId:song.catalogId, generatedAt:new Date().toISOString(), approvalStatus:"review",
    originalFacts:{ title:song.title, artist:song.artist, vendor:song.vendor, bpm:song.bpm, key:song.key, timeSignature:song.timeSignature, authority:"master-spreadsheet" },
    audioEvidence:{ durationSeconds:freshDuration, files },
    gridEvidence:{ spreadsheetBpm:song.bpm, spreadsheetTimeSignature:song.timeSignature, analyzerStatus:report.phase2Grid?.status??null, detectedBpm:report.phase2Grid?.tempoMap?.[0]?.bpm??report.providers?.essentia?.tempo?.normalizedBpm??report.providers?.librosa?.tempo?.normalizedBpm??null, detectedTimeSignature:report.phase2Grid?.timeSignature?.display??report.timeSignature?.signature??null },
    keyEvidence:{ masterKey:song.key, existingAnalyzerKey:oldKey, estimate:estimatedKey, confidence:keyEvidence?.estimate?.confidence??0, confidenceBand:keyEvidence?.confidenceBand??"unavailable", agreesWithExisting:keyAgreement, requiresApproval:!song.key },
    regionDraft:regions,
    comparison:{ oldMetadataPresent:Boolean(oldMetadata), oldRegionCount, freshRegionCandidateCount:regions.length, durationDeltaSeconds:oldMetadata?.durationSeconds?freshDuration-Number(oldMetadata.durationSeconds):null, stemCountDelta:Array.isArray(oldMetadata?.wavFiles)?files.length-oldMetadata.wavFiles.length:null },
  };
  await mkdir(directory, { recursive:true });
  await writeFile(path.join(directory, "candidate-metadata.json"), JSON.stringify(candidate,null,2));
  entries.push({ catalogId:song.catalogId, title:song.title, status:"candidate", keyStatus:song.key?"master":!estimatedKey?"missing":keyAgreement===false?"conflict":keyAgreement===true?"supported":"new-estimate", regionStatus:regions.length?"review":"missing", ...candidate.comparison });
}

const counts = {
  analyzed:entries.filter(item=>item.status==="candidate").length,
  unavailable:entries.filter(item=>item.status!=="candidate").length,
  keySupported:entries.filter(item=>item.keyStatus==="supported").length,
  keyConflicts:entries.filter(item=>item.keyStatus==="conflict").length,
  newKeyEstimates:entries.filter(item=>item.keyStatus==="new-estimate").length,
  missingKeys:entries.filter(item=>item.keyStatus==="missing").length,
  regionDrafts:entries.filter(item=>item.regionStatus==="review").length,
  missingRegionDrafts:entries.filter(item=>item.status==="candidate"&&item.regionStatus==="missing").length,
};
const comparison = { schemaVersion:2, generatedAt:new Date().toISOString(), policy:{ masterSpreadsheetAuthoritative:true, oldMetadataChanged:false, candidatesRequireApproval:true, rejectedCueCandidatesExcluded:true, canonicalCueLabels:true }, counts, entries };
await mkdir(path.dirname(outputPath), { recursive:true });
await writeFile(outputPath, JSON.stringify(comparison,null,2));
console.log(JSON.stringify({ outputPath, counts },null,2));

function safeId(value) { return value.replace(/[^a-z0-9._-]+/gi,"_"); }
async function json(file,fallback) { try { return JSON.parse(await readFile(file,"utf8")); } catch { return fallback; } }
function samePitch(left,right) { const a=String(left).match(/^[A-G](?:#|b)?/)?.[0],b=String(right).match(/^[A-G](?:#|b)?/)?.[0];return a&&b?pitchClasses[a]===pitchClasses[b]:false; }
