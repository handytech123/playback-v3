import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OriginalSongMap } from "./song-map.js";

export function currentSongMapPath(root:string,songId:string):string{return join(root,safe(songId),"current.json");}
export async function saveSongMap(root:string,map:OriginalSongMap):Promise<{currentPath:string;revisionPath:string}>{const songDirectory=join(root,safe(map.songId));const revisions=join(songDirectory,"revisions");await mkdir(revisions,{recursive:true});const revisionPath=join(revisions,`revision-${String(map.revision).padStart(6,"0")}.json`),serialized=JSON.stringify(map,null,2);try{await writeFile(revisionPath,serialized,{encoding:"utf8",flag:"wx"});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST"||await readFile(revisionPath,"utf8")!==serialized)throw error;}const currentPath=currentSongMapPath(root,map.songId),temporary=`${currentPath}.tmp-${process.pid}-${Date.now()}`;await writeFile(temporary,serialized,{encoding:"utf8",flag:"wx"});await rename(temporary,currentPath);return{currentPath,revisionPath};}
export async function loadSongMap(currentPath:string):Promise<OriginalSongMap>{return JSON.parse(await readFile(currentPath,"utf8")) as OriginalSongMap;}
export async function mapExists(path:string):Promise<boolean>{try{await stat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}}
function safe(id:string):string{return id.replace(/[^a-zA-Z0-9._-]/g,"_");}
