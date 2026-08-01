import { mkdir,readFile,rename,writeFile } from "node:fs/promises";
import { dirname,join } from "node:path";
import { createHash } from "node:crypto";
import type { ArrangementVersion } from "./arrangement.js";

export async function saveArrangementVersion(root:string,arrangement:ArrangementVersion):Promise<string>{
  const songDirectory=`song-${createHash("sha256").update(String(arrangement.songId)).digest("hex").slice(0,16)}`,directory=join(root,songDirectory,"arrangements"),path=join(directory,`${arrangement.id}.json`);await mkdir(directory,{recursive:true});
  try{const existing=JSON.parse(await readFile(path,"utf8")) as ArrangementVersion;if(existing.sourceSha256===arrangement.sourceSha256)return path;throw new Error("Arrangement version id collision");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const temporary=`${path}.tmp-${process.pid}-${Date.now()}`;await writeFile(temporary,JSON.stringify(arrangement,null,2),{encoding:"utf8",flag:"wx"});await rename(temporary,path);return path;
}
