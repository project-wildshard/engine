// Real runner budget refusal, without a minute-long synthetic sleep in the suite.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {linkNodeModules} from './link-node-modules.mjs';

const root=process.cwd(),out=resolve(process.argv[2]??'tmp/engine-ci-budget-proof');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),report=join(work,'results.json');
const importing=process.argv.includes('--import');
try{
  linkNodeModules(root,work);
  writeFileSync(join(work,'package.json'),JSON.stringify({type:'module',private:true}));
  writeFileSync(join(work,'actual.test.mjs'),importing?"import{test}from'vitest';await new Promise(resolve=>setTimeout(resolve,60));test('real import',()=>{});":"import{test}from'vitest';test('real timer',async()=>{await new Promise(resolve=>{setTimeout(resolve,25);});});");
  const reporter=pathToFileURL(resolve('scripts/engine-ci-budget.ts')).href;
  writeFileSync(join(work,'vitest.config.mjs'),`export default {test:{cache:false,maxWorkers:1,include:['actual.test.mjs'],reporters:[['${reporter}',{maxMs:${importing?20:1}}]]}};`);
  const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',join(work,'vitest.config.mjs')],{
    cwd:work,env:{...process.env,WS_CI_TIMINGS:report,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile-cache')},encoding:'utf8',timeout:10000});
  if(result.error)throw result.error;
  assert.notEqual(result.status,0,'An actual file over the configured budget must fail the runner');
  const actual=JSON.parse(readFileSync(report,'utf8'));assert.equal(actual.files.length,1);assert.equal(actual.files[0].state,'passed');assert.ok(actual.files[0].durationMs>1);
  console.log(JSON.stringify({realFilePassed:true,budgetRefused:true,ms:actual.files[0].durationMs,exit:result.status}));
}finally{rmSync(work,{recursive:true,force:true});}
