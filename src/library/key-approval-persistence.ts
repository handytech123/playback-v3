import { mkdir,readFile,rename,writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyApproval } from "./key-diagnostics.js";

export async function saveKeyApproval(root:string,approval:KeyApproval):Promise<string>{const directory=join(root,"key-approvals"),path=join(directory,`${safe(approval.songId)}.json`),temporary=`${path}.tmp-${process.pid}-${Date.now()}`;await mkdir(directory,{recursive:true});await writeFile(temporary,JSON.stringify(approval,null,2),{encoding:"utf8",flag:"wx"});await rename(temporary,path);return path;}
export async function loadKeyApproval(root:string,songId:string):Promise<KeyApproval|null>{try{return JSON.parse(await readFile(join(root,"key-approvals",`${safe(songId)}.json`),"utf8")) as KeyApproval;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}}
function safe(value:string):string{return value.replace(/[^a-zA-Z0-9._-]/g,"_");}
