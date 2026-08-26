import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync('release-runtime/manifest.json','utf8'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
for(const [name,expected] of Object.entries(manifest.sourceHashes)){
 if(hash(fs.readFileSync(name,'utf8').replace(/\r\n/g,'\n'))!==expected)throw new Error(`Source changed: ${name}. Reconcile or retire the release-runtime override before rebuilding; never silently overwrite new programming.`);
}
const group=process.argv[2]||'all';
let count=0;
for(const [name,expected] of Object.entries(manifest.files)){
 const isUi=name.startsWith('ui-dist/');
 if(group==='backend'&&isUi||group==='ui'&&!isUi)continue;
 const bytes=fs.readFileSync(path.join('release-runtime',name));
 if(hash(bytes)!==expected)throw new Error(`Release file integrity failed: ${name}`);
 fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,bytes);count++;
}
console.log(`Applied ${count} verified ${group} release files.`);
