// Actual Git explicit-ref and real lease-wait races; manual, outside hooks.
import assert from 'node:assert/strict';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const engine=resolvePath(process.argv.find(arg=>arg.startsWith('--engine='))?.slice(9)??'.');
const directory=resolvePath(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/push-ref-tree-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),began=performance.now();
const entry=join(engine,'.githooks/run-checks.mjs'),cache=pathToFileURL(join(engine,'scripts/push-proof-cache.mjs')).href;
const budget=pathToFileURL(join(engine,'.githooks/push-checks.mjs')).href,lease=pathToFileURL(join(engine,'scripts/heavy-lane-lease.mjs')).href;
/** @param {string} name @param {number} expected */
function fixture(name,expected){
 const base=join(work,name),repo=join(base,'repo'),remote=join(base,'remote.git'),root=join(base,'scheduler');mkdirSync(repo,{recursive:true});
 const env={...process.env,PWD:repo,WS_FULL_SUITE:'1',WS_HEAVY_ROOT:root,WS_HEAVY_SCHEDULER_ROOT:root};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')||['WS_HEAVY_TOKEN','WS_PUSH_REFS','CI','GITHUB_ACTIONS'].includes(key))Reflect.deleteProperty(env,key);
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Ref tree proof','-c','user.email=proof@example.test',...args],{cwd:repo,env,encoding:'utf8'}).trim();
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['remote','add','origin',remote]);mkdirSync(join(repo,'scripts'));mkdirSync(join(repo,'.githooks'));
 writeFileSync(join(repo,'scripts/push-budget.mjs'),readFileSync(join(engine,'scripts/push-budget.mjs')));
 writeFileSync(join(repo,'scripts/heavy-lane.py'),readFileSync(join(engine,'scripts/heavy-lane.py')));
 writeFileSync(join(repo,'scripts/quiet_logs.py'),readFileSync(join(engine,'scripts/quiet_logs.py')));
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'ref-tree-proof',version:'1.0.0',private:true,type:'module',scripts:{check:'node value-check.cjs'}}));
 writeFileSync(join(repo,'value-check.cjs'),`require('node:assert/strict').equal(JSON.parse(require('node:fs').readFileSync('value.json')).value,${expected});`);
 // The real run-checks entry owns cache/lease choice; this fixture's complete
 // configured gate is one real value assertion under that real lease.
 writeFileSync(join(repo,'.githooks/push-checks.mjs'),`import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{pushEnvironment}from${JSON.stringify(budget)};import{capturePushTree,writePushProof}from${JSON.stringify(cache)};import{assertHeavyLease}from${JSON.stringify(lease)};assertHeavyLease('full-test');const env=pushEnvironment(Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')))),before=capturePushTree('full-v1',env);assert.ok(before);execFileSync(process.execPath,['value-check.cjs']);const after=capturePushTree('full-v1',env);assert.ok(after);assert.equal(after.tree,before.tree);writePushProof(after,{mode:'full',files:['value.json']},.01);`);
 const hook=join(repo,'.git/hooks/pre-push');writeFileSync(hook,`#!/usr/bin/env bash\nset -euo pipefail\nexport WS_PUSH_REFS="$(cat)"\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} push\n`);chmodSync(hook,0o755);
 writeFileSync(join(repo,'.gitignore'),'**/__pycache__/\n');
 writeFileSync(join(repo,'value.json'),'{"value":1}');git(['add','.gitignore','scripts/push-budget.mjs','scripts/heavy-lane.py','scripts/quiet_logs.py','package.json','value-check.cjs','.githooks/push-checks.mjs','value.json']);git(['commit','--quiet','-m','first']);const first=git(['rev-parse','HEAD']);
 writeFileSync(join(repo,'value.json'),'{"value":2}');git(['commit','--quiet','-m','second','--','value.json']);const second=git(['rev-parse','HEAD']);
 return {repo,remote,root,env,git,first,second};
}
try{
 if(!process.argv.includes('--case=lease')){
  const f=fixture('explicit',2),writer=join(work,'write-proof.mjs');
  writeFileSync(writer,`import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{pushEnvironment}from${JSON.stringify(budget)};import{capturePushTree,writePushProof}from${JSON.stringify(cache)};const env=pushEnvironment(process.env),before=capturePushTree('full-v1',env);assert.ok(before);execFileSync(process.execPath,['value-check.cjs']);writePushProof(before,{mode:'full',files:['value.json']},.01);`);
  execFileSync(process.execPath,[writer],{cwd:f.repo,env:f.env});
  const bad=spawnSync('git',['push','origin',`${f.first}:refs/heads/main`],{cwd:f.repo,env:f.env,encoding:'utf8',timeout:5000});
  assert.notEqual(bad.status,0,'A cached HEAD proof must not publish another untested tree');assert.match(bad.stderr,/Push target tree differs/u);
  assert.notEqual(spawnSync('git',['--git-dir',f.remote,'show-ref','--verify','refs/heads/main'],{stdio:'ignore'}).status,0);
  const good=spawnSync('git',['push','origin','HEAD:refs/heads/main'],{cwd:f.repo,env:f.env,encoding:'utf8',timeout:5000});assert.equal(good.status,0,good.stderr);assert.match(good.stderr,/exact-tree green reuse before lease/u);
 }
 if(!process.argv.includes('--case=explicit')){
  const f=fixture('lease',3);
  const holder=spawn('python3',[join(engine,'scripts/heavy-lane.py'),'full-test','--',process.execPath,'-e',"console.log('ready');process.stdin.resume()"],{cwd:f.repo,env:f.env,stdio:['pipe','pipe','pipe']});
  const observed={ready:false};holder.stdout.on('data',data=>{if(data.toString().includes('ready'))observed.ready=true;});const ended=new Promise(resolve=>{holder.once('exit',resolve);});
  let push;
  try{
   const start=Date.now();while(!observed.ready&&Date.now()-start<3000)await new Promise(resolve=>{setTimeout(resolve,10);});assert.ok(observed.ready);
   push=spawn('git',['push','origin',`${f.second}:refs/heads/main`],{cwd:f.repo,env:f.env,stdio:['ignore','pipe','pipe']});let error='';push.stderr.on('data',data=>{error+=data;});
   const pushed=new Promise(resolve=>{push.once('exit',resolve);});
   let queued=false;const wait=Date.now();while(Date.now()-wait<3000){try{queued=JSON.parse(readFileSync(join(f.root,'queue.json'),'utf8')).queue.length>0;}catch{ /* The real holder may not have written its state yet. */ }if(queued)break;await new Promise(resolve=>{setTimeout(resolve,10);});}assert.ok(queued,`Actual push must wait behind the real global lease: ${error}`);
   writeFileSync(join(f.repo,'value.json'),'{"value":3}');f.git(['commit','--quiet','-m','land during lease','--','value.json']);holder.stdin.end();await ended;
   assert.notEqual(await pushed,0,'A lease-wait HEAD change must not validate the old target');assert.match(error,/Push target tree differs/u);
   assert.notEqual(spawnSync('git',['--git-dir',f.remote,'show-ref','--verify','refs/heads/main'],{stdio:'ignore'}).status,0);
   const good=spawnSync('git',['push','origin','HEAD:refs/heads/main'],{cwd:f.repo,env:f.env,encoding:'utf8',timeout:5000});assert.equal(good.status,0,good.stderr);
  }finally{holder.stdin.end();await ended;if(push?.exitCode===null)push.kill('SIGTERM');}
 }
 console.log(JSON.stringify({explicitTargetTreeRefused:true,realLeaseRaceRefused:true,checkedTargetsStillPublish:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
