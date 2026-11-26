// Retain current sealed generation keys; only obsolete project-step memos may go.
import {lstatSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {isAbsolute,resolve,relative,sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import * as v from 'valibot';
import {preparationCacheKey} from './preparation-cache-key.mjs';
import {generationPlan} from './gen-programs.mjs';
import {builtShardFolders} from './shard-outputs.mjs';
import {InputHashMemo} from './bake-input-hashes.mjs';
import {folderMapInput,folderFlags,folderRecipe,runtimeCopyIssues} from './built-folder.mjs';
import {folderInputKey,folderToolchainKey} from './shardfile-inputs.mjs';
import {shardfileValidationRevision} from './shardfile-validation-revision.mjs';
import {readBuildKey} from './shardfile-cache.mjs';

const hash=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Manifest=v.strictObject({key:hash,files:v.pipe(v.array(v.strictObject({name:v.string(),hash,
  bytes:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(256_000_000))})),v.maxLength(4096))});
const Inputs=v.object({inputs:v.array(v.string())});

/** Current product admission, rather than this run's cache hits, owns the live G keys.
 * @param {string} root @param {string} cacheRoot @param {string} fallback @param {NodeJS.ProcessEnv} env */
function references(root,cacheRoot,fallback,env) {
  const admitted=preparationCacheKey(root,fallback,{cacheRoot,env});
  if(!admitted.qualified)throw new Error(`Incomplete current product identity: ${admitted.reason}`);
  const plan=generationPlan(root),memo=new InputHashMemo(root);
  const toolchain=`${folderToolchainKey(root,memo)}:${shardfileValidationRevision(root)}`;
  /** @type {Set<string>} */
  const keys=new Set();
  /** @type {Record<string,string[]>} */
  const products={};
  for(const product of builtShardFolders(root,plan.folders)) {
    const name=product.slug,folder=product.folder,output=name===folder?undefined:name;
    const project=resolve(root,'src/shards',folder),map=folderMapInput(project,output);
    const flags=folderFlags(root,output,map,runtimeCopyIssues(root,project).length===0);
    const {recipe,receipts}=folderRecipe(root,name,flags,toolchain,cacheRoot),key=readBuildKey(resolve(root,'out',name));
    const file=resolve(receipts,`${key}.json`);
    if(folderInputKey(root,file,recipe,memo)!==key)throw new Error(`Current read receipt differs ${name}`);
    const saved=v.parse(Inputs,JSON.parse(readFileSync(file,'utf8')));
    const current=saved.inputs.filter(entry=>entry.startsWith('G ')).map(entry=>v.parse(hash,entry.slice(2)));
    products[name]=current;for(const value of current)keys.add(value);
  }
  if(JSON.stringify(Object.keys(products).sort())!==JSON.stringify([...plan.products].sort()))throw new Error('Partial generation marks');
  return {keys,products,folders:new Set(plan.folders)};
}

/** Recognized obsolete project-step entries only. Global codec/wire memos and
 * every current G-key entry survive. Real callers default to a dry-run census.
 * @param {string} sourceRoot @param {string} cacheRoot @param {string} genRoot @param {string} fallback
 * @param {{env?:NodeJS.ProcessEnv,dryRun?:boolean,seconds?:number}} [options] */
export function trimGenerationCache(sourceRoot,cacheRoot,genRoot,fallback,{env=process.env,dryRun=true,seconds=15}={}) {
  const started=performance.now(),deadline=started+seconds*1000;
  const report={qualified:false,reason:'incomplete',dryRun,products:0,keys:0,files:0,bytes:0,
    referencedEntries:0,referencedFiles:0,referencedBytes:0,historyEntries:0,historyFiles:0,historyBytes:0,
    retainedFiles:0,retainedBytes:0,unknownEntries:0,removedEntries:0,removedFiles:0,removedBytes:0,milliseconds:0};
  try {
    const root=realpathSync(sourceRoot),marks=references(root,cacheRoot,fallback,env);
    report.products=Object.keys(marks.products).length;report.keys=marks.keys.size;
    const base=resolve(genRoot),top=lstatSync(base,{throwIfNoEntry:false});
    if(top===undefined){report.qualified=true;report.reason='no-generation-cache';return report;}
    if(!top.isDirectory()||top.isSymbolicLink())throw new Error('Linked or invalid generation cache');
    /** @type {Map<string,{files:Map<string,number>,bytes:number,path:string}>} */
    const groups=new Map();
    /** @param {string} directory */
    const walk=directory=>{
      if(performance.now()>deadline)throw new Error('Generation inventory budget exceeded');
      for(const entry of readdirSync(directory,{withFileTypes:true})) {
        const path=resolve(directory,entry.name),rel=relative(base,path).split(sep).join('/'),parts=rel.split('/');
        const stat=lstatSync(path);
        if(stat.isSymbolicLink())throw new Error('Linked generation cache member');
        if(stat.isDirectory())walk(path);
        else if(stat.isFile()) {
          report.files++;report.bytes+=stat.size;
          const folder=parts[0],step=parts[1],key=parts[2];
          if(folder===undefined||step===undefined||key===undefined||!marks.folders.has(folder)
            ||!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(step)||!/^[a-f0-9]{64}$/u.test(key)||parts.length<4){report.unknownEntries++;continue;}
          const id=parts.slice(0,3).join('/');let group=groups.get(id);
          if(group===undefined){group={files:new Map(),bytes:0,path:resolve(base,id)};groups.set(id,group);}
          group.files.set(parts.slice(3).join('/'),stat.size);group.bytes+=stat.size;
        } else throw new Error('Nonregular generation cache member');
      }
    };
    // Global wire/codec memos have no project G-key authority and stay untouched.
    // Bound the inventory to declared project roots rather than scanning those
    // unrelated caches (which can contain hundreds of thousands of files).
    for(const folder of marks.folders) {
      const directory=resolve(base,folder),stat=lstatSync(directory,{throwIfNoEntry:false});
      if(stat===undefined)continue;
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Linked or invalid project cache');
      walk(directory);
    }
    /** @type {{path:string,files:number,bytes:number}[]} */
    const candidates=[];
    for(const [id,group] of groups) {
      const key=id.split('/')[2];
      if(key!==undefined&&marks.keys.has(key)) {
        report.referencedEntries++;report.referencedFiles+=group.files.size;report.referencedBytes+=group.bytes;continue;
      }
      if(performance.now()>deadline)throw new Error('Generation inventory budget exceeded');
      try {
        const size=group.files.get('index.json');if(size===undefined||size>1_000_000)throw new Error('Unknown manifest');
        const manifest=v.parse(Manifest,JSON.parse(readFileSync(resolve(group.path,'index.json'),'utf8')));
        if(manifest.key!==key)throw new Error('Crossed generation key');
        const expected=new Map([['index.json',size]]),names=new Set();
        for(const file of manifest.files) {
          if(file.name.length===0||isAbsolute(file.name)||file.name.includes('\\')
              ||file.name.split('/').some(part=>part===''||part==='.'||part==='..')||names.has(file.name))
            throw new Error('Invalid generation file name');
          names.add(file.name);
          if(expected.has(file.hash)&&expected.get(file.hash)!==file.bytes)throw new Error('Conflicting generation file');
          expected.set(file.hash,file.bytes);
        }
        if(expected.size!==group.files.size||[...expected].some(([name,length])=>group.files.get(name)!==length))throw new Error('Incomplete generation body');
        candidates.push({path:group.path,files:group.files.size,bytes:group.bytes});
      } catch {report.unknownEntries++;}
    }
    if(performance.now()>deadline)throw new Error('Generation inventory budget exceeded');
    if(report.unknownEntries!==0)throw new Error('Unknown generation entries; retain all history');
    report.historyEntries=candidates.length;report.historyFiles=candidates.reduce((sum,row)=>sum+row.files,0);
    report.historyBytes=candidates.reduce((sum,row)=>sum+row.bytes,0);
    report.retainedFiles=report.files-report.historyFiles;report.retainedBytes=report.bytes-report.historyBytes;
    report.qualified=true;report.reason='current-admitted-generation-keys';
    if(!dryRun)for(const row of candidates) {
      rmSync(row.path,{recursive:true});report.removedEntries++;report.removedFiles+=row.files;report.removedBytes+=row.bytes;
    }
  } catch(error) {report.qualified=false;report.reason=error instanceof Error?error.message:'Unknown generation inventory';}
  finally {report.milliseconds=Math.round(performance.now()-started);}
  return report;
}
