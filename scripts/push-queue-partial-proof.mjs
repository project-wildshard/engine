// Actual blobless clone refusal happens before capture; full sources still check.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=resolvePath(process.argv[2]??'tmp/push-queue-partial-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'author'),remote=join(work,'remote.git'),partial=join(work,'partial'),full=join(work,'full'),queue=join(work,'queue');mkdirSync(repo);
const env={...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log')};
/** @param {string[]} args @param {string} [cwd] */
const git=(args,cwd=repo)=>execFileSync('git',['-c','user.name=Partial clone proof','-c','user.email=proof@example.test',...args],{cwd,env,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['--git-dir',remote,'config','uploadpack.allowFilter','true']);
 mkdirSync(join(repo,'.githooks'));writeFileSync(join(repo,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.cjs\n');chmodSync(join(repo,'.githooks/pre-push'),0o755);
 writeFileSync(join(repo,'gate.cjs'),'const{readFileSync}=require("node:fs");require("node:assert/strict").equal(JSON.parse(readFileSync("value.json")).value,2);\n');
 writeFileSync(join(repo,'package.json'),'{"name":"partial-proof","version":"1.0.0","private":true}');writeFileSync(join(repo,'pnpm-workspace.yaml'),'packages: []\n');writeFileSync(join(repo,'.gitignore'),'node_modules/\n');
 writeFileSync(join(repo,'value.json'),'{"value":1}');execFileSync('pnpm',['install','--lockfile-only'],{cwd:repo,env,stdio:'pipe'});
 git(['add','.githooks/pre-push','gate.cjs','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.gitignore','value.json']);git(['commit','--quiet','-m','base']);
 writeFileSync(join(repo,'value.json'),'{"value":2}');git(['commit','--quiet','-m','second','--','value.json']);git(['remote','add','origin',remote]);git(['push','--quiet','origin','main']);
 git(['clone','--quiet','--filter=blob:none',pathToFileURL(remote).href,partial]);
 assert.equal(git(['config','--bool','remote.origin.promisor'],partial),'true');
 assert.match(git(['rev-list','--objects','--all','--missing=print'],partial),/^\?[a-f0-9]{40}$/mu,'Actual filtered history must lack an old blob');
 const script=resolvePath('scripts/push-queue.mjs');
 const refused=spawnSync(process.execPath,[script,'enqueue',partial,`--root=${queue}`],{env,encoding:'utf8',timeout:5000});
 assert.notEqual(refused.status,0);assert.match(refused.stderr,/partial-clone source refused/u);
 assert.equal(existsSync(queue),false,'Refusal must precede all queue/snapshot allocation');
 git(['clone','--quiet','--no-local',pathToFileURL(remote).href,full]);
 git(['config','remote.origin.promisor','false'],full);
 // Request one unpublished commit so the full positive control cannot return
 // already-published without running its normal hook.
 git(['commit','--quiet','--allow-empty','-m','full control'],full);
 const result=spawnSync(process.execPath,[script,'enqueue',full,`--root=${queue}`,'--check-only'],{env,encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
 const job=JSON.parse(result.stdout),folder=join(queue,readdirSync(queue).find(name=>name!=='capture.lock')??'');
 const receipt=join(folder,`${job.id}.json`),start=Date.now();let final;
 while(Date.now()-start<5000){final=JSON.parse(readFileSync(receipt,'utf8'));if((final.state==='checked'||final.state==='failed')&&!existsSync(job.snapshot))break;await new Promise(resolve=>{setTimeout(resolve,10);});}
 assert.equal(final?.state,'checked',JSON.stringify(final));assert.equal(existsSync(job.snapshot),false);
 console.log(JSON.stringify({actualPartialClone:true,missingOldBlob:true,refusedBeforeCapture:true,falsePromisorAllowed:true,fullCloneNormalHook:true}));
}finally{rmSync(work,{recursive:true,force:true});}
