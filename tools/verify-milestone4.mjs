import { readFile,writeFile,mkdir } from "node:fs/promises";
import path from "node:path";
import { importReaperProject } from "../dist/src/reaper/rpp-import.js";
import { saveArrangementVersion } from "../dist/src/reaper/arrangement-persistence.js";
import { prepareArrangementCache } from "../dist/src/reaper/arrangement-cache.js";

const projectPath="D:\\Dropbox\\Worship\\Backing Tracks\\Reaper\\Loop Community\\Cornerstone - Hillsong Worship\\Reaper\\Cornerstone 72 B\\Cornerstone 72 B.RPP";
const manifestPath=path.resolve(".playback-cache","milestone-1-cornerstone-performance-v3","confirmed-set.json"),manifest=JSON.parse(await readFile(manifestPath,"utf8")),original=manifest.songs[0];
const preview=await importReaperProject(projectPath,original.song.id,original);const metadataRoot=path.resolve(".playback-metadata"),savedPath=await saveArrangementVersion(metadataRoot,preview.arrangement),prepared=await prepareArrangementCache(preview.arrangement,path.resolve(".playback-cache","arrangements"));
if(preview.arrangement.selectedKey!=="B"||preview.arrangement.selectedBpm!==72||preview.arrangement.timeSignature.numerator!==4)throw new Error("Arrangement facts were not imported");
if(preview.arrangement.regions.length!==20||preview.arrangement.cueMarkers.length!==20)throw new Error("Reaper structure was not imported completely");
if(preview.arrangement.slidesTrackName!=="Slides"||preview.arrangement.proPresenterMidi.filter((x)=>x.kind==="note-on").length<20)throw new Error("Slides MIDI was not imported completely");
if(preview.defaultAction!=="import-as-new-version")throw new Error("Unsafe Reaper import default");if(prepared.arrangement.mediaItems.some((item)=>item.sourcePath&&!item.sourcePath.startsWith(path.dirname(prepared.manifestPath))))throw new Error("Prepared arrangement escaped its local cache");
await mkdir(path.resolve("artifacts"),{recursive:true});await writeFile(path.resolve("artifacts","milestone4-cornerstone-import-preview.json"),JSON.stringify(preview,null,2));
console.log(JSON.stringify({ready:true,arrangementId:preview.arrangement.id,name:preview.arrangement.name,key:preview.arrangement.selectedKey,bpm:preview.arrangement.selectedBpm,timeSignature:preview.arrangement.timeSignature,durationSeconds:preview.arrangement.durationSeconds,regions:preview.arrangement.regions.length,cueMarkers:preview.arrangement.cueMarkers.length,mediaItems:preview.arrangement.mediaItems.length,slidesTrack:preview.arrangement.slidesTrackName,slideNoteOns:preview.arrangement.proPresenterMidi.filter((x)=>x.kind==="note-on").length,differences:preview.differences.map((x)=>x.field),defaultAction:preview.defaultAction,savedPath,preparedManifestPath:prepared.manifestPath,copiedMediaFiles:prepared.copiedMediaFiles,copiedBytes:prepared.copiedBytes,reaperRuntimeDependency:false},null,2));
