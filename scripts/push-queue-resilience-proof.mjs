// Real remote races and malformed queue records; every attempted upload uses its actual Git hook.
import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';

const proofStarted=performance.now();
const handoff=process.argv[2]==='handoff'||process.argv[2]==='handoff-cleanup';
/** @type {string|undefined} */let queue;
let oldCleanupLeavesWorkerHeld=false,cleanupDrained=false;
const mode=process.argv[2]??'race',directory=resolvePath(process.argv[3]??'tmp/push-queue-resilience');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo'),remote=join(work,'remote.git'),upstream=join(work,'upstream'),observed=join(work,'observed');mkdirSync(repo);
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',['-c','user.name=Queue proof','-c','user.email=proof@example.test',...args],{cwd,encoding:'utf8'}).trim();
let script=resolvePath('scripts/push-queue.mjs');
const lock=resolvePath('scripts/push-queue-lock.py'),probeEntered=join(work,'probe-entered'),probeReleased=join(work,'probe-released');
if(handoff){
 const driver=join(work,'driver');mkdirSync(driver);
 // The copied driver keeps the invoking installation even outside this repo.
 symlinkSync(resolvePath('node_modules'),join(driver,'node_modules'),'dir');
 for(const name of ['push-queue.mjs','push-queue-rebase.mjs','push-queue-lock.py'])copyFileSync(resolvePath('scripts',name),join(driver,name));
 const helper=join(driver,'push-queue-lock.py');
 // Only the fixture's process scheduling changes. The real helper still probes
 // the real flock after capture has published its queued record and exited.
 writeFileSync(helper,readFileSync(helper,'utf8').replace('import sys\n','import sys\nimport time\n').replace("if sys.argv[1] == '--held':",`if sys.argv[1] == '--held' and Path(${JSON.stringify(join(work,'probe-arm'))}).exists():\n    Path(${JSON.stringify(probeEntered)}).write_text('entered')\n    while not Path(${JSON.stringify(probeReleased)}).exists():\n        time.sleep(.005)\n\nif sys.argv[1] == '--held':`));
 script=join(driver,'push-queue.mjs');
}
/** @type {{release:()=>Promise<void>}[]} */const holders=[];
/** @param {string} path */
async function hold(path){
 const child=spawn('python3',[lock,path,process.execPath,'-e',"console.log('ready');process.stdin.resume()"],{stdio:['pipe','pipe','pipe']});
 /** @type {Promise<void>} */const ended=new Promise(resolve=>{child.once('exit',()=>{resolve();});});
 /** @type {Promise<void>} */const ready=new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',()=>{resolve();});child.once('exit',code=>{reject(new Error(`Lock holder exited before readiness: ${code}`));});});
 await ready;let released=false;
 const holder={release:async()=>{if(released)return;released=true;child.stdin.end();await ended;assert.equal(child.exitCode,0);}};holders.push(holder);return holder;
}
/** @param {string} path */
async function untilFile(path){const began=Date.now();while(!existsSync(path)){assert.ok(Date.now()-began<5000,`Missing fixture barrier: ${path}`);await new Promise(resolve=>{setTimeout(resolve,5);});}}

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
 writeFileSync(join(repo,'gate.mjs'),`import assert from'node:assert/strict';import{existsSync,readFileSync,writeFileSync,appendFileSync}from'node:fs';import{execFileSync}from'node:child_process';assert.equal(readFileSync('.prepared','utf8'),'yes');const value=Number(readFileSync('value'));assert.ok(value>0);if(value===2){const n=existsSync(${JSON.stringify(observed)})?readFileSync(${JSON.stringify(observed)},'utf8').trim().split('\\n').length+1:1;appendFileSync(${JSON.stringify(observed)},String(n)+'\\n');if(${JSON.stringify(mode==='race'||mode==='exhaust')}&&(${JSON.stringify(mode==='exhaust')}||n===1||n===3)){const root=${JSON.stringify(upstream)};writeFileSync(root+'/advance'+n,'retained');for(const args of [['add','advance'+n],['commit','--quiet','-m','advance'+n],['push','--quiet','origin','main']])execFileSync('git',['-c','user.name=Racer','-c','user.email=proof@example.test',...args],{cwd:root});}}`);
 writeFileSync(join(repo,'value'),'1');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,stdio:'pipe'});git(repo,['add','.gitignore','.githooks','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','prepare.mjs','gate.mjs','value']);git(repo,['commit','--quiet','-m','base']);git(repo,['config','core.hooksPath','.githooks']);execFileSync(process.execPath,['prepare.mjs'],{cwd:repo});git(repo,['push','--quiet','origin','main']);
 git(work,['clone','--quiet',remote,upstream]);git(upstream,['config','core.hooksPath','.githooks']);execFileSync(process.execPath,['prepare.mjs'],{cwd:upstream});
 const initial=enqueue(git(repo,['rev-parse','HEAD']));await wait(initial);queue=dirname(dirname(initial.snapshot));
 const stale='000000000-11111111',staleSnapshot=join(queue,'snapshots',stale);
 if(mode==='corrupt'){
  writeFileSync(join(queue,'000000000-00000000.json'),'{truncated');mkdirSync(staleSnapshot);
  writeFileSync(join(queue,`${stale}.json`),JSON.stringify({...initial,id:stale,snapshot:staleSnapshot,state:'capturing',owner:process.pid}));
 }
 /** @type {{release:()=>Promise<void>}|undefined} */let workerHolder;
 if(handoff)workerHolder=await hold(join(queue,'worker.lock'));
 writeFileSync(join(repo,'value'),'2');git(repo,['commit','--quiet','-m','requested value','--','value']);const requested=git(repo,['rev-parse','HEAD']),job=enqueue(requested);
 if(handoff){
  const file=join(queue,`${job.id}.json`),captureHolder=await hold(join(queue,'capture.lock'));
  writeFileSync(file,JSON.stringify({...job,state:'capturing'}));writeFileSync(join(work,'probe-arm'),'armed');
  await workerHolder?.release();await untilFile(probeEntered);
  if(mode==='handoff-cleanup'){
   // Reproduce the old holder-only teardown without removing its live files.
   for(const holder of holders)await holder.release();
   oldCleanupLeavesWorkerHeld=spawnSync('python3',[lock,'--held',join(queue,'worker.lock')]).status===0;
   assert.equal(oldCleanupLeavesWorkerHeld,true);
   throw new Error('Intentional fixture handoff interruption');
  }
  writeFileSync(`${file}.handoff`,JSON.stringify(job));renameSync(`${file}.handoff`,file);
  await captureHolder.release();writeFileSync(probeReleased,'released');
 }
 const result=await wait(job);
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
 }else if(mode==='corrupt'){
  assert.equal(JSON.parse(readFileSync(join(queue,'000000000-00000000.json'),'utf8')).state,'failed');
  assert.equal(JSON.parse(readFileSync(join(queue,`${stale}.json`),'utf8')).state,'failed');assert.equal(existsSync(staleSnapshot),false);
  assert.match(readFileSync(join(work,'receipts.log'),'utf8'),/failed/u);
 }
 console.log(JSON.stringify({mode,published:true,attempts:result.attempts,requestedPreserved:true,normalHooks:true,continuedPastBadRecords:mode==='corrupt',pidReuseCannotWedge:mode==='corrupt',completedCapturePreserved:mode==='handoff',milliseconds:performance.now()-proofStarted}));
 }
}catch(error){
 if(mode!=='handoff-cleanup'||!(error instanceof Error)||error.message!=='Intentional fixture handoff interruption')throw error;
}finally{
 // Release even if an assertion fails between probe entry and publication.
 if(handoff)writeFileSync(probeReleased,'released');
 for(const holder of holders)await holder.release();
 if(handoff&&queue!==undefined){
  const settled=await hold(join(queue,'worker.lock'));await settled.release();
  assert.equal(spawnSync('python3',[lock,'--held',join(queue,'worker.lock')]).status,1);
  cleanupDrained=true;
 }
 rmSync(work,{recursive:true,force:true});
}
if(mode==='handoff-cleanup')console.log(JSON.stringify({mode,oldCleanupLeavesWorkerHeld,cleanupDrained,milliseconds:performance.now()-proofStarted}));
