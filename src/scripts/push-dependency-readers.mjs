// Meta QA 11-26 row 88: a dependency pin bump runs, in the split push gate, the tests that import what the bump changed.
//
// engine 85f353419 pinned shard-format 0.82.9, whose audio schema admits only `title` from the engine style (SF23).
// test/boot-audio-packs.test.ts fed the old island and pine fixture straight to `parseAudioData` and main went red. The
// gate never ran it: package.json makes the selection full, and the split gate's full mode runs only the native files.
// So for each changed dependency the gate diffs the old and new installed copies (both sit in the pnpm store), follows
// the package's own relative imports from each export entry to the changed files, and runs the repo's Vitest files that
// import a changed entry by name. A version missing from the store falls back to every direct reader of the package.
import {execFileSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {vitestFile} from './push-selection.mjs';

/** The local gate's reader budget per dependency: the nearest import tier always runs, and farther tiers join while
 * the total stays at or under this. Hosted CI's full suite runs the rest. A no-diff fallback over it runs none locally. */
export const DEPENDENCY_READER_LIMIT=80;
const SECTIONS=['dependencies','devDependencies','optionalDependencies'];
const SOURCE=/\.(?:[cm]?[jt]sx?|json)$/u;

/** @typedef {{alias:string,name:string,from:string|undefined,to:string}} DependencyChange */

/** `npm:@scope/name@1.2.3` or a plain version, as the installed package name and version.
 * @param {string} alias @param {string} spec */
function parseSpec(alias,spec){
 const aliased=/^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/u.exec(spec);
 return aliased===null?{name:alias,version:spec}:{name:aliased[1]??alias,version:aliased[2]??spec};
}

/** Every dependency whose spec changed or was added between two package.json documents.
 * @param {string} before @param {string} after @returns {DependencyChange[]} */
export function changedDependencies(before,after){
 /** @param {string} text @returns {Record<string,string>} */
 const read=text=>{
  const json=JSON.parse(text);
  return Object.assign({},...SECTIONS.map(section=>json?.[section]??{}));
 };
 const old=read(before),now=read(after);
 /** @type {DependencyChange[]} */const changes=[];
 for(const [alias,spec] of Object.entries(now).sort(([a],[b])=>a.localeCompare(b))){
  if(old[alias]===spec)continue;
  const next=parseSpec(alias,spec),prior=old[alias]===undefined?undefined:parseSpec(alias,old[alias]);
  changes.push({alias,name:next.name,from:prior?.name===next.name?prior.version:undefined,to:next.version});
 }
 return changes;
}

/** A version's installed copy beside the one `installed` resolves to: pnpm's store links layout
 * (`links/<name>/<version>/<hash>/node_modules/<name>`) or a virtual store (`.pnpm/<name>@<version>…/node_modules/<name>`).
 * @param {string} installed realpath of the installed package @param {string} name @param {string} version */
export function versionDir(installed,name,version){
 const tail=`${join('node_modules',name)}`;
 if(!installed.endsWith(tail))return null;
 const holder=installed.slice(0,-tail.length-1);
 /** @param {string} dir */
 const has=dir=>existsSync(join(dir,tail,'package.json'))?join(dir,tail):null;
 // links/<name>/<version>/<hash>
 const links=dirname(dirname(holder));
 if(existsSync(join(links,version))){
  for(const hash of readdirSync(join(links,version)).sort()){const found=has(join(links,version,hash));if(found!==null)return found;}
 }
 // .pnpm/<name with + for />@<version>[_peers]
 const flat=`${name.replace('/','+')}@${version}`,virtual=dirname(holder);
 if(existsSync(virtual)){
  for(const entry of readdirSync(virtual).sort()){
   if(entry!==flat&&!entry.startsWith(`${flat}_`))continue;
   const found=has(join(virtual,entry));if(found!==null)return found;
  }
 }
 return null;
}

/** @param {string} root @param {string} [dir] @returns {string[]} package-relative source files */
function sourceFiles(root,dir=root){
 /** @type {string[]} */const files=[];
 for(const entry of readdirSync(dir)){
  if(entry==='node_modules')continue;
  const path=join(dir,entry);
  if(statSync(path).isDirectory())files.push(...sourceFiles(root,path));
  else if(SOURCE.test(entry))files.push(relative(root,path).replaceAll('\\','/'));
 }
 return files;
}

/** Source files added, removed or changed between two copies of one package (package.json's own version line aside).
 * @param {string} oldDir @param {string} newDir */
export function changedPackageFiles(oldDir,newDir){
 const old=new Set(sourceFiles(oldDir)),now=new Set(sourceFiles(newDir));
 /** @type {string[]} */const changed=[];
 for(const file of new Set([...old,...now])){
  if(file==='package.json')continue;
  if(!old.has(file)||!now.has(file)||!readFileSync(join(oldDir,file)).equals(readFileSync(join(newDir,file))))changed.push(file);
 }
 return changed.sort();
}

/** The export subpaths whose relative imports inside the package reach a changed file, nearest first: `distance` counts
 * the import steps from the entry's own file to a changed one (0: the entry is the changed file).
 * @param {string} dir @param {string[]} changed package-relative paths @returns {{entry:string,distance:number}[]} */
export function changedEntryPoints(dir,changed){
 const manifest=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
 /** @type {Record<string,unknown>} */
 const exportsMap=typeof manifest.exports==='string'?{'.':manifest.exports}:manifest.exports??{'.':manifest.main??'index.js'};
 const files=sourceFiles(dir),known=new Set(files);
 /** @type {Map<string,string[]>} who imports each file */const importers=new Map();
 for(const file of files){
  if(file.endsWith('.json'))continue;
  const text=readFileSync(join(dir,file),'utf8');
  for(const match of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu)){
   const target=join(dirname(file),match[1]??'').replaceAll('\\','/');
   const found=[target,`${target}.ts`,`${target}.mjs`,`${target}.js`,`${target}/index.ts`,`${target}/index.js`].find(path=>known.has(path));
   if(found!==undefined)importers.set(found,[...importers.get(found)??[],file]);
  }
 }
 /** @type {Map<string,number>} */const distance=new Map(changed.map(file=>[file,0]));
 for(let queue=[...changed];queue.length>0;){
  /** @type {string[]} */const next=[];
  for(const file of queue)for(const importer of importers.get(file)??[]){
   if(distance.has(importer))continue;
   distance.set(importer,(distance.get(file)??0)+1);next.push(importer);
  }
  queue=next;
 }
 /** @param {unknown} value @returns {string[]} */
 const targets=value=>typeof value==='string'?[value]:value!==null&&typeof value==='object'?Object.values(value).flatMap(targets):[];
 /** @type {{entry:string,distance:number}[]} */const entries=[];
 for(const [entry,value] of Object.entries(exportsMap)){
  const steps=targets(value).map(path=>distance.get(path.replace(/^\.\//u,''))).filter(step=>step!==undefined);
  if(steps.length>0)entries.push({entry,distance:Math.min(...steps)});
 }
 return entries.sort((a,b)=>a.distance-b.distance||a.entry.localeCompare(b.entry));
}

/** The repo's Vitest files naming one of these import specifiers whole, or (`prefix`) any specifier under them.
 * @param {string} cwd @param {string[]} specifiers @param {{prefix?:boolean}} [options] */
export function directReaders(cwd,specifiers,options={}){
 if(specifiers.length===0)return [];
 const close=options.prefix?String.raw`(['"/])`:`['"]`;
 const pattern=`['"](${specifiers.map(spec=>spec.replaceAll(/[.[\]()*+?{}|^$\\/]/gu,String.raw`\$&`)).join('|')})${close}`;
 let listed='';
 try{listed=execFileSync('git',['grep','-l','-E','-e',pattern,'--','src','test'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
 catch(error){if(!(error instanceof Error&&'status' in error&&error.status===1))throw error;}
 return listed.split('\n').filter(file=>vitestFile.test(file)).sort();
}

/** The tests a pushed dependency change should run locally, and one line per dependency saying why.
 * @param {string|undefined} refs pre-push ref lines @param {string} [cwd]
 * @returns {{tests:string[],notes:string[]}} */
export function dependencyReaders(refs,cwd=process.cwd()){
 /** @type {Set<string>} */const tests=new Set();/** @type {string[]} */const notes=[];
 for(const line of (refs??'').trim().split('\n').filter(Boolean)){
  const [,local,,remote]=line.trim().split(/\s+/u);
  if(!/^[a-f0-9]{40}$/u.test(local??'')||!/^[a-f0-9]{40}$/u.test(remote??'')||/^0+$/u.test(local??'')||/^0+$/u.test(remote??''))continue;
  const show=(/** @type {string} */sha)=>{try{return execFileSync('git',['show',`${sha}:package.json`],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return null;}};
  const before=show(remote??''),after=show(local??'');
  if(before===null||after===null||before===after)continue;
  for(const change of changedDependencies(before,after)){
   let installed=null;
   try{installed=realpathSync(resolve(cwd,'node_modules',change.alias));}catch{ /* not installed here */ }
   const oldDir=installed===null||change.from===undefined?null:versionDir(installed,change.name,change.from);
   const newDir=installed===null?null:versionDir(installed,change.name,change.to)??installed;
   /** @type {string[]} */let found;
   if(oldDir===null||newDir===null){
    found=directReaders(cwd,[change.alias],{prefix:true});
    notes.push(`${change.alias} ${change.from??'(new)'} -> ${change.to}: no old copy to diff; every direct reader (${found.length})`);
   }else{
    // Nearest entries first: each import step out from the change is one tier, and a tier joins while the readers fit.
    const entries=changedEntryPoints(newDir,changedPackageFiles(oldDir,newDir));
    const specifier=(/** @type {string} */entry)=>entry==='.'?change.alias:`${change.alias}/${entry.replace(/^\.\//u,'')}`;
    /** @type {Set<string>} */const taken=new Set();
    let tiers=0;/** @type {number|null} */let cut=null;
    for(const step of new Set(entries.map(row=>row.distance))){
     const tier=directReaders(cwd,entries.filter(row=>row.distance===step).map(row=>specifier(row.entry)));
     if(tiers>0&&new Set([...taken,...tier]).size>DEPENDENCY_READER_LIMIT){cut=step;break;}
     for(const test of tier)taken.add(test);
     tiers++;
    }
    found=[...taken];
    notes.push(`${change.alias} ${change.from} -> ${change.to}: ${entries.length} entry point(s) reach the change; ${found.length} reader(s) of the nearest ${tiers} import step(s)${cut===null?'':`; step ${cut} on runs on hosted CI`}`);
   }
   if(found.length>DEPENDENCY_READER_LIMIT){notes.push(`${change.alias}: ${found.length} readers is over ${DEPENDENCY_READER_LIMIT}; hosted CI's full suite runs them`);continue;}
   for(const test of found)tests.add(test);
  }
 }
 return {tests:[...tests].sort(),notes};
}
