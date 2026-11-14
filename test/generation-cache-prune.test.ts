// oxlint-disable-next-line import/no-nodejs-modules -- Own complete cache fixtures below repository scratch.
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own complete cache fixtures below repository scratch.
import {dirname,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Own complete cache fixtures below repository scratch.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Own complete cache fixtures below repository scratch.
import {channel} from 'node:diagnostics_channel';
import {afterEach,expect,test} from 'vitest';
import {trimGenerationCache} from '../scripts/generation-cache-prune.mjs';
import {InputHashMemo} from '../scripts/bake-input-hashes.mjs';
import {captureFolderInputs,folderInputKey,folderToolchainKey,publishFolderInputs,recordBundle} from '../scripts/shardfile-inputs.mjs';
import {publishSourceSnapshot,sourceSnapshotIdentity} from '../scripts/source-input-proof.mjs';
import {shardfileValidationRevision} from '../scripts/shardfile-validation-revision.mjs';

const owned:string[]=[];afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const live='a'.repeat(64),history='b'.repeat(64),shared='c'.repeat(64),other='d'.repeat(64);
const fallback=`preparation-v3-Linux-X64-node24-${'e'.repeat(40)}`;
function write(root:string,path:string,body:string):void {mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),body);}
async function fixture() {
 mkdirSync('tmp',{recursive:true});const root=realpathSync(mkdtempSync(resolve('tmp/generation-prune-')));owned.push(root);
 const cache=resolve(root,'cache'),gen=resolve(root,'gen'),products=['alpha','beta'];
 const files=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','scripts/source-generation-outputs.json',...products.flatMap(p=>[`src/shards/${p}/manifest.json`,`src/shards/${p}/shard.config.ts`])].sort();
 for(const path of files)write(root,path,'{}');
 write(root,'scripts/source-generation-outputs.json',JSON.stringify({producers:{fixture:['src/output.generated.ts']}}));write(root,'src/output.generated.ts','output');
 const inventory=resolve(root,'inventory.json');writeFileSync(inventory,JSON.stringify({root,files:[...files,'src/output.generated.ts']}));
 const env={WS_GENERATION_TREE_ROOT:root,WS_GENERATION_TREE_FILES:inventory};
 const receipts:string[]=[];
 for(const product of products) {
  const source=`src/shards/${product}/shard.config.ts`,memo=new InputHashMemo(root),recipe=[product,'--copy-runtime',`${folderToolchainKey(root,memo)}:${shardfileValidationRevision(root)}`];
  const at=resolve(root,`${product}.inputs`);
  await captureFolderInputs(root,at,async()=>{readFileSync(resolve(root,source));recordBundle({output:[]});channel('wildshard.generation-key').publish({key:product==='alpha'?live:shared});await Promise.resolve();});
  const key=folderInputKey(root,at,recipe,memo);if(key===undefined)throw new Error('Missing receipt');
  const directory=resolve(cache,'.inputs-v2',product,digest(JSON.stringify(recipe)));publishFolderInputs(directory,at,key);receipts.push(resolve(directory,`${key}.json`));
  for(const target of [resolve(root,'out',product),resolve(cache,product,key)]) {
   write(target,'.build-key',key);write(target,'shard.json','{}');write(target,'validation.json',JSON.stringify({buildKey:key,indexHash:digest('{}')}));
  }
 }
 const memo=new InputHashMemo(root);memo.enableSnapshot(file=>file==='src/output.generated.ts');for(const file of files)memo.hash(file);
 publishSourceSnapshot(resolve(root,'.cache/generation-phase.json'),sourceSnapshotIdentity({node:process.version,platform:process.platform,arch:process.arch,products,inputs:files}),memo,{'src/output.generated.ts':memo.hash('src/output.generated.ts',true)});
 const entry=(folder:string,key:string,body:string)=>{
  const directory=resolve(gen,folder,'world',key),hash=digest(body);write(directory,hash,body);write(directory,'index.json',JSON.stringify({key,files:[{name:'world.bin',hash,bytes:Buffer.byteLength(body)}]}));return directory;
 };
 const current=entry('alpha',live,'current signed-zero bits\0'),old=entry('alpha',history,'old history bytes'),second=entry('beta',shared,'shared current bytes'),oldSecond=entry('beta',other,'old beta');
 write(gen,'served-bytes/1/memo.json','wire');write(gen,'as-raw/1/memo.bin','native');write(gen,`unknown-project/world/${history}/index.json`,'unknown');
 const read=(dryRun=true)=>trimGenerationCache(root,cache,gen,fallback,{env,dryRun});
 return {root,cache,gen,current,old,second,oldSecond,read,receipts,env,entry};
}

