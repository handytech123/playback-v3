import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { verifyRuntime,sha256 } from './runtime-contract.mjs';
import { verifyProgramming } from './verify-programming.mjs';
export async function verifyPackage(appDirectory){
 const resources=path.join(appDirectory,'resources'),archive=path.join(resources,'app.asar');
 const manifest=JSON.parse(await fs.readFile('release-runtime/manifest.json','utf8'));
 const programmingFiles=await verifyProgramming(archive);
 const actualEntries=asar.listPackage(archive).map(n=>n.replaceAll('\\','/').replace(/^\//,''));
 for(const [name,expected] of Object.entries(manifest.files)){
  if(sha256(asar.extractFile(archive,path.normalize(name)))!==expected)throw Error(`Release programming missing or changed: ${name}`);
 }
 for(const name of actualEntries){
  if(/(^|\/)(\.playback-data|\.playback-cache|\.git)(\/|$)|\.test\.js$/.test(name))throw Error(`Private or development data in installer: ${name}`);
 }
 const pkg=JSON.parse(asar.extractFile(archive,'package.json'));
 for(const dependency of Object.keys(pkg.dependencies))asar.statFile(archive,path.normalize(`node_modules/${dependency}/package.json`));
 const runtime=await verifyRuntime(resources);
 const result={version:pkg.version,archiveSha256:sha256(await fs.readFile(archive)),preservedProgrammingFiles:Object.keys(manifest.files).length,programmingFiles,runtime};
 await fs.writeFile(path.join(resources,'release-integrity.json'),JSON.stringify(result,null,2)+'\n');
 console.log(`Verified complete ${pkg.version} package: release code, production modules, native engine, DLLs, and audio tools.`);
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyPackage(path.resolve(process.argv[2]||'release/win-unpacked'));
