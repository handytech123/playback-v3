import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as asar from '@electron/asar';
const archive = path.join(process.env.LOCALAPPDATA, 'Programs/Playback V3/resources/app.asar');
const printer = ts.createPrinter({removeComments:true});
const normalize = (text) => printer.printFile(ts.createSourceFile('file.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
const changed=[];
for (const entry of asar.listPackage(archive)) {
 const name=entry.replaceAll('\\','/').replace(/^\//,'');
 if (!name.startsWith('dist/src/') || !name.endsWith('.js')) continue;
 const installed=asar.extractFile(archive,path.normalize(name)).toString();
 const local=fs.existsSync(name) ? fs.readFileSync(name,'utf8') : null;
 if (local===null || normalize(local)!==normalize(installed)) changed.push({name,missing:local===null});
}
console.log(JSON.stringify(changed,null,2));
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/installed-build-diff.json',JSON.stringify(changed,null,2));