test('marks current sealed G keys even when no author ran, and removes only recognized obsolete steps',async()=>{
 const f=await fixture(),before=readFileSync(resolve(f.current,'index.json'));
 const report=f.read(false);expect(report.qualified,report.reason).toBe(true);expect(report.products).toBe(2);expect(report.keys).toBe(2);
 expect(report.referencedEntries).toBe(2);expect(report.historyEntries).toBe(2);expect(report.removedEntries).toBe(2);
 expect(existsSync(f.old)).toBe(false);expect(existsSync(f.oldSecond)).toBe(false);expect(existsSync(f.second)).toBe(true);
 expect(readFileSync(resolve(f.current,'index.json'))).toEqual(before);
 expect(readFileSync(resolve(f.gen,'served-bytes/1/memo.json'),'utf8')).toBe('wire');
 expect(readFileSync(resolve(f.gen,'as-raw/1/memo.bin'),'utf8')).toBe('native');
 expect(existsSync(resolve(f.gen,`unknown-project/world/${history}/index.json`))).toBe(true);
});

test('dry-run ranks actual retained and historical byte totals without deleting anything',async()=>{
 const f=await fixture(),report=f.read();expect(report.qualified,report.reason).toBe(true);expect(report.historyBytes).toBeGreaterThan(0);
 expect(report.bytes).toBe(report.retainedBytes+report.historyBytes);expect(report.files).toBe(report.retainedFiles+report.historyFiles);
 expect(report.removedBytes).toBe(0);expect(existsSync(f.old)).toBe(true);expect(existsSync(f.oldSecond)).toBe(true);
});

test('an incomplete or forged current product read receipt retains every old entry',async()=>{
 const f=await fixture(),receipt=f.receipts[0];if(receipt===undefined)throw new Error('Missing receipt');
 writeFileSync(receipt,'{}');const report=f.read(false);expect(report.qualified).toBe(false);expect(report.removedEntries).toBe(0);expect(existsSync(f.old)).toBe(true);
});

test('stale source, missing current output or missing phase evidence cannot authorize a sweep',async()=>{
 for(const mutation of ['source','output','phase']) {
  const f=await fixture();if(mutation==='source')write(f.root,'src/shards/alpha/shard.config.ts','changed');
  else if(mutation==='output')rmSync(resolve(f.root,'out/alpha'),{recursive:true});
  else rmSync(resolve(f.root,'.cache/generation-phase.json'));
  const report=f.read(false);expect(report.qualified).toBe(false);expect(report.removedEntries).toBe(0);expect(existsSync(f.old)).toBe(true);
 }
});

test('unknown or partial generation formats remain intact while referenced entries are never examined for eviction',async()=>{
 const f=await fixture();write(f.old,'index.json','{}');write(f.oldSecond,'extra.tmp','unknown in-progress file');write(f.current,'index.json','corrupt current memo');
 const report=f.read(false);expect(report.qualified).toBe(false);expect(report.unknownEntries).toBe(2);expect(report.removedEntries).toBe(0);
 expect(existsSync(f.current)).toBe(true);expect(existsSync(f.old)).toBe(true);expect(existsSync(f.oldSecond)).toBe(true);
});

test('linked cache members and expired inventory budgets keep all history',async()=>{
 const f=await fixture();symlinkSync(resolve(f.root,'package.json'),resolve(f.old,'linked'));
 expect(f.read(false)).toMatchObject({qualified:false,removedEntries:0});expect(existsSync(f.oldSecond)).toBe(true);
 rmSync(resolve(f.old,'linked'));
 expect(trimGenerationCache(f.root,f.cache,f.gen,fallback,{env:f.env,dryRun:false,seconds:0})).toMatchObject({qualified:false,removedEntries:0});
});

test('a missing optional gen root is an empty successful census, with all current admission still required',async()=>{
 const f=await fixture();rmSync(f.gen,{recursive:true});expect(f.read(false)).toMatchObject({qualified:true,reason:'no-generation-cache',removedEntries:0,bytes:0});
 write(f.root,'src/shards/beta/shard.config.ts','changed');expect(f.read()).toMatchObject({qualified:false,removedEntries:0});
});


test('one unknown project file refuses the entire sweep including otherwise eligible history',async()=>{
 const f=await fixture();write(f.gen,'alpha/future-layout/opaque.bin','unknown');
 expect(f.read(false)).toMatchObject({qualified:false,removedEntries:0});
 expect(existsSync(f.old)).toBe(true);expect(existsSync(f.oldSecond)).toBe(true);
});
