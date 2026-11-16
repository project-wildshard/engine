#!/usr/bin/env node
// TC26: one fault at a time in an owned frozen export, never the checkout or
// pnpm store. Positive and healed controls must pass the same actual contract.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {clonePaths} from './apfs-clone.mjs';
import {linkNodeModules} from './link-node-modules.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(process.argv[2]??join(root,'tmp/coverage-fire-drill'));
assert.ok(out.startsWith(`${root}/tmp/`),'Drill output must stay in this repository tmp/');
mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),tree=join(work,'tree');mkdirSync(tree);
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const source=execFileSync('git',['archive','HEAD'],{cwd:root,maxBuffer:512*1024*1024});
/** @type {{id:string,ring:number,owner:string,file:string,find:string,plant:string,reason:RegExp}[]} */
const faults=[
  {id:'host',ring:1,owner:'engine:src/server/game/riding/nativeTaming.ts',file:'src/server/game/riding/nativeTaming.ts',
    find:'    originalUpdate(dt);',plant:'    void dt; // TC26 planted sleeping taming owner',reason:/TC26_HOST_PROGRESS/u},
  {id:'door',ring:1,owner:'engine:src/server/game/plugin/simulation.ts',file:'src/server/game/plugin/simulation.ts',
    find:'      if (decisions?.interact(id) === true) return true;',
    plant:"      if (row.scene === 'template.door.toggle') return true; // TC26 dropped actual door script\n      if (decisions?.interact(id) === true) return true;",reason:/TC26_DOOR_OPEN/u},
  {id:'export',ring:3,owner:'engine:package.json',file:'package.json',find:'',plant:'',reason:/ERR_PACKAGE_PATH_NOT_EXPORTED/u},
  {id:'format',ring:1,owner:'shardfile:src/format/shardSchema.ts',file:'node_modules/@wildshard/format/src/format/shardSchema.ts',
    find:'  version: v.literal(SHARDFILE_VERSION),',plant:'  version: v.literal(SHARDFILE_VERSION),\n  tc26Required: v.string(),',reason:/tc26Required/u},
];
/** @type {unknown[]} */const results=[];
/** @param {string} id */
function run(id){
  const began=performance.now();
  const child=spawnSync(process.execPath,['--import','./scripts/bake-loader.mjs','--experimental-transform-types','--test','--test-reporter=tap',`--test-name-pattern=^TC26 ${id}$`,'test/ci/coverage-fire-drill.proof.mjs'],
    {cwd:tree,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,env:{...process.env,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile')}});
  const text=`${child.stdout??''}\n${child.stderr??''}`;
  assert.equal(child.signal,null,`${id}: a timeout or signal is not a detected gameplay fault`);
  assert.equal(child.error,undefined,`${id}: a process error is not a detected gameplay fault`);
  return {code:child.status,ms:Math.round(performance.now()-began),text};
}
try{
  execFileSync('tar',['-x','-C',tree],{input:source});linkNodeModules(root,tree);
  // Only this export's format alias is replaced. The installed pnpm package
  // and immutable pin cache remain untouched, including during the format plant.
  const format=join(tree,'node_modules/@wildshard/format');unlinkSync(format);
  mkdirSync(join(tree,'public/assets/physics'),{recursive:true});
  clonePaths([[realpathSync(join(root,'node_modules/@wildshard/format')),format],
    [join(root,'out'),join(tree,'out')],
    [join(root,'public/assets/physics/rapier.wasm'),join(tree,'public/assets/physics/rapier.wasm')]]);
  for(const fault of faults){
    const before=run(fault.id);
    writeFileSync(join(out,`${fault.id}-baseline.log`),before.text);
    assert.equal(before.code,0,`${fault.id}: positive control must pass; see baseline log`);
    const path=join(tree,fault.file),original=readFileSync(path,'utf8');
    let planted;
    if(fault.id==='export'){
      const pkg=JSON.parse(original);assert.ok(Object.hasOwn(pkg.exports,'./host/author'));
      delete pkg.exports['./host/author'];planted=JSON.stringify(pkg);
    }else{
      assert.equal(original.split(fault.find).length-1,1,`${fault.id}: exact plant site changed`);
      planted=original.replace(fault.find,fault.plant);
    }
    let red;
    try{writeFileSync(path,planted);red=run(fault.id);}
    finally{writeFileSync(path,original);}
    writeFileSync(join(out,`${fault.id}-planted.log`),red.text);
    assert.equal(red.code,1,`${fault.id}: exactly one case must fail`);
    assert.match(red.text,fault.reason,`${fault.id}: a different failure cannot qualify this fault`);
    assert.match(red.text,/# fail 1\b/u);
    const healed=run(fault.id);
    writeFileSync(join(out,`${fault.id}-healed.log`),healed.text);
    assert.equal(healed.code,0,`${fault.id}: removing the fault must heal the actual contract`);
    results.push({id:fault.id,ring:fault.ring,owner:fault.owner,baselineMs:before.ms,plantedMs:red.ms,healedMs:healed.ms});
    writeFileSync(join(out,'receipt.json'),JSON.stringify({sha,results},null,2));
    console.log(`TC26 ${fault.id}: green, expected red, healed; Ring ${fault.ring}; ${fault.owner}`);
  }
}finally{rmSync(work,{recursive:true,force:true});}
