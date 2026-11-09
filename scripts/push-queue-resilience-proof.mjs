// Real remote races and malformed queue records; every attempted upload uses its actual Git hook.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';

const mode=process.argv[2]??'race',directory=resolvePath(process.argv[3]??'tmp/push-queue-resilience');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo'),remote=join(work,'remote.git'),upstream=join(work,'upstream'),observed=join(work,'observed');mkdirSync(repo);
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',['-c','user.name=Queue proof','-c','user.email=proof@example.test',...args],{cwd,encoding:'utf8'}).trim();
const script=resolvePath('scripts/push-queue.mjs');
/** @param {string} sha */
const enqueue=sha=>JSON.parse(execFileSync(process.execPath,[script,'enqueue',repo,`--commit=${sha}`,`--root=${join(work,'queue')}`],{env:{...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log')},encoding:'utf8'}));
/** @param {{id:string,snapshot:string}} job */
const wait=async job=>{
 const file=join(dirname(dirname(job.snapshot)),`${job.id}.json`),began=Date.now();
 let row;
 while(Date.now()-began<8000){row=JSON.parse(readFileSync(file,'utf8'));if(['pushed','failed','already-published'].includes(row.state)&&!existsSync(job.snapshot))return row;await new Promise(resolve=>{setTimeout(resolve,10);});}
 return row;
};
try{
 git(work,['init','--quiet','--bare','--initial-branch=main',remote]);git(repo,['init','--quiet','--initial-branch=main']);git(repo,['remote','add','origin',remote]);mkdirSync(join(repo,'.githooks'));
 writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
 writeFileSync(join(repo,'package.json'),'{"name":"resilience-proof","version":"1.0.0","private":true,"type":"module","scripts":{"tools:install":"node prepare.mjs"}}');writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');
 writeFileSync(join(repo,'.gitignore'),'node_modules/\n.prepared\n');writeFileSync(join(repo,'prepare.mjs'),"import{writeFileSync}from'node:fs';writeFileSync('.prepared','yes');");
 writeFileSync(join(repo,'gate.mjs'),`import assert from'node:assert/strict';import{existsSync,readFileSync,writeFileSync,appendFileSync}from'node:fs';import{execFileSync}from'node:child_process';assert.equal(readFileSync('.prepared','utf8'),'yes');const value=Number(readFileSync('value'));assert.ok(value>0);if(value===2){const n=existsSync(${JSON.stringify(observed)})?readFileSync(${JSON.stringify(observed)},'utf8').trim().split('\\n').length+1:1;appendFileSync(${JSON.stringify(observed)},String(n)+'\\n');if(${JSON.stringify(mode!=='corrupt')}&&(${JSON.stringify(mode==='exhaust')}||n===1||n===3)){const root=${JSON.stringify(upstream)};writeFileSync(root+'/advance'+n,'retained');for(const args of [['add','advance'+n],['commit','--quiet','-m','advance'+n],['push','--quiet','origin','main']])execFileSync('git',['-c','user.name=Racer','-c','user.email=proof@example.test',...args],{cwd:root});}}`);
 writeFileSync(join(repo,'value'),'1');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,stdio:'pipe'});git(repo,['add','.gitignore','.githooks','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','prepare.mjs','gate.mjs','value']);git(repo,['commit','--quiet','-m','base']);git(repo,['config','core.hooksPath','.githooks']);execFileSync(process.execPath,['prepare.mjs'],{cwd:repo});git(repo,['push','--quiet','origin','main']);
 git(work,['clone','--quiet',remote,upstream]);git(upstream,['config','core.hooksPath','.githooks']);execFileSync(process.execPath,['prepare.mjs'],{cwd:upstream});
 const initial=enqueue(git(repo,['rev-parse','HEAD']));await wait(initial);const queue=dirname(dirname(initial.snapshot));
 const stale='000000000-11111111',staleSnapshot=join(queue,'snapshots',stale);
 if(mode==='corrupt'){
  writeFileSync(join(queue,'000000000-00000000.json'),'{truncated');mkdirSync(staleSnapshot);
  writeFileSync(join(queue,`${stale}.json`),JSON.stringify({...initial,id:stale,snapshot:staleSnapshot,state:'capturing',owner:process.pid}));
 }
 writeFileSync(join(repo,'value'),'2');git(repo,['commit','--quiet','-m','requested value','--','value']);const requested=git(repo,['rev-parse','HEAD']),job=enqueue(requested),result=await wait(job);
 if(mode==='exhaust'){
  assert.equal(result?.state,'failed');assert.equal(result.attempts,3);assert.match(result.error,/retry budget exhausted/u);
  assert.equal(git(remote,['show','main:value']),'1');assert.match(readFileSync(join(work,'receipts.log'),'utf8'),/failed.*retry budget exhausted/u);
  console.log(JSON.stringify({mode,boundedAttempts:3,unprovedTreeNotPublished:true,terminalFailureReported:true}));
 }else{
 if(result?.state!=='pushed')console.error(readFileSync(join(queue,'worker.log'),'utf8').slice(-9000));
 assert.equal(result?.state,'pushed',JSON.stringify(result));assert.equal(git(remote,['rev-parse','refs/heads/main']),result.sha);assert.equal(git(remote,['show','main:value']),'2');
 if(mode==='race'){
  assert.equal(result.attempts,3);assert.equal(result.requestedSha,requested);assert.notEqual(result.sha,requested);
  assert.equal(git(remote,['show','main:advance1']),'retained');assert.equal(git(remote,['show','main:advance3']),'retained');
 }else{
  assert.equal(JSON.parse(readFileSync(join(queue,'000000000-00000000.json'),'utf8')).state,'failed');
  assert.equal(JSON.parse(readFileSync(join(queue,`${stale}.json`),'utf8')).state,'failed');assert.equal(existsSync(staleSnapshot),false);
  assert.match(readFileSync(join(work,'receipts.log'),'utf8'),/failed/u);
 }
 console.log(JSON.stringify({mode,published:true,attempts:result.attempts,requestedPreserved:true,normalHooks:true,continuedPastBadRecords:mode==='corrupt',pidReuseCannotWedge:mode==='corrupt'}));
 }
}finally{rmSync(work,{recursive:true,force:true});}
