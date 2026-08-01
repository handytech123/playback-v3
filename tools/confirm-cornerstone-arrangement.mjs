import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { confirmArrangement } from "../dist/src/reaper/arrangement-confirm.js";

const arrangement=JSON.parse(await readFile(path.resolve(".playback-cache/arrangements/reaper-72091bdc9061/arrangement.json"),"utf8"));
const rendered=JSON.parse(await readFile(path.resolve("artifacts/milestone4-rendered-stems.json"),"utf8"));
const original=JSON.parse(await readFile(path.resolve(".playback-cache/milestone-1-cornerstone-performance-v3/confirmed-set.json"),"utf8")).songs[0].song;
const result=await confirmArrangement({arrangement,stems:rendered.stems,originalSong:original,outputDirectory:path.resolve(".playback-cache/arrangements/reaper-72091bdc9061/performance"),cueDirectory:"D:\\Dropbox\\Worship\\Cues",clickRegularPath:"D:\\Dropbox\\Worship\\Click\\CLICK.wav",clickAccentPath:"D:\\Dropbox\\Worship\\Click\\CLICK ACCENT.wav",padPath:"D:\\Dropbox\\Worship\\Pads\\Pad_B.wav"});
const summary={ready:true,manifestPath:result.manifestPath,arrangementId:arrangement.id,key:result.manifest.songs[0].selectedKey,bpm:result.manifest.songs[0].selectedBpm,stems:result.manifest.songs[0].stems.length,regions:result.manifest.songs[0].regions.length,cues:result.manifest.songs[0].liveAssets.cues.length,clickEvents:result.manifest.songs[0].liveAssets.click.events.length,slidesMidiEvents:result.manifest.songs[0].arrangement.proPresenterMidi.length,midiOutputName:result.manifest.songs[0].arrangement.midiOutputName};await writeFile(path.resolve("artifacts/milestone4-confirmed-arrangement.json"),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
