// Known reds on main (meta M1/M2, mini coordinator 2026-11-16 ~17:50 Cancún: "pre-push must not refuse a push for a
// test that also fails on origin/main"). Main is pushed to by many lanes and fixed forward; while it is red, every
// split gate that selected the red file refused, so ~12 pushes queued behind one lock to fail on the same red.
//
// When the split gate's Vitest step fails, its failing test ids (file + full name; a file that fails to load is one id,
// `<file>::(file)`) are compared with the same files run on origin/main. A failure origin/main has too is a known red:
// it prints, and the push goes on (main's CI and the forward fixer own it). Only a NEW red refuses. Main's verdict per
// file is cached per origin/main SHA in <git common dir>/known-red/<sha>.json, so the first push after main moves pays
// for one run of those files in a clean copy of main and the rest read it.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';

/** The failing test ids in a Vitest JSON report, keyed by repo-relative file.
 * @param {string} reportFile @param {string} root @returns {Map<string,Set<string>>|null} null: no readable report */
export function failingIds(reportFile,root){
 /** @type {{testResults?:{name:string,status?:string,assertionResults?:{fullName?:string,title?:string,status?:string}[]}[]}} */
 let report;
 try{report=JSON.parse(readFileSync(reportFile,'utf8'));}catch{return null;}
 if(!Array.isArray(report.testResults))return null;
 /** @type {Map<string,Set<string>>} */const out=new Map();
 for(const file of report.testResults){
  const name=relative(root,resolve(root,file.name)).split('\\').join('/');
  const ids=new Set((file.assertionResults??[]).filter(row=>row.status==='failed').map(row=>`${name}::${row.fullName??row.title??''}`));
  if(ids.size===0&&file.status==='failed')ids.add(`${name}::(file)`);
  if(ids.size>0)out.set(name,ids);
 }
 return out;
}

/** The failures of `pushed` that main does not share. @param {Map<string,Set<string>>} pushed @param {Map<string,Set<string>>} main */
export function newReds(pushed,main){
 /** @type {string[]} */const fresh=[];
 for(const [file,ids]of pushed){const known=main.get(file)??new Set();for(const id of ids)if(!known.has(id))fresh.push(id);}
 return fresh.sort();
}

/** @param {string} cwd @param {string[]} args */
function git(cwd,args){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const out=spawnSync('git',args,{cwd,env,encoding:'utf8'});
 if(out.status!==0)throw new Error(`git ${args.join(' ')}: ${out.stderr.trim()}`);
 return out.stdout.trim();
}

/** The cache file for a main SHA. @param {string} root @param {string} sha */
export function cacheFile(root,sha){
 return join(resolve(root,git(root,['rev-parse','--git-common-dir'])),'known-red',`${sha}.json`);
}

/** @param {string} file @returns {Record<string,string[]>} */
function readCache(file){try{return JSON.parse(readFileSync(file,'utf8'));}catch{return {};}}

/** Write main's verdicts into the cache, atomically. @param {string} file @param {Record<string,string[]>} add */
export function writeCache(file,add){
 mkdirSync(dirname(file),{recursive:true});
 const next={...readCache(file),...add},tmp=`${file}.${process.pid}.tmp`;
 writeFileSync(tmp,`${JSON.stringify(next,null,1)}\n`);renameSync(tmp,file);
}

/** Run Vitest on `files` in `cwd`, writing a JSON report. @param {string} cwd @param {string[]} files @param {string} report */
export function runVitest(cwd,files,report){
 spawnSync(process.execPath,['src/scripts/vitest-tmp.ts','run','--passWithNoTests=false','--reporter=json',`--outputFile=${report}`,...files],
  {cwd,stdio:['ignore','ignore','ignore'],env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))});
}

/**
 * Main's failing ids for `files` at origin/main, from the cache or by running the missing ones once in a clean copy of
 * main (the push gate's own copy maker).
 * @param {string} root any checkout of the repo (a gate copy is fine) @param {string[]} files
 * @param {{env?:NodeJS.ProcessEnv,say?:(line:string)=>void,run?:(cwd:string,files:string[],report:string)=>void,copy?:(canonical:string,sha:string)=>Promise<{path:string,remove:()=>void}>}} [options]
 * @returns {Promise<{sha:string,main:Map<string,Set<string>>}>}
 */
export async function mainReds(root,files,{env=process.env,say=line=>process.stderr.write(`${line}\n`),run=runVitest,copy}={}){
 git(root,['fetch','--quiet','origin','main']);
 const sha=git(root,['rev-parse','refs/remotes/origin/main']);
 const file=cacheFile(root,sha);
 const missing=files.filter(name=>!(name in readCache(file)));
 if(missing.length>0){
  const canonical=dirname(resolve(root,git(root,['rev-parse','--git-common-dir'])));
  say(`  - known-red: running ${missing.length} failing file(s) on origin/main ${sha.slice(0,10)} once (cached for every push on this main)`);
  const made=copy===undefined?(await import('./push-gate-copy.mjs')).makeGateCopy(canonical,sha,{env,say}):await copy(canonical,sha);
  try{
   const report=join(made.path,'tmp','known-red-report.json');
   mkdirSync(dirname(report),{recursive:true});
   run(made.path,missing,report);
   const found=failingIds(report,made.path);
   if(found===null)throw new Error('origin/main produced no Vitest report for the failing files');
   writeCache(file,Object.fromEntries(missing.map(name=>[name,[...(found.get(name)??[])]])));
  }finally{made.remove();}
 }
 const cache=readCache(file);
 return {sha,main:new Map(files.map(name=>[name,new Set(cache[name])]))};
}
