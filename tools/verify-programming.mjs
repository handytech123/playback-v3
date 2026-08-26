import fs from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { sha256 } from './runtime-contract.mjs';
export async function verifyProgramming(archive,projectRoot=process.cwd()){
 const checked=[];
 async function walk(relative){
  for(const item of await fs.readdir(path.join(projectRoot,relative),{withFileTypes:true})){
   const name=relative+'/'+item.name;
   if(item.isDirectory()){await walk(name);continue;}
   if(name.endsWith('.map')||name.endsWith('.d.ts')||name.endsWith('.test.js'))continue;
   const expected=await fs.readFile(path.join(projectRoot,name));
   let actual;try{actual=asar.extractFile(archive,path.normalize(name));}catch{throw Error(`Programming file missing from installer: ${name}`);}
   if(sha256(actual)!==sha256(expected))throw Error(`Programming file differs from build: ${name}`);
   checked.push(name);
  }
 }
 await walk('dist/src');await walk('ui-dist');
 const html=asar.extractFile(archive,path.normalize('ui-dist/index.html')).toString();
 for(const [,url] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(!url.startsWith('./'))throw Error(`Renderer entry must be a local packaged resource: ${url}`);
  const target=path.posix.normalize('ui-dist/'+url.slice(2));
  if(!target.startsWith('ui-dist/'))throw Error('Renderer entry escapes its package directory');
  try{asar.statFile(archive,path.normalize(target));}catch{throw Error(`Renderer entry is missing: ${target}`);}
 }
 return checked.length;
}
