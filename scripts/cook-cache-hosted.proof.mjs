// TC28: actual cold/reused/cold cooks run only on a hosted runner. No hook
// discovery, no local cook and no reuse of a simulation verdict.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {deterministicCookIndex} from './cook-cache-model.ts';
import {join,relative,resolve,sep} from 'node:path';

if(process.env.GITHUB_ACTIONS!=='true')throw new Error('TC28 real cook proof runs on hosted CI only');
const root=process.cwd();
await import('./bake-loader.mjs');
const {createCookWorker,indexKey}=await import('../src/cook/game/cookWorker.ts');
const {MAX_SHARDFILE_BYTES}=await import('@wildshard/format/uploadCaps');
const {folderStore}=await import('../src/cook/game/packStore.ts');
const {wholeBrasscapProduct}=await import('./pin-format.ts');
const {cookRevision}=await import('./cook-revision.ts');
const directory=resolve('tmp/cook-cache-proof'),reports=resolve(process.env.WS_COOK_CACHE_REPORT??'tmp/cook-cache-report');
mkdirSync(directory,{recursive:true});mkdirSync(reports,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),started=performance.now(),build='cache-proof';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),recipe=cookRevision(root);
/** @param {Uint8Array} bytes */
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Successful encoder misses replace cache entries through temp+rename.
 * Observe the actual warm cache identities and validate each body.
 * @param {string} folder */
function cacheEntries(folder){
 return readdirSync(folder).filter(name=>/^[a-f0-9]{64}\.br$/u.test(name)).sort((a,b)=>a.localeCompare(b)).map(name=>{
  const file=join(folder,name),stat=statSync(file,{bigint:true}),body=readFileSync(file),raw=brotliDecompressSync(body,{maxOutputLength:MAX_SHARDFILE_BYTES});
  assert.equal(digest(raw),name.slice(0,-3));
  return {name,hash:digest(body),rawBytes:raw.length,wireBytes:body.length,ino:String(stat.ino),mtimeNs:String(stat.mtimeNs)};
 });
}
try{
 const quick=JSON.parse(readFileSync(join(reports,'quick.json'),'utf8'));
 assert.equal(quick.version,1);assert.equal(quick.complete,true);assert.equal(quick.cases,3);assert.equal(quick.sha,sha);assert.equal(quick.cookRevision,recipe.revision);
 const product=wholeBrasscapProduct(),head={slug:product.pin.slug,hash:product.pin.hash};
 const script=join(root,'scripts/cook-job.mjs');
 const shared=join(work,'shared-jobs'),coldJobs=join(work,'cold-jobs');
 assert.equal(existsSync(join(shared,'cache')),false);assert.equal(existsSync(join(coldJobs,'cache')),false);
 /** @param {string} name @param {string} jobs */
 const run=async(name,jobs)=>{
  const store=folderStore(join(work,name,'store')),server=join(work,name,'server');
  /** @type {string[]} */const notes=[];
  const worker=createCookWorker({build,store,serverPacks:server,scratch:jobs,log:line=>{notes.push(line);},
   source:{heads:()=>Promise.resolve([{...head,revision:1}]),download:hash=>{assert.equal(hash,head.hash);return Promise.resolve(product.bytes);}},
   launcher:{root,execPath:process.execPath,loader:join(root,'scripts/bake-loader.mjs'),script,wrap:[],renderer:recipe.renderer,
    limits:{seconds:120,memoryMB:4096,heapMB:2048,cpuSlots:2}}});
  const began=performance.now(),row=await worker.cook(head),elapsedMs=performance.now()-began;
  assert.ok(notes.every(line=>!/: try \d+ failed:/u.test(line)),notes.join(' | '));
  assert.equal(row.state,'cooked',JSON.stringify(row));
  const bytes=await store.get(indexKey(build,head.hash));assert.ok(bytes);
  const index=/** @type {import('../src/cook/game/cookWorker.ts').CookIndex} */ (JSON.parse(new TextDecoder().decode(bytes)));
  const entries=cacheEntries(join(jobs,'cache'));
  assert.ok(entries.length>0);assert.ok(['proved','unmeasured'].includes(index.proof));
  /** @type {Record<string,string>} */const objects={};
  for(const key of index.keys){const body=await store.get(key);assert.ok(body,key);objects[key]=digest(body);}
  const folder=join(server,head.slug,head.hash);
  /** @type {Record<string,string>} */const serverFiles={};
  for(const entry of readdirSync(folder,{recursive:true,withFileTypes:true}))if(entry.isFile()){
   const file=join(entry.parentPath,entry.name);serverFiles[relative(folder,file).split(sep).join('/')]=digest(readFileSync(file));}
  assert.ok(Object.keys(objects).length>0);assert.ok(Object.keys(serverFiles).length>0);
  return {index,entries,objects,serverFiles,elapsedMs,seconds:row.seconds,peakMB:row.peakMB,storeKeys:(await store.list('')).map(item=>item.key).sort((a,b)=>a.localeCompare(b))};
 };
 const first=await run('prime',shared),warm=await run('reuse',shared),cold=await run('cold',coldJobs);
 assert.deepEqual(warm.entries,first.entries,'Warm production cook must leave every cached body, inode and nanosecond timestamp unchanged');
 /** @param {ReturnType<typeof cacheEntries>} entries */
 const content=entries=>entries.map(({name,hash,rawBytes,wireBytes})=>({name,hash,rawBytes,wireBytes}));
 assert.deepEqual(content(first.entries),content(cold.entries),'Independent cold encoding must produce the same bodies');
 assert.deepEqual(warm.storeKeys,cold.storeKeys);assert.deepEqual([...warm.index.keys].sort((a,b)=>a.localeCompare(b)),[...cold.index.keys].sort((a,b)=>a.localeCompare(b)));
 assert.deepEqual(warm.objects,cold.objects);assert.deepEqual(warm.serverFiles,cold.serverFiles);
 assert.deepEqual(deterministicCookIndex(warm.index),deterministicCookIndex(cold.index));
 assert.deepEqual(deterministicCookIndex(first.index),deterministicCookIndex(warm.index));
 assert.deepEqual(first.objects,warm.objects);assert.deepEqual(first.serverFiles,warm.serverFiles);
 assert.equal(cookRevision(root).revision,recipe.revision,'Cook inputs must not change during the three real cooks');
 /** @param {Awaited<ReturnType<typeof run>>} row */
 const observation=row=>({elapsedMs:row.elapsedMs,seconds:row.seconds,peakMB:row.peakMB,proof:row.index.proof,preparation:row.index.preparation,uniqueParts:row.entries.length,scriptTiming:row.index.check?.performance.scripts.scripts??null,rawBytes:row.entries.reduce((n,e)=>n+e.rawBytes,0),wireBytes:row.entries.reduce((n,e)=>n+e.wireBytes,0)});
 const report={version:1,complete:true,sha,run:process.env.GITHUB_RUN_ID,cookRevision:recipe.revision,slug:head.slug,hash:head.hash,source:product.source,quick,
  prime:observation(first),reused:observation(warm),cold:observation(cold),warmCacheUnchanged:true,objects:Object.keys(warm.objects).length,
  serverFiles:Object.keys(warm.serverFiles).length,keys:warm.storeKeys,cache:content(warm.entries),seconds:(performance.now()-started)/1000};
 writeFileSync(join(reports,'receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){writeFileSync(join(reports,'failure.json'),JSON.stringify({complete:false,error:String(error)},null,2));throw error;}
finally{rmSync(work,{recursive:true,force:true});}
