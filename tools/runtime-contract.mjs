import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function verifyRuntime(resources){
 const dependencies=JSON.parse(await fs.readFile('release-runtime/runtime-dependencies.json','utf8'));
 const records={};
 for(const [name,expected] of Object.entries(dependencies)){
  const file=resources ? path.join(resources,name) : path.join('vendor',name.startsWith('native/')?'native-runtime/'+path.basename(name):name);
  const bytes=await fs.readFile(file);
  if(sha256(bytes)!==expected)throw Error(`Missing, incomplete, or unexpected runtime dependency: ${name}`);
  if(/\.(exe|dll)$/.test(name))verifyX64(bytes,name);
  records[name]=expected;
 }
 const engine=resources?path.join(resources,'native/PlaybackEngineProbe.exe'):path.resolve('native/build-local/PlaybackEngineProbe_artefacts/Release/PlaybackEngineProbe.exe');
 const bytes=await fs.readFile(engine);verifyX64(bytes,'PlaybackEngineProbe.exe');records['native/PlaybackEngineProbe.exe']=sha256(bytes);
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'playback-runtime-check-'));
 try{
  // Copy the engine next to only its shipped DLLs; remove the development PATH.
  const isolated=path.join(scratch,'PlaybackEngineProbe.exe');await fs.copyFile(engine,isolated);
  for(const name of Object.keys(dependencies).filter(n=>n.startsWith('native/'))){
   await fs.copyFile(resources?path.join(resources,name):path.join('vendor/native-runtime',path.basename(name)),path.join(scratch,path.basename(name)));
  }
  const env={...process.env,PATH:path.join(process.env.SystemRoot,'System32')};
  const run=(file,args,code=0)=>{
   const result=spawnSync(path.resolve(file),args,{env,cwd:scratch,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
   if(result.error||result.status!==code)throw Error(`Bundled ${path.basename(file)} failed without development PATH: ${result.error||result.stderr||result.status}`);
   return (result.stdout||'')+(result.stderr||'');
  };
  if(!run(isolated,[],2).includes('Usage: PlaybackEngineProbe'))throw Error('Native engine usage smoke check failed');
  const runtime=resources?path.join(resources,'runtime'):path.resolve('vendor/runtime');
  if(!run(path.join(runtime,'ffmpeg.exe'),['-hide_banner','-filters']).includes('rubberband'))throw Error('FFmpeg lacks required rubberband filter');
  run(path.join(runtime,'rubberband.exe'),['--version']);
  run(path.join(runtime,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.05','-af','rubberband=tempo=1.1','-f','null','-']);
 }finally{
  const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(scratch));
  if(relative.startsWith('playback-runtime-check-')&&!relative.includes(path.sep))await fs.rm(scratch,{recursive:true,force:true});
 }
 return records;
}
function verifyX64(bytes,name){
 if(bytes.toString('ascii',0,2)!=='MZ')throw Error(`Not a Windows executable: ${name}`);
 const pe=bytes.readUInt32LE(0x3c);
 if(bytes.toString('ascii',pe,pe+4)!=='PE\0\0'||bytes.readUInt16LE(pe+4)!==0x8664)throw Error(`Expected x64 runtime: ${name}`);
}
