import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync('release-runtime/manifest.json','utf8'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const group=process.argv[2]||'all';
if(!['all','backend','ui'].includes(group))throw new Error(`Unknown release group: ${group}`);
const safePath=name=>{
 if(typeof name!=='string'||name.includes('\\')||name.includes(':')||name.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`Unsafe release path: ${name}`);
 return name;
};
for(const [name,expected] of Object.entries(manifest.sourceHashes)){
 safePath(name);
 if(hash(fs.readFileSync(name,'utf8').replace(/\r\n/g,'\n'))!==expected)throw new Error(`Source changed: ${name}. Reconcile or retire the release-runtime override before rebuilding; never silently overwrite new programming.`);
}
const pending=[];
for(const [name,expected] of Object.entries(manifest.files)){
 safePath(name);
 if(!name.startsWith('dist/src/')&&!name.startsWith('ui-dist/')&&name!=='desktop-preload.cjs')throw new Error(`Unexpected release destination: ${name}`);
 const isUi=name.startsWith('ui-dist/');
 if(group==='backend'&&isUi||group==='ui'&&!isUi)continue;
 const bytes=fs.readFileSync(path.join('release-runtime',name));
 if(hash(bytes)!==expected)throw new Error(`Release file integrity failed: ${name}`);
 pending.push([name,bytes]);
}
// Validate the whole selected group before replacing any build output.
for(const [name,bytes] of pending){fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,bytes);}
console.log(`Applied ${pending.length} verified ${group} release files.`);
