import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as asar from '@electron/asar';
import {verifyProgramming} from '../../tools/verify-programming.mjs';
import {verifyPackageDependencies} from '../../tools/verify-package-dependencies.mjs';
const apply=path.resolve('tools/apply-release-runtime.mjs');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'playback-package-test-'));
 t.after(async()=>{const rel=path.relative(os.tmpdir(),root);if(rel.startsWith('playback-package-test-')&&!rel.includes(path.sep))await fs.rm(root,{recursive:true,force:true});});
 const write=async(name,data)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),data);};
 await write('src/main.ts','export {};\r\n');
 await write('dist/src/main.js','original');
 await write('release-runtime/dist/src/main.js','release');
 const manifest={sourceHashes:{'src/main.ts':hash('export {};\n')},files:{'dist/src/main.js':hash('release')}};
 const run=async(group='all')=>{await write('release-runtime/manifest.json',JSON.stringify(manifest));return spawnSync(process.execPath,[apply,group],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000});};
 return{root,write,manifest,run};
}
test('release source guard accepts both Windows CRLF and Git LF checkouts',async t=>{
 const f=await fixture(t);assert.equal((await f.run()).status,0);
 await f.write('src/main.ts','export {};\n');assert.equal((await f.run()).status,0);
 assert.equal(await fs.readFile(path.join(f.root,'dist/src/main.js'),'utf8'),'release');
});
test('source edits fail without overwriting a build output',async t=>{
 const f=await fixture(t);await f.write('src/main.ts','changed');const result=await f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Source changed/);
 assert.equal(await fs.readFile(path.join(f.root,'dist/src/main.js'),'utf8'),'original');
});
test('corrupt later override fails before any earlier override is applied',async t=>{
 const f=await fixture(t);f.manifest.files['dist/src/second.js']=hash('expected');await f.write('release-runtime/dist/src/second.js','corrupt');
 const result=await f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/integrity failed/);
 assert.equal(await fs.readFile(path.join(f.root,'dist/src/main.js'),'utf8'),'original');
});
test('unknown build group and escaping destinations cannot write files',async t=>{
 const f=await fixture(t);assert.match((await f.run('typo')).stderr,/Unknown release group/);
 f.manifest.files['../escaped.js']=hash('bad');assert.match((await f.run()).stderr,/Unsafe release path/);
 assert.equal(await fs.readFile(path.join(f.root,'dist/src/main.js'),'utf8'),'original');
});
test('package audit detects missing ordinary modules and broken renderer assets',async t=>{
 const f=await fixture(t),staging=path.join(f.root,'package'),archive=path.join(f.root,'app.asar');
 await f.write('dist/src/main.js','module');await f.write('ui-dist/index.html','<script src="./app.js"></script>');await f.write('ui-dist/app.js','renderer');
 await fs.cp(path.join(f.root,'dist'),path.join(staging,'dist'),{recursive:true});await fs.cp(path.join(f.root,'ui-dist'),path.join(staging,'ui-dist'),{recursive:true});
 await asar.createPackage(staging,archive);assert.equal(await verifyProgramming(archive,f.root),3);
 await fs.unlink(path.join(staging,'dist/src/main.js'));await asar.createPackage(staging,archive);asar.uncache(archive);await assert.rejects(verifyProgramming(archive,f.root),/Programming file missing/);
 await fs.cp(path.join(f.root,'dist'),path.join(staging,'dist'),{recursive:true});
 const broken='<script src="./missing.js"></script>';await f.write('ui-dist/index.html',broken);await fs.writeFile(path.join(staging,'ui-dist/index.html'),broken);
 await asar.createPackage(staging,archive);asar.uncache(archive);await assert.rejects(verifyProgramming(archive,f.root),/Renderer entry is missing/);
});
test('destination-PC checker detects missing and corrupted DLLs without launching the app',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);
 for(const name of ['Playback V3.exe','ffmpeg.dll','icudtl.dat','resources.pak','locales/en-US.pak'])await f.write(name,'fixture - never executed');
 await f.write('resources/app.asar','archive');await f.write('resources/native/runtime.dll','runtime');
 await f.write('resources/release-integrity.json',JSON.stringify({version:'test',archiveSha256:hash('archive'),runtime:{'native/runtime.dll':hash('runtime')}}));
 const check=()=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('tools/verify-installed-playback.ps1'),'-InstallDirectory',f.root],{encoding:'utf8',windowsHide:true,timeout:10000});
 const valid=check();assert.equal(valid.status,0,valid.stderr||valid.stdout);
 await f.write('resources/native/runtime.dll','corrupt');const corrupted=check();assert.notEqual(corrupted.status,0);assert.match(corrupted.stderr,/Changed or incomplete/);
 await fs.unlink(path.join(f.root,'resources/native/runtime.dll'));const missing=check();assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing native/);
});

test('package audit rejects a missing transitive runtime dependency',async t=>{
 const f=await fixture(t),staging=path.join(f.root,'package'),archive=path.join(f.root,'app.asar');
 await f.write('package/package.json',JSON.stringify({dependencies:{parent:'1.0.0'}}));
 await f.write('package/node_modules/parent/package.json',JSON.stringify({dependencies:{child:'1.0.0'}}));
 await asar.createPackage(staging,archive);
 assert.throws(()=>verifyPackageDependencies(archive),/child required by node_modules\/parent/);
 await f.write('package/node_modules/child/package.json','{}');await asar.createPackage(staging,archive);asar.uncache(archive);
 assert.equal(verifyPackageDependencies(archive),2);
});

test('package audit supports nested scoped dependencies, cycles, and absent optional packages',async t=>{
 const f=await fixture(t),staging=path.join(f.root,'package'),archive=path.join(f.root,'app.asar');
 await f.write('package/package.json',JSON.stringify({dependencies:{parent:'1.0.0'},optionalDependencies:{platformOnly:'1.0.0'}}));
 await f.write('package/node_modules/parent/package.json',JSON.stringify({dependencies:{'@scope/child':'1.0.0',platformOnly:'1.0.0'},optionalDependencies:{platformOnly:'1.0.0'}}));
 await f.write('package/node_modules/parent/node_modules/@scope/child/package.json',JSON.stringify({dependencies:{parent:'1.0.0'}}));
 await asar.createPackage(staging,archive);assert.equal(verifyPackageDependencies(archive),2);
});
