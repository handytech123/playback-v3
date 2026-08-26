// Explicit maintenance tool: preserve field-tested fixes pending typed-source migration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as asar from '@electron/asar';
const archive=process.argv[2];
if(!archive) throw new Error('Supply the verified application archive explicitly.');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const differences=JSON.parse(fs.readFileSync('artifacts/installed-build-diff.json','utf8'));
const previous=fs.existsSync('release-runtime/manifest.json')?JSON.parse(fs.readFileSync('release-runtime/manifest.json','utf8')):{files:{}};
const selected=new Set([...Object.keys(previous.files),...differences.map(item=>item.name)]);
const manifest={schema:1,archiveSha256:hash(fs.readFileSync(archive)),files:{},sourceHashes:{}};
for(const item of asar.listPackage(archive)){
 const name=item.replaceAll('\\','/').replace(/^\//,'');
 if(!selected.has(name)&&!name.startsWith('ui-dist/')&&name!=='desktop-preload.cjs')continue;
 if(asar.statFile(archive,path.normalize(name)).files)continue;
 const bytes=asar.extractFile(archive,path.normalize(name));
 const destination=path.join('release-runtime',name);
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
 manifest.files[name]=hash(bytes);
}
function guard(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){
 const name=directory+'/'+item.name;if(item.isDirectory())guard(name);else manifest.sourceHashes[name]=hash(fs.readFileSync(name,'utf8').replace(/\r\n/g,'\n'));
}}
guard('src');
for(const name of ['index.html','desktop-preload.cjs','vite.config.ts','tsconfig.json'])manifest.sourceHashes[name]=hash(fs.readFileSync(name,'utf8').replace(/\r\n/g,'\n'));
fs.writeFileSync('release-runtime/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Captured ${Object.keys(manifest.files).length} release files with source and content integrity guards.`);
