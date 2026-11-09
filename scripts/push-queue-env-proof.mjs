// Two actual queued pushes must not inherit their first enqueuer's bypasses.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve as resolvePath} from 'node:path';

const directory=resolvePath(process.argv[2]??'tmp/push-queue-env-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo'),remote=join(work,'remote.git'),queue=join(work,'queue'),observed=join(work,'observed.jsonl');mkdirSync(repo);
const script=resolvePath('scripts/push-queue.mjs'),env={...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log')};
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Queue environment proof','-c','user.email=proof@example.test',...args],{cwd:repo,env,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['remote','add','origin',remote]);mkdirSync(join(repo,'.githooks'));
 writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.cjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
 writeFileSync(join(repo,'gate.cjs'),`const{readFileSync,appendFileSync}=require('node:fs'),assert=require('node:assert/strict');const value=JSON.parse(readFileSync('value.json')).value;const unsafe=['SKIP_CHECK','ALLOW_BIG','ALLOW_SECRET','ALLOW_BRANCH','SKIP_JOURNAL','SKIP_BUDGET','NODE_OPTIONS'].filter(key=>process.env[key]!==undefined);appendFileSync(${JSON.stringify(observed)},JSON.stringify({value,unsafe,full:process.env.WS_FULL_SUITE})+'\\n');if(process.env.SKIP_CHECK!=='1'){assert.deepEqual(unsafe,[]);assert.equal(process.env.WS_FULL_SUITE,'1');assert.ok(value>0,'actual value assertion refuses');}`);
 writeFileSync(join(repo,'prepare.cjs'),"setTimeout(()=>{},150);");
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'queue-env-proof',version:'1.0.0',private:true,scripts:{'tools:install':'node prepare.cjs'}}));writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');writeFileSync(join(repo,'.gitignore'),'node_modules/\n');writeFileSync(join(repo,'value.json'),'{"value":1}');
 execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,env,stdio:'pipe'});git(['add','.githooks/pre-push','gate.cjs','prepare.cjs','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','.gitignore','value.json']);git(['commit','--quiet','-m','base']);git(['push','--quiet','origin','main']);
 writeFileSync(join(repo,'value.json'),'{"value":2}');git(['commit','--quiet','-m','positive','--','value.json']);const positive=git(['rev-parse','HEAD']);
 writeFileSync(join(repo,'value.json'),'{"value":-1}');git(['commit','--quiet','-m','negative','--','value.json']);const negative=git(['rev-parse','HEAD']);
 // These flags exist only in this disposable fixture enqueuer, never in a
 // real repository hook. The fixture models the real SKIP_CHECK branch.
 const unsafe={...env,SKIP_CHECK:'1',ALLOW_BIG:'1',ALLOW_SECRET:'1',ALLOW_BRANCH:'1',SKIP_JOURNAL:'1',SKIP_BUDGET:'1',NODE_OPTIONS:'--no-warnings',WS_FULL_SUITE:'0'};
 const jobs=[positive,negative].map((sha,index)=>JSON.parse(execFileSync(process.execPath,[script,'enqueue',repo,`--commit=${sha}`,`--root=${queue}`],{env:index===0?unsafe:env,encoding:'utf8'})));
 const started=Date.now();let results=[];
 while(Date.now()-started<7000){results=jobs.map(job=>JSON.parse(readFileSync(join(dirname(dirname(job.snapshot)),`${job.id}.json`),'utf8')));if(results.every(row=>['pushed','failed'].includes(row.state))&&jobs.every(job=>!existsSync(job.snapshot)))break;await new Promise(resolve=>{setTimeout(resolve,10);});}
 assert.deepEqual(results.map(row=>row.state),['pushed','failed'],'Unsafe first enqueuer must not disable either job gate');
 assert.equal(git(['--git-dir',remote,'rev-parse','refs/heads/main']),positive);
 const rows=readFileSync(observed,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(rows.map(row=>row.value),[2,2,-1]);assert.ok(rows.every(row=>row.unsafe.length===0&&row.full==='1'));
 console.log(JSON.stringify({realQueuedPushes:2,firstEnqueuerBypassesRemoved:true,positiveNormalHookTwice:true,negativeNotPublished:true,allSnapshotsDrained:true}));
}finally{rmSync(work,{recursive:true,force:true});}
