#!/usr/bin/env node
// TC26 Ring 2: actual cold byte producers, never a Mac mini cook.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {clonePaths} from './apfs-clone.mjs';
import {linkNodeModules} from './link-node-modules.mjs';

assert.equal(process.env.GITHUB_ACTIONS,'true','Cold drill runs only on the hosted Actions worker');
assert.equal(process.platform,'linux','Cold drill uses the public Linux runner');
const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??join(root,'tmp/coverage-cook-drill'));
assert.ok(out.startsWith(`${root}/tmp/`));mkdirSync(out,{recursive:true});
writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:false,results:[]}));
const work=mkdtempSync(join(out,'run-')),tree=join(work,'tree');
function run(args,timeout=10000){
  const child=spawnSync(process.execPath,args,{cwd:tree,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
  assert.equal(child.signal,null,'Timeout is not a detected cook fault');assert.equal(child.error,undefined);
  return {code:child.status,text:`${child.stdout??''}\n${child.stderr??''}`};
}
const auditCode="import{writeFileSync}from'node:fs';import{auditCook,reportCook}from'./scripts/cook-audit.ts';const a=await auditCook(process.argv[1]);reportCook(a,process.argv[2]);writeFileSync(process.argv[3],JSON.stringify(a));";
function audit(receipt,name,baseline=join(tree,'test/pins/cooked.json')){
  const file=join(work,`${name}.json`),result=run(['--import','./scripts/bake-loader.mjs','--experimental-transform-types','--input-type=module','--eval',auditCode,receipt,baseline,file]);
  writeFileSync(join(out,`${name}.log`),result.text);
  return {...result,file,value:result.code===0?JSON.parse(readFileSync(file,'utf8')):undefined};
}
function cold(name){
  const dir=join(work,name),result=run(['scripts/ring-cook.mjs',`--out=${dir}`,'--only=template','--build=tc26-cold'],180000);
  writeFileSync(join(out,`${name}.log`),result.text);assert.equal(result.code,0,`${name}: actual cold worker must succeed`);
  return join(dir,'receipt.json');
}
function rawBytes(receipt){
  const value=JSON.parse(readFileSync(receipt,'utf8'));
  return [...new Set(value.indexes.flatMap(index=>index.keys).filter(key=>key.endsWith('.pack.br')))]
    .reduce((sum,key)=>sum+brotliDecompressSync(readFileSync(join(value.store,key))).length,0);
}
try{
  mkdirSync(tree);const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  execFileSync('tar',['-x','-C',tree],{input:execFileSync('git',['archive',sha],{cwd:root,maxBuffer:512*1024*1024})});
  linkNodeModules(root,tree);rmSync(join(tree,'public'),{recursive:true,force:true});
  clonePaths([[join(root,'out'),join(tree,'out')],[join(root,'public'),join(tree,'public')]]);
  const baselineReceipt=cold('baseline-cold'),baseline=audit(baselineReceipt,'baseline-audit');assert.equal(baseline.code,0);
  const source=join(tree,'src/cook/game/spawnParts.ts'),original=readFileSync(source,'utf8');
  const find='const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN;';
  assert.equal(original.split(find).length-1,1,'Cook alignment plant must have one site');
  let changedReceipt,changed;
  try{
    writeFileSync(source,original.replace(find,'const align = (at: number): number => Math.ceil(at / SPAWN_PART_ALIGN) * SPAWN_PART_ALIGN + SPAWN_PART_ALIGN;'));
    changedReceipt=cold('changed-cold');changed=audit(changedReceipt,'changed-audit',baseline.file);assert.equal(changed.code,0);
  }finally{writeFileSync(source,original);}
  const hashes=value=>new Set(value.products.flatMap(product=>product.manifests.flatMap(manifest=>manifest.parts.map(part=>part.hash))));
  const before=hashes(baseline.value),after=hashes(changed.value),moved=[...after].filter(hash=>!before.has(hash)).length;
  assert.notEqual(changed.value.cook.revision,baseline.value.cook.revision);
  assert.ok(moved>0&&rawBytes(changedReceipt)>rawBytes(baselineReceipt),'Actual grown parts must be reported');
  assert.match(changed.text,/parts \+[1-9]/u,'Production cook-diff must name changed parts');
  const healed=audit(cold('healed-cold'),'healed-audit',baseline.file);assert.equal(healed.code,0);
  assert.deepEqual([...hashes(healed.value)].sort(),[...before].sort(),'Healed cold bytes must equal the original cold cook');
  let stale;
  try{writeFileSync(source,`${original}\n// TC26 changed byte producer; old result cannot qualify\n`);stale=audit(baselineReceipt,'stale-audit');}
  finally{writeFileSync(source,original);}
  assert.equal(stale.code,1);assert.match(stale.text,/Cook receipt source revision is stale/u);
  assert.equal(audit(baselineReceipt,'stale-healed-audit').code,0);
  writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:true,sha,results:[
    {id:'cook-change',owner:'engine:src/cook/game/spawnParts.ts',moved,baselineRaw:rawBytes(baselineReceipt),changedRaw:rawBytes(changedReceipt),healed:true},
    {id:'stale-pack',owner:'engine:scripts/cook-audit.ts',refused:true,healed:true},
  ]},null,2));
  console.log('Actual cook change, production part diff, cold healing and stale result refusal pass');
}finally{rmSync(work,{recursive:true,force:true});}
