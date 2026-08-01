import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { renderArrangementTracks } from "../dist/src/reaper/arrangement-renderer.js";

const arrangementPath=path.resolve(".playback-cache","arrangements","reaper-72091bdc9061","arrangement.json"),arrangement=JSON.parse(await readFile(arrangementPath,"utf8")),outputDirectory=path.resolve(".playback-cache","arrangements",arrangement.id,"rendered-stems"),stems=await renderArrangementTracks(arrangement,outputDirectory);
const result={arrangementId:arrangement.id,durationSeconds:arrangement.durationSeconds,stemCount:stems.length,renderedCount:stems.filter((stem)=>stem.rendered).length,reusedCount:stems.filter((stem)=>!stem.rendered).length,stems};await writeFile(path.resolve("artifacts","milestone4-rendered-stems.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
