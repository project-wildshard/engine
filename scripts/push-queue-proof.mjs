// Four actual queued Git attempts: FIFO pushes, red hook and changed-source refusal.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';
import * as v from 'valibot';

const directory=resolvePath(process.argv[2]??'tmp/push-queue-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo'),remote=join(work,'remote.git'),observed=join(work,'observed.jsonl');mkdirSync(repo);
const jobSchema=v.object({id:v.string(),sha:v.string(),requestedSha:v.optional(v.string()),snapshot:v.string(),state:v.string(),error:v.optional(v.string())});
try{
 execFileSync('git',['init','--quiet','--bare','--initial-branch=main',remote]);
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Queue proof','-c','user.email=proof@example.test',...args],{cwd:repo,encoding:'utf8'}).trim();
 git(['init','--quiet','--initial-branch=main']);git(['remote','add','origin',remote]);
 mkdirSync(join(repo,'.githooks'));writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'push-queue-proof',private:true,version:'1.0.0',type:'module',scripts:{'tools:install':'node prepare-tools.mjs'}}));writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');
 writeFileSync(join(repo,'.gitignore'),'node_modules/\n.prepared\n');
 writeFileSync(join(repo,'prepare-tools.mjs'),"import{writeFileSync}from'node:fs';writeFileSync('.prepared','ready');");
 writeFileSync(join(repo,'gate.mjs'),`import assert from'node:assert/strict';import{readFileSync,appendFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';assert.equal(readFileSync('.prepared','utf8'),'ready');const value=JSON.parse(readFileSync('value.json')).value;assert.ok(Number.isInteger(value)&&value>0);appendFileSync(${JSON.stringify(observed)},JSON.stringify({sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),value})+'\\n');if(value===4)writeFileSync('value.json','{"value":400}');`);
 writeFileSync(join(repo,'value.json'),'{"value":1}');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,stdio:'pipe'});
 git(['add','.gitignore','.githooks/pre-push','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','prepare-tools.mjs','gate.mjs','value.json']);git(['commit','--quiet','-m','base']);git(['config','core.hooksPath','.githooks']);
 execFileSync(process.execPath,['prepare-tools.mjs'],{cwd:repo});git(['push','--quiet','origin','main']);
 const script=resolvePath('scripts/push-queue.mjs'),queue=join(work,'queue'),jobs=[];
 /** @type {string[]} */ const commits=[];
 for(const value of [2,3,-1,4]){
  writeFileSync(join(repo,'value.json'),JSON.stringify({value}));git(['commit','--quiet','-m',`value ${value}`,'--','value.json']);
  commits.push(git(['rev-parse','HEAD']));
 }
 // An independent main advances before capture. Rebase only the immutable
 // request, never the lane's dirty checkout, then check the actual derived tip.
 const upstream=join(work,'upstream');execFileSync('git',['clone','--quiet',remote,upstream]);
 execFileSync(process.execPath,['prepare-tools.mjs'],{cwd:upstream});
 execFileSync('git',['config','core.hooksPath','.githooks'],{cwd:upstream});
 writeFileSync(join(upstream,'upstream.txt'),'retained upstream bytes');
 for(const args of [['add','upstream.txt'],['commit','--quiet','-m','independent main'],['push','--quiet','origin','main']])
  execFileSync('git',['-c','user.name=Queue proof','-c','user.email=proof@example.test',...args],{cwd:upstream});
 // The lane has already moved on: each requested ancestor must stay exact.
 for(const sha of commits){
  const captured=v.parse(jobSchema,JSON.parse(execFileSync(process.execPath,[script,'enqueue',repo,`--commit=${sha}`,`--root=${queue}`],{encoding:'utf8'})));jobs.push(captured);
 }
 // Subsequent dirty lane bytes must never enter any captured job.
 writeFileSync(join(repo,'value.json'),'{"value":999}');
 const start=Date.now();
 /** @type {v.InferOutput<typeof jobSchema>[]} */
 let results=[];
 while(Date.now()-start<20000){
  results=jobs.map(job=>v.parse(jobSchema,JSON.parse(readFileSync(join(dirname(dirname(job.snapshot)),`${job.id}.json`),'utf8'))));
  if(results.every(result=>['pushed','failed'].includes(result.state))&&jobs.every(job=>!existsSync(job.snapshot)))break;
  await new Promise(resolve=>{setTimeout(resolve,20);});
 }
 assert.deepEqual(results.map(job=>job.state),['pushed','pushed','failed','failed'],JSON.stringify(results));
 const rows=v.parse(v.array(v.object({sha:v.string(),value:v.number()})),readFileSync(observed,'utf8').trim().split('\n').map(line=>JSON.parse(line)));
 assert.deepEqual(rows.slice(-5,-1).map(row=>[row.sha,row.value]),results.slice(0,2).flatMap((job,index)=>[[job.sha,index+2],[job.sha,index+2]]));
 assert.equal(execFileSync('git',['--git-dir',remote,'rev-parse','refs/heads/main'],{encoding:'utf8'}).trim(),results[1]?.sha);
 assert.deepEqual(results.map(job=>job.requestedSha),commits);
 assert.ok(results.slice(0,2).every((job,index)=>job.sha!==commits[index]));
 assert.equal(execFileSync('git',['--git-dir',remote,'show','main:upstream.txt'],{encoding:'utf8'}),'retained upstream bytes');
 assert.ok(jobs.every(job=>!existsSync(job.snapshot)));
 assert.match(results[3]?.error??'',/value\.json/u,'Changed source must name the actual path before cleanup');
 console.log(JSON.stringify({orderedPushes:2,immutableRequestsRetained:true,advancedMainRebasedBeforeCheck:true,declaredToolsPrepared:true,normalHookFailureBlocked:true,changedSourceBlocked:true,changedPathReported:true,dirtyBytesExcluded:true,remoteIsSecondCheckedTip:true,snapshotsRemoved:true,milliseconds:Date.now()-start}));
}finally{rmSync(work,{recursive:true,force:true});}
