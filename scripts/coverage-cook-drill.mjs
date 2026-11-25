#!/usr/bin/env node
// TC26 Ring 2: actual cold byte producers, never a Mac mini cook.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {clonePaths} from './apfs-clone.mjs';
import {runCommitJobs} from './precommit-jobs.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true','Cold drill runs only on the hosted Actions worker');
assert.equal(process.platform,'linux','Cold drill uses the public Linux runner');
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??join(root,'tmp/coverage-cook-drill'));
assert.ok(out.startsWith(`${root}/tmp/`));mkdirSync(out,{recursive:true});
writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:false,results:[]}));
const work=mkdtempSync(join(out,'run-')),tree=join(work,'tree');
const controller=new AbortController(),cancel=()=>controller.abort(),environment={...process.env};
process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
/** @param {string[]} args */
async function run(args,timeout=10000){
  const [child]=await runCommitJobs(tree,[{name:'coverage cold owner',command:[process.execPath,...args]}],performance.now()+timeout,environment,controller.signal);
  assert.ok(child&&!child.timedOut&&!child.cancelled,'Timeout or cancellation is not a detected cook fault');
  return {code:child.code,text:child.output};
}
const auditCode="import{writeFileSync}from'node:fs';import{auditCook,reportCook}from'./scripts/cook-audit.ts';const a=await auditCook(process.argv[1]);reportCook(a,process.argv[2]);writeFileSync(process.argv[3],JSON.stringify(a));";
/** @param {string} receipt @param {string} name */
async function audit(receipt,name,baseline=join(tree,'test/pins/cooked.json')){
  const file=join(work,`${name}.json`),result=await run(['--import','./scripts/bake-loader.mjs','--input-type=module','--eval',auditCode,receipt,baseline,file]);
  writeFileSync(join(out,`${name}.log`),result.text);
  return {...result,file,value:result.code===0?/** @type {import('./cook-audit').CookAudit} */(JSON.parse(readFileSync(file,'utf8'))):undefined};
}
/** @param {string} name */
async function cold(name){
  const dir=join(work,name),result=await run(['scripts/ring-cook.mjs',`--out=${dir}`,'--only=template','--build=tc26-cold'],180000);
  writeFileSync(join(out,`${name}.log`),result.text);assert.equal(result.code,0,`${name}: actual cold worker must succeed`);
  return join(dir,'receipt.json');
}
/** @param {string} receipt */
function rawBytes(receipt){
  const value=/** @type {{store:string,indexes:{keys:string[]}[]}} */(JSON.parse(readFileSync(receipt,'utf8')));
  return [...new Set(value.indexes.flatMap(index=>index.keys).filter(key=>key.endsWith('.pack.br')))]
    .reduce((sum,key)=>sum+brotliDecompressSync(readFileSync(join(value.store,key))).length,0);
}
try{
  mkdirSync(tree);const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  execFileSync('tar',['-x','-C',tree],{input:execFileSync('git',['archive',sha],{cwd:root,maxBuffer:512*1024*1024})});
  const inventory=join(work,'source-files.json');
  writeFileSync(inventory,JSON.stringify({root:realpathSync(tree),files:execFileSync('git',['ls-tree','-r','--name-only','-z',sha],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean)}));
  environment.WS_GENERATION_TREE_FILES=inventory;environment.WS_GENERATION_TREE_ROOT=realpathSync(tree);
  // The permissioned cook needs links wholly inside this private installation;
  // links through the outer checkout cannot qualify a frozen source export.
  execFileSync('git',['init','-q'],{cwd:tree});
  writeFileSync(join(out,'install.log'),execFileSync('pnpm',['install','--offline','--frozen-lockfile','--virtual-store-dir=node_modules/.pnpm'],{cwd:tree,env:environment,timeout:120000,maxBuffer:4*1024*1024}));
  rmSync(join(tree,'public'),{recursive:true,force:true});
  clonePaths([[join(root,'out'),join(tree,'out')],[join(root,'public'),join(tree,'public')]]);
  const baselineReceipt=await cold('baseline-cold'),baseline=await audit(baselineReceipt,'baseline-audit');assert.equal(baseline.code,0);
  const source=join(tree,'src/cook/game/spawnParts.ts'),original=readFileSync(source,'utf8');
  const find='const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN;';
  assert.equal(original.split(find).length-1,1,'Cook alignment plant must have one site');
  let changedReceipt,changed;
  try{
    writeFileSync(source,original.replace(find,'const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN + SPAWN_PART_ALIGN;'));
    changedReceipt=await cold('changed-cold');changed=await audit(changedReceipt,'changed-audit',baseline.file);assert.equal(changed.code,0);
  }finally{writeFileSync(source,original);}
  /** @param {import('./cook-audit').CookAudit} value */
  const hashes=value=>new Set(value.products.flatMap(product=>product.manifests.flatMap(manifest=>manifest.parts.map(part=>part.hash))));
  assert.ok(baseline.value&&changed.value);
  const before=hashes(baseline.value),after=hashes(changed.value),moved=[...after].filter(hash=>!before.has(hash)).length;
  assert.notEqual(changed.value.cook.revision,baseline.value.cook.revision);
  assert.ok(moved>0&&rawBytes(changedReceipt)>rawBytes(baselineReceipt),'Actual grown parts must be reported');
  assert.match(changed.text,/parts \+[1-9]/u,'Production cook-diff must name changed parts');
  const healed=await audit(await cold('healed-cold'),'healed-audit',baseline.file);assert.equal(healed.code,0);
  assert.ok(healed.value);
  assert.deepEqual([...hashes(healed.value)].sort(),[...before].sort(),'Healed cold bytes must equal the original cold cook');
  let stale;
  try{writeFileSync(source,`${original}\n// TC26 changed byte producer; old result cannot qualify\n`);stale=await audit(baselineReceipt,'stale-audit');}
  finally{writeFileSync(source,original);}
  assert.equal(stale.code,1);assert.match(stale.text,/Cook receipt source revision is stale/u);
  assert.equal((await audit(baselineReceipt,'stale-healed-audit')).code,0);
  writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:true,sha,results:[
    {id:'cook-change',owner:'engine:src/cook/game/spawnParts.ts',moved,baselineRaw:rawBytes(baselineReceipt),changedRaw:rawBytes(changedReceipt),healed:true},
    {id:'stale-pack',owner:'engine:scripts/cook-audit.ts',refused:true,healed:true},
  ]},null,2));
  console.log('Actual cook change, production part diff, cold healing and stale result refusal pass');
}finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);rmSync(work,{recursive:true,force:true});}
