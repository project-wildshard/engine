// Four real FIFO captures share one complete gate; a red independent job is isolated.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';

const directory=resolvePath(process.argv[2]??'tmp/push-queue-batch-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),script=resolvePath('scripts/push-queue.mjs'),lock=resolvePath('scripts/push-queue-lock.py'),began=performance.now();
const red=process.argv.includes('--red');
const changed=process.argv.includes('--changed-snapshot'),rejected=red||changed;
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',['-c','user.name=Batch proof','-c','user.email=proof@example.test',...args],{cwd,encoding:'utf8'}).trim();
try{
 const repo=join(work,'seed'),remote=join(work,'remote.git'),queue=join(work,'queue'),observed=join(work,'gates.jsonl');mkdirSync(repo);
 git(repo,['init','--quiet','--initial-branch=main']);git(repo,['init','--quiet','--bare','--initial-branch=main',remote]);git(repo,['remote','add','origin',remote]);mkdirSync(join(repo,'.githooks'));
 writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.cjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
 writeFileSync(join(repo,'gate.cjs'),`const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');const tree=cp.execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),cache='.git/fixture-full-proof';if(fs.existsSync(cache)&&fs.readFileSync(cache,'utf8')===tree)process.exit(0);const files=fs.readdirSync('.').filter(f=>/^lane-[1-4]\\.json$/.test(f)).sort(),values=files.map(f=>JSON.parse(fs.readFileSync(f)).value);fs.appendFileSync(${JSON.stringify(observed)},JSON.stringify({tree,files,values})+'\\n');assert.ok(values.every(v=>v>0),'actual bad lane assertion');fs.writeFileSync(cache,tree);`);
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'queue-batch-proof',private:true,version:'1.0.0'}));writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');writeFileSync(join(repo,'.gitignore'),'node_modules/\n');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,stdio:'pipe'});
 git(repo,['add','.githooks/pre-push','gate.cjs','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','.gitignore']);git(repo,['commit','--quiet','-m','base']);git(repo,['push','--quiet','origin','main']);
 // Obtain the queue's actual public snapshot handle, then hold its real OS
 // worker lock. No guessed path/hash or scheduler timing makes jobs "waiting".
 const warm=JSON.parse(execFileSync(process.execPath,[script,'enqueue',repo,'--check-only',`--root=${queue}`],{env:{...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log')},encoding:'utf8'}));
 const queueDir=dirname(dirname(warm.snapshot));let warmState='';const warming=Date.now();
 while(Date.now()-warming<3000){warmState=JSON.parse(readFileSync(join(queueDir,`${warm.id}.json`),'utf8')).state;if(warmState==='checked'&&!existsSync(warm.snapshot))break;await new Promise(resolve=>{setTimeout(resolve,10);});}
 assert.equal(warmState,'checked');assert.ok(!existsSync(warm.snapshot));writeFileSync(observed,'');
 const holder=spawn('python3',[lock,join(queueDir,'worker.lock'),process.execPath,'-e',"console.log('ready');process.stdin.resume()"],{stdio:['pipe','pipe','pipe']});const holderState={ready:false};holder.stdout.on('data',()=>{holderState.ready=true;});const ended=new Promise(resolve=>{holder.once('exit',resolve);});
 /** @type {{id:string,snapshot:string,sha:string}[]} */const jobs=[];
 try{
  const wait=Date.now();while(!holderState.ready&&Date.now()-wait<2000)await new Promise(resolve=>{setTimeout(resolve,5);});assert.ok(holderState.ready);
  for(let i=1;i<=4;i++){
   const source=join(work,`lane-${i}`);execFileSync('git',['clone','--quiet',remote,source]);writeFileSync(join(source,`lane-${i}.json`),JSON.stringify({value:red&&i===2?-1:i}));git(source,['add',`lane-${i}.json`]);git(source,['commit','--quiet','-m',`lane ${i}`]);
   jobs.push(JSON.parse(execFileSync(process.execPath,[script,'enqueue',source,`--root=${queue}`],{env:{...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log'),WS_LANE_NAME:`proof-${i}`},encoding:'utf8'})));
  }
  assert.ok(jobs.every(job=>JSON.parse(readFileSync(join(queueDir,`${job.id}.json`),'utf8')).state==='queued'),'All four jobs must really be waiting before the worker starts');
  if(changed){const snapshot=jobs[1].snapshot;writeFileSync(join(snapshot,'intruder.txt'),'unrequested source');git(snapshot,['add','intruder.txt']);git(snapshot,['commit','--quiet','-m','changed snapshot']);}
 }finally{holder.stdin.end();await ended;}
 let results=[];const started=Date.now();
 while(Date.now()-started<8000){results=jobs.map(job=>JSON.parse(readFileSync(join(dirname(dirname(job.snapshot)),`${job.id}.json`),'utf8')));if(results.every(row=>['pushed','failed'].includes(row.state))&&jobs.every(job=>!existsSync(job.snapshot)))break;await new Promise(resolve=>{setTimeout(resolve,10);});}
 assert.deepEqual(results.map(row=>row.state),rejected?['pushed','failed','pushed','pushed']:['pushed','pushed','pushed','pushed'],JSON.stringify(results));
 const rows=readFileSync(observed,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 if(!rejected){assert.equal(rows.length,1,'Four waiting jobs must cost one actual complete gate');assert.deepEqual(rows[0].values,[1,2,3,4]);assert.equal(new Set(results.map(row=>row.sha)).size,1);}
 for(let i=1;i<=4;i++){
  const result=execFileSync('git',['--git-dir',remote,'ls-tree','--name-only','main'],{encoding:'utf8'}).split('\n');assert.equal(result.includes(`lane-${i}.json`),!rejected||i!==2);assert.ok(!result.includes('intruder.txt'));
  assert.equal(results[i-1].requestedSha,jobs[i-1].sha,'Every original request retains its provenance');
 }
 assert.ok(jobs.every(job=>!existsSync(job.snapshot)));
 console.log(JSON.stringify({waitingJobs:4,redMiddleJobIsolated:red,changedSnapshotRefused:changed,completeGates:rows.length,greenPublished:rejected?3:4,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
