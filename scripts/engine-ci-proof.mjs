// Real runner budget refusal, without a minute-long synthetic sleep in the suite.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {linkNodeModules} from './link-node-modules.mjs';

const root=process.cwd(),out=resolve(process.argv[2]??'tmp/engine-ci-budget-proof');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),report=join(work,'results.json');
const importing=process.argv.includes('--import'),cases=process.argv.includes('--cases'),collection=process.argv.includes('--collection'),setup=process.argv.includes('--setup');
const boundary=cases||collection||setup;
try{
  linkNodeModules(root,work);
  writeFileSync(join(work,'package.json'),JSON.stringify({type:'module',private:true}));
  writeFileSync(join(work,'actual.test.mjs'),collection?"import './not-present.mjs';":setup?"import{test,beforeAll}from'vitest';beforeAll(()=>{throw new Error('intentional setup failure');});test('never run',()=>{});":cases?"import{test,describe}from'vitest';test('passed',()=>{});describe('nested',()=>{test('failed',()=>{throw new Error('intentional case failure');});test.skip('skipped',()=>{});test.todo('todo');});test('unhandled',async()=>{setTimeout(()=>{void Promise.reject(new Error('intentional unhandled rejection'));},0);await new Promise(resolve=>setTimeout(resolve,15));});":importing?"import{test}from'vitest';await new Promise(resolve=>setTimeout(resolve,60));test('real import',()=>{});":"import{test}from'vitest';test('real timer',async()=>{await new Promise(resolve=>{setTimeout(resolve,25);});});");
  const reporter=pathToFileURL(resolve('scripts/engine-ci-budget.ts')).href;
  writeFileSync(join(work,'vitest.config.mjs'),`export default {test:{cache:false,maxWorkers:1,include:['actual.test.mjs'],outputFile:{json:${JSON.stringify(join(work,'vitest.json'))}},reporters:[['${reporter}',{maxMs:${boundary?60000:importing?20:1}}],...${JSON.stringify(boundary?['json']:[])}]}};`);
  const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',join(work,'vitest.config.mjs')],{
    cwd:work,env:{...process.env,WS_CI_TIMINGS:report,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile-cache')},encoding:'utf8',timeout:10000});
  if(result.error)throw result.error;
  assert.notEqual(result.status,0,boundary?'Real failed/unhandled cases must fail the runner':'An actual file over the configured budget must fail the runner');
  /** @type {{schema:string,errorCount:number,files:{state:string,errorCount:number,durationMs:number,caseCounts:{total:number,passed:number,failed:number,skipped:number,pending:number},cases:{name:string,state:string,mode:string}[]}[]}} */
  const actual=JSON.parse(readFileSync(report,'utf8'));assert.equal(actual.files.length,1);assert.equal(actual.files[0].state,boundary?'failed':'passed');assert.ok(actual.files[0].durationMs>1);
  if(cases){
    /** @type {{testResults:{assertionResults:{status:string,fullName:string,ancestorTitles:string[],title:string}[]}[]}} */
    const canonical=JSON.parse(readFileSync(join(work,'vitest.json'),'utf8'));
    assert.equal(actual.schema,'engine-ci-budget/2');assert.equal(actual.errorCount,1);
    assert.deepEqual(actual.files[0].caseCounts,{total:5,passed:2,failed:1,skipped:2,pending:0});
    const assertions=canonical.testResults.flatMap(row=>row.assertionResults);
    assert.equal(assertions.length,5);
    assert.equal(assertions.filter(row=>row.status==='passed').length,actual.files[0].caseCounts.passed);
    assert.equal(assertions.filter(row=>row.status==='failed').length,actual.files[0].caseCounts.failed);
    assert.equal(assertions.filter(row=>row.status==='skipped'||row.status==='todo').length,actual.files[0].caseCounts.skipped);
    assert.equal(actual.files[0].errorCount,0);
    assert.deepEqual(actual.files[0].cases,assertions.map(row=>({name:[...row.ancestorTitles,row.title].join(' > '),state:row.status==='todo'?'skipped':row.status,mode:row.status==='todo'?'todo':row.status==='skipped'?'skip':'run'})));
    assert.equal(Object.entries(actual.files[0].caseCounts).filter(([key])=>key!=='total').reduce((sum,[,value])=>sum+value,0),actual.files[0].cases.length);
  }
  if(collection||setup){assert.equal(actual.schema,'engine-ci-budget/2');assert.ok(actual.files[0].errorCount>0);if(collection)assert.deepEqual(actual.files[0].caseCounts,{total:0,passed:0,failed:0,skipped:0,pending:0});if(setup){assert.deepEqual(actual.files[0].caseCounts,{total:1,passed:0,failed:0,skipped:1,pending:0});assert.deepEqual(actual.files[0].cases,[{name:'never run',state:'skipped',mode:'run'}]);}}
  console.log(JSON.stringify({realFilePassed:!boundary,budgetRefused:!boundary,caseCounts:boundary?actual.files[0].caseCounts:undefined,errorCount:actual.errorCount,moduleErrorCount:actual.files[0].errorCount,cases:boundary?actual.files[0].cases:undefined,ms:actual.files[0].durationMs,exit:result.status}));
}finally{rmSync(work,{recursive:true,force:true});}
