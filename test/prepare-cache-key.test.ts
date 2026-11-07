// oxlint-disable-next-line import/no-nodejs-modules -- Own complete sealed input/output fixtures in repository scratch.
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,utimesSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only owned fixture paths.
import {dirname,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the actual product receipt and index digest algorithms.
import {createHash} from 'node:crypto';
import {afterEach,expect,test} from 'vitest';
import {preparationCacheKey} from '../scripts/preparation-cache-key.mjs';
import {InputHashMemo} from '../scripts/bake-input-hashes.mjs';
import {captureProductInputs,productInputKey,productToolchainKey,publishProductInputs,recordBundle} from '../scripts/shardfile-inputs.mjs';
import {publishSourceSnapshot,sourceSnapshotIdentity} from '../scripts/source-input-proof.mjs';
import {shardfileValidationRevision} from '../scripts/shardfile-validation-revision.mjs';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const fallback=`preparation-v3-Linux-X64-node24-${'a'.repeat(40)}`;
function write(root:string,path:string,body:string):void {
  mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),body);
}
async function fixture() {
  mkdirSync('tmp',{recursive:true});const root=realpathSync(mkdtempSync(resolve('tmp/preparation-key-')));owned.push(root);
  const cacheRoot=resolve(root,'cache'),products=['alpha','beta'];
  const sourceFiles=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','scripts/source-generation-outputs.json','scripts/compiler.mjs',
    'scripts/sim-safari-ready.py','scripts/test_sim_lane.py',
    ...products.flatMap(slug=>[`src/shards/${slug}/manifest.json`,`src/shards/${slug}/shard.config.ts`])].sort();
  for(const path of sourceFiles)write(root,path,'{}');
  write(root,'scripts/compiler.mjs','export const version=1;');
  write(root,'scripts/source-generation-outputs.json',JSON.stringify({producers:{fixture:['src/output.generated.ts']}}));
  write(root,'src/output.generated.ts','export const output=1;');
  write(root,'docs/note.md','one');write(root,'.github/workflows/test.yml','one');
  const inventory=resolve(root,'inventory.json');
  const inventoryFiles=[...sourceFiles,'src/output.generated.ts','docs/note.md','.github/workflows/test.yml'];
  const saveInventory=()=>writeFileSync(inventory,JSON.stringify({root,files:inventoryFiles}));saveInventory();
  const env={WS_GENERATION_TREE_ROOT:root,WS_GENERATION_TREE_FILES:inventory},options={cacheRoot,env};
  const phase=resolve(root,'.cache/generation-phase.json');
  const publish=()=>{
    const memo=new InputHashMemo(root);memo.enableSnapshot(file=>file==='src/output.generated.ts');
    for(const path of sourceFiles)memo.hash(path);
    const identity=sourceSnapshotIdentity({node:process.version,platform:process.platform,arch:process.arch,products,inputs:[...sourceFiles].sort()});
    publishSourceSnapshot(phase,identity,memo,{'src/output.generated.ts':memo.hash('src/output.generated.ts',true)});
  };
  const admit=async(slug:string,extraInput?:string)=>{
    const source=`src/shards/${slug}/shard.config.ts`,memo=new InputHashMemo(root);
    const recipe=[slug,'--copy-runtime',`${productToolchainKey(root,memo)}:${shardfileValidationRevision(root)}`];
    const raw=resolve(root,`${slug}.receipt.json`);
    await captureProductInputs(root,raw,async()=>{readFileSync(resolve(root,source));if(extraInput!==undefined)readFileSync(resolve(root,extraInput));recordBundle({output:[]});await Promise.resolve();});
    const key=productInputKey(root,raw,recipe,memo);if(key===undefined)throw new Error('Fixture input receipt missing');
    const receipts=resolve(cacheRoot,'.inputs-v2',slug,digest(JSON.stringify(recipe)));
    publishProductInputs(receipts,raw,key);
    for(const directory of [resolve(root,'out',slug),resolve(cacheRoot,slug,key)]) {
      write(directory,'.build-key',key);write(directory,'shard.json','{}');
      write(directory,'validation.json',JSON.stringify({buildKey:key,indexHash:digest('{}')}));
      write(directory,'assets/body.bin','native\0payload');
    }
    return resolve(receipts,`${key}.json`);
  };
  const receipts=[];for(const slug of products)receipts.push(await admit(slug));publish();
  const read=()=>preparationCacheKey(root,fallback,options);
  return {root,phase,receipts,read,publish,admit,options,sourceFiles,inventoryFiles,saveInventory};
}

test('same admitted products and code retain the save key across tree-only changes',async()=>{
  const f=await fixture(),output=resolve(f.root,'out');
  const bytes=()=>readdirSync(output,{recursive:true,encoding:'utf8'}).sort().filter(file=>statSync(resolve(output,file)).isFile())
    .map(file=>[file,readFileSync(resolve(output,file)).toString('hex')]);
  const before=bytes(),first=f.read();expect(first.qualified,first.reason).toBe(true);expect(first.products).toBe(2);
  expect(first.key).toMatch(/^preparation-v4-Linux-X64-node24-[a-f0-9]{64}$/u);
  write(f.root,'docs/note.md','new words');write(f.root,'.github/workflows/test.yml','new workflow');
  const second=preparationCacheKey(f.root,fallback.replace(/a{40}$/u,'b'.repeat(40)),f.options);
  expect(second.key).toBe(first.key);expect(second.qualified).toBe(true);
  expect(bytes()).toEqual(before);
});

