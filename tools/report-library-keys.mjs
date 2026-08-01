import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { productionDefaults } from "../dist/src/config/settings.js";
import { importMasterCatalog } from "../dist/src/library/master-spreadsheet.js";
import { buildKeyReadinessReport,evaluateSongKey } from "../dist/src/library/key-diagnostics.js";

const catalog=await importMasterCatalog(productionDefaults.masterWorkbookPath),empty={key:null,confidence:0,alternatives:[],stems:[]};
const diagnostics=catalog.songs.map((song)=>evaluateSongKey(song,empty));
const report={generatedAt:new Date().toISOString(),workbook:productionDefaults.masterWorkbookPath,...buildKeyReadinessReport(diagnostics),songs:diagnostics.map((diagnostic,index)=>({...diagnostic,folderPath:catalog.songs[index].folderPath}))};
const output=path.resolve("artifacts","key-readiness-report.json");await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,total:report.total,withMasterKey:report.confirmed,missingMasterKey:report.missingMaster,requiresAnalysis:report.unknown},null,2));
