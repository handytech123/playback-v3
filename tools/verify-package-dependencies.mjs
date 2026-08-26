import path from 'node:path';
import * as asar from '@electron/asar';

// Resolve from each package's directory, including nested/scoped dependencies.
export function verifyPackageDependencies(archive){
 const checked=new Set(),visiting=['package.json'];
 const read=name=>JSON.parse(asar.extractFile(archive,path.normalize(name)).toString());
 while(visiting.length){
  const name=visiting.pop();if(checked.has(name))continue;checked.add(name);
  const manifest=read(name),optional=manifest.optionalDependencies||{};
  const required=Object.keys(manifest.dependencies||{}).filter(dependency=>!Object.hasOwn(optional,dependency));
  for(const dependency of required){
   const resolved=resolveDependency(archive,path.posix.dirname(name),dependency);
   if(!resolved)throw Error(`Packaged dependency missing: ${dependency} required by ${name}`);
   visiting.push(resolved);
  }
  for(const dependency of Object.keys(optional)){
   const resolved=resolveDependency(archive,path.posix.dirname(name),dependency);if(resolved)visiting.push(resolved);
  }
 }
 return checked.size-1;
}
function resolveDependency(archive,from,dependency){
 if(!/^(?:@[^/]+\/)?[^/]+$/.test(dependency)||/[\\:]/.test(dependency)||dependency.split('/').some(part=>part==='.'||part==='..'))throw Error(`Invalid package dependency name: ${dependency}`);
 for(let directory=from;;directory=path.posix.dirname(directory)){
  const name=path.posix.join(directory,'node_modules',dependency,'package.json');
  try{asar.statFile(archive,path.normalize(name));return name;}catch{}
  if(directory==='.')return null;
 }
}
