import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function smokePackagedLibraries(appDirectory){
const directory=path.resolve(appDirectory);
const script=`
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const fromApp=createRequire(path.join(process.argv[1],'resources','app.asar','package.json'));
const {XMLParser}=fromApp('fast-xml-parser');
assert.equal(new XMLParser().parse('<root><value>ready</value></root>').root.value,'ready');
const zip=fromApp('fflate');
assert.equal(zip.strFromU8(zip.unzipSync(zip.zipSync({'test.txt':zip.strToU8('ready')}))['test.txt']),'ready');
fromApp('qrcode').toDataURL('isolated-library-smoke-test').then(result=>{assert.match(result,/^data:image\\/png;base64,/);console.log('Packaged XML, ZIP, and QR libraries passed using Electron '+process.versions.electron);}).catch(error=>{console.error(error);process.exitCode=1;});
`;
const result=spawnSync(path.join(directory,'Playback V3.exe'),['-e',script,directory],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PATH:path.join(process.env.SystemRoot,'System32')},windowsHide:true,encoding:'utf8',timeout:30000});
if(result.status!==0||!result.stdout.includes('Packaged XML, ZIP, and QR libraries passed'))throw Error(result.error?.message||result.stderr||'Packaged library smoke check failed');
console.log(result.stdout.trim());
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))smokePackagedLibraries(process.argv[2]);
