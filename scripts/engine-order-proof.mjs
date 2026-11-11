// Real Vitest dispatch in a tiny git repository; no test implementation is mirrored.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {linkNodeModules} from './link-node-modules.mjs';

const directory=resolve(process.argv[2]??'tmp/engine-order-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),order=join(work,'order.txt');
try{
  linkNodeModules(process.cwd(),work);writeFileSync(join(work,'package.json'),'{"type":"module"}');
  for(const name of ['a','b','c'])writeFileSync(join(work,`${name}.test.mjs`),`${name==='a'?`/*${' '.repeat(2000)}*/`:''}import{test}from'vitest';import{appendFileSync}from'node:fs';test('${name}',()=>appendFileSync(${JSON.stringify(order)},'${name}'));`);
  /** @param {string[]} args */
  const git=args=>execFileSync('git',['-c','user.name=Ordering proof','-c','user.email=proof@example.test',...args],{cwd:work,encoding:'utf8'}).trim();
  git(['init','--quiet']);git(['add','package.json','a.test.mjs','b.test.mjs','c.test.mjs']);git(['commit','--quiet','-m','fixture']);
  const files=['b.test.mjs','a.test.mjs'];
  const plan={version:1,sha:git(['rev-parse','HEAD']),ring:'full',inventoryHash:createHash('sha256').update(JSON.stringify([...files].sort())).digest('hex'),
    files,unknown:[],count:1,setupSeconds:40,factor:1,curve:[],shards:[{index:1,native:files,ordinary:[],expectedSeconds:41}]};
  const filename=join(work,'plan.json');writeFileSync(filename,JSON.stringify(plan));
  const sequencer=pathToFileURL(resolve('scripts/engine-ci-sequencer.ts')).href;
  const config=join(work,'vitest.config.mjs');
  /** @param {boolean} packed @param {boolean} [extra] */
  const run=(packed,extra=false)=>{
    writeFileSync(order,'');
    writeFileSync(config,`${packed?`import{EngineCISequencer}from'${sequencer}';`:''}export default {test:{cache:false,maxWorkers:1,include:${JSON.stringify(extra?['*.test.mjs']:files)},${packed?'sequence:{sequencer:EngineCISequencer},':''}}};`);
    return spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',config],{
      cwd:work,encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile'),WS_CI_PLAN:filename,WS_CI_SHARD:'1',WS_CI_PHASE:'native'}});
  };
  const baseline=run(false);assert.equal(baseline.status,0,baseline.stderr);const before=readFileSync(order,'utf8');
  const packed=run(true);assert.equal(packed.status,0,packed.stderr);assert.equal(readFileSync(order,'utf8'),'ba');
  const hostile=run(true,true);assert.notEqual(hostile.status,0);assert.match(hostile.stderr,/Unplanned execution/u);
  // The push profile keeps the full inventory, including unmeasured files.
  mkdirSync(join(work,'timings'));writeFileSync(join(work,'timings/timings.json'),JSON.stringify({version:1,run:'1',sha:'a'.repeat(40),measuredAt:0,full:{'a.test.mjs':1,'b.test.mjs':5},ring1:{}}));
  const pushSequencer=pathToFileURL(resolve('scripts/push-duration-sequencer.ts')).href;
  writeFileSync(order,'');writeFileSync(config,`import{PushDurationSequencer}from'${pushSequencer}';export default{test:{cache:false,maxWorkers:1,include:['*.test.mjs'],sequence:{sequencer:PushDurationSequencer}}};`);
  const push=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',config],{cwd:work,encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile'),WS_TIMINGS_DIR:join(work,'timings')}});
  assert.equal(push.status,0,push.stdout+push.stderr);assert.equal(readFileSync(order,'utf8'),'cba');
  console.log(JSON.stringify({baseline:before,planned:'ba',actual:'ba',unplannedRefused:true,pushInventory:3,pushUnmeasuredThenLongest:'cba'}));
}finally{rmSync(work,{recursive:true,force:true});}