test('compiler and generator input changes require a current phase and then a new identity',async()=>{
  const f=await fixture(),first=f.read();
  write(f.root,'scripts/compiler.mjs','export const version=2;');
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
  f.publish();const next=f.read();expect(next.qualified,next.reason).toBe(true);expect(next.key).not.toBe(first.key);
});

test('Simulator-only changes retain transport identity only after full current source admission',async()=>{
  const f=await fixture(),first=f.read();expect(first.qualified,first.reason).toBe(true);
  for(const path of ['scripts/sim-safari-ready.py','scripts/test_sim_lane.py']) {
    write(f.root,path,'changed Simulator behavior');
    expect(f.read()).toMatchObject({qualified:false,key:fallback});
    f.publish();expect(f.read()).toEqual(first);
  }
});

test('a product that reads a Simulator file still invalidates its admitted build key',async()=>{
  const f=await fixture(),path='scripts/sim-safari-ready.py';
  await f.admit('alpha',path);const first=f.read();expect(first.qualified,first.reason).toBe(true);
  write(f.root,path,'changed real author input');f.publish();
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
  await f.admit('alpha',path);const next=f.read();expect(next.qualified,next.reason).toBe(true);
  expect(next.key).not.toBe(first.key);
});

test('identical receipts on independent runner roots derive the same transport key',async()=>{
  const first=await fixture(),second=await fixture();
  expect(first.read().qualified).toBe(true);expect(second.read().qualified).toBe(true);
  expect(first.read().key).toBe(second.read().key);
});

test('same-size source edits cannot hide behind restored timestamps',async()=>{
  const f=await fixture(),path=resolve(f.root,'scripts/compiler.mjs'),before=statSync(path);
  writeFileSync(path,'export const version=2;');utimesSync(path,before.atime,before.mtime);
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
});

test('changed product inputs miss until their actual sealed receipt and output are admitted',async()=>{
  const f=await fixture(),first=f.read();write(f.root,'src/shards/alpha/shard.config.ts','export default {changed:1};');f.publish();
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
  await f.admit('alpha');const next=f.read();expect(next.qualified,next.reason).toBe(true);expect(next.key).not.toBe(first.key);
});

test('lock changes are new generating inputs and cannot retain old product admission',async()=>{
  const f=await fixture(),first=f.read();write(f.root,'pnpm-lock.yaml','changed');f.publish();
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
  await f.admit('alpha');await f.admit('beta');
  expect(f.read().qualified).toBe(true);expect(f.read().key).not.toBe(first.key);
});

test('missing, corrupt or crossed phase evidence retains the legacy save',async()=>{
  const f=await fixture(),original=readFileSync(f.phase,'utf8');
  for(const body of ['{}',original.replace(/"seal":"[a-f0-9]{64}"/u,`"seal":"${'f'.repeat(64)}"`),original.replace(f.root,`${f.root}/foreign`)]) {
    writeFileSync(f.phase,body);expect(f.read()).toMatchObject({qualified:false,key:fallback});
  }
  rmSync(f.phase);expect(f.read()).toMatchObject({qualified:false,key:fallback});
});

test('source additions and incomplete input inventories cannot acquire an exact hit',async()=>{
  const f=await fixture();write(f.root,'scripts/new-generator.mjs','export const value=1;');
  f.inventoryFiles.push('scripts/new-generator.mjs');f.saveInventory();
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
  f.sourceFiles.push('scripts/new-generator.mjs');f.sourceFiles.sort();f.publish();expect(f.read().qualified).toBe(true);
});

test('altered product input seals, missing outputs and changed index bytes fall back',async()=>{
  const f=await fixture(),receipt=f.receipts[0];if(receipt===undefined)throw new Error('Missing receipt');
  const original=readFileSync(receipt,'utf8');writeFileSync(receipt,'{}');expect(f.read()).toMatchObject({qualified:false,key:fallback});
  writeFileSync(receipt,original);write(f.root,'out/alpha/shard.json','changed');expect(f.read()).toMatchObject({qualified:false,key:fallback});
  write(f.root,'out/alpha/shard.json','{}');rmSync(resolve(f.root,'out/alpha'),{recursive:true});
  expect(f.read()).toMatchObject({qualified:false,key:fallback});
});

test('crossed source inventories and missing generated bytes do not bypass fallback',async()=>{
  const f=await fixture();
  expect(preparationCacheKey(f.root,fallback,{...f.options,env:{...f.options.env,WS_GENERATION_TREE_ROOT:resolve(f.root,'foreign')}}))
    .toMatchObject({qualified:false,key:fallback});
  rmSync(resolve(f.root,'src/output.generated.ts'));expect(f.read()).toMatchObject({qualified:false,key:fallback});
});

test('invalid fallback keys refuse before writing an unsafe workflow output',async()=>{
  const f=await fixture();for(const key of ['',`${fallback}\nother=bad`,'preparation-v3-Linux-X64-node24-unknown'])
    expect(()=>preparationCacheKey(f.root,key,f.options)).toThrow('Invalid preparation fallback key');
});

test('an incomplete generation prune retains the legacy save while complete retention can hit',async()=>{
  const f=await fixture();
  for(const status of ['unknown','', 'refused'])expect(preparationCacheKey(f.root,fallback,{...f.options,
    env:{...f.options.env,WS_PREPARATION_PRUNE_STATUS:status}})).toMatchObject({qualified:false,key:fallback});
  expect(preparationCacheKey(f.root,fallback,{...f.options,
    env:{...f.options.env,WS_PREPARATION_PRUNE_STATUS:'complete'}})).toEqual(f.read());
});
