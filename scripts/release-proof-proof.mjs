// Manual outer-edge proof: real installed package, Git clones and release CLI.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const helper=process.argv.find(arg=>arg.startsWith('--helper='))?.slice(9);
const parent=resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/release-proof-proof');mkdirSync(parent,{recursive:true});
const work=mkdtempSync(join(parent,'run-')),producer=join(work,'producer'),receiver=join(work,'consumer/engine'),remote=join(work,'remote.git');
const engine=process.cwd(),began=performance.now(),counter=join(work,'completed-checks.json'),version=JSON.parse(readFileSync('node_modules/valibot/package.json','utf8')).version;
const env={...process.env,PATH:[join(work,'bin'),process.env.PATH??''].join(delimiter),XDG_CACHE_HOME:join(work,'cache'),WS_FULL_SUITE:'1',WS_HEAVY_ROOT:join(work,'scheduler'),WS_HEAVY_SCHEDULER_ROOT:join(work,'scheduler')};
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',['-c','user.name=Release proof','-c','user.email=proof@example.test',...args],{cwd,env,encoding:'utf8'}).trim();
/** @param {string} root @param {boolean} frozen */
const install=(root,frozen)=>execFileSync('pnpm',['install','--offline','--ignore-workspace','--config.enableGlobalVirtualStore=false',...(frozen?['--frozen-lockfile']:[])],{cwd:root,env:{...process.env,WS_FULL_SUITE:'1',PWD:root},stdio:'pipe',encoding:'utf8',timeout:10_000});
/** @param {NodeJS.ProcessEnv} [changes] */
const probe=(changes={})=>spawnSync(process.execPath,[join(engine,'scripts/release-check.mjs'),'--probe'],{cwd:receiver,env:{...env,...changes,PWD:receiver},encoding:'utf8',timeout:10_000});
try{
 mkdirSync(producer);git(producer,['init','--quiet','--initial-branch=main']);git(work,['init','--quiet','--bare','--initial-branch=main',remote]);
 writeFileSync(join(producer,'package.json'),JSON.stringify({name:'release-proof-fixture',version:'1.0.0',type:'module',exports:'./value.mjs',dependencies:{valibot:version},devDependencies:{'release-proof-fixture':'link:.'},scripts:{check:'node value-check.mjs'}}));
 writeFileSync(join(producer,'.gitignore'),'node_modules/\n');
 writeFileSync(join(producer,'value.mjs'),'export const value=1;\n');
 writeFileSync(join(producer,'value-check.mjs'),`import assert from'node:assert/strict';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{parse,number}from'valibot';import{value}from'./value.mjs';import{value as self}from'release-proof-fixture';assert.equal(parse(number(),value),1);assert.equal(self,1);const count=${JSON.stringify(counter)};writeFileSync(count,JSON.stringify((existsSync(count)?JSON.parse(readFileSync(count,'utf8')):0)+1));\n`);
 mkdirSync(join(work,'bin'));const gh=join(work,'bin/gh');writeFileSync(gh,"#!/usr/bin/env node\nconst sha=process.argv.join(' ').match(/head_sha=([a-f0-9]{40})/)[1];console.log(JSON.stringify({workflow_runs:['ci','ring-1'].map((name,index)=>({id:index+1,name,event:'push',head_sha:sha,status:'completed',conclusion:process.env.GH_FIXTURE_RED&&name==='ci'?'failure':'success'}))}));\n");chmodSync(gh,0o755);
 mkdirSync(join(producer,'scripts'));symlinkSync(join(engine,'scripts/release-check.mjs'),join(producer,'scripts/release-check.mjs'));copyFileSync(join(engine,'scripts/push-budget.mjs'),join(producer,'scripts/push-budget.mjs'));
 mkdirSync(join(producer,'.githooks'));const entry=join(engine,'.githooks/run-checks.mjs'),hook=join(producer,'.githooks/pre-push');
 writeFileSync(hook,`#!/usr/bin/env node\nimport{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';const p=spawnSync(process.execPath,[${JSON.stringify(entry)},'push'],{env:{...process.env,WS_PUSH_REFS:readFileSync(0,'utf8')},stdio:'inherit'});process.exitCode=p.status??1;\n`);chmodSync(hook,0o755);
 install(producer,false);git(producer,['add','package.json','pnpm-lock.yaml','.gitignore','value.mjs','value-check.mjs','scripts/release-check.mjs','scripts/push-budget.mjs','.githooks/pre-push']);git(producer,['commit','--quiet','-m','actual complete fixture']);git(producer,['remote','add','origin',remote]);git(producer,['push','--quiet','origin','main']);
 const writer=join(work,'write.mjs'),cache=pathToFileURL(join(engine,'scripts/push-proof-cache.mjs')).href,budget=pathToFileURL(join(engine,'.githooks/push-checks.mjs')).href;
 writeFileSync(writer,`import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{writeFileSync}from'node:fs';import{pushEnvironment}from${JSON.stringify(budget)};import{capturePushTree,writePushProof}from${JSON.stringify(cache)};const env=pushEnvironment(),before=capturePushTree('full-v1',env);assert.ok(before);execFileSync('pnpm',['run','--silent','check'],{env,stdio:'pipe'});const after=capturePushTree('full-v1',env);assert.ok(after);assert.equal(before.tree,after.tree);assert.equal(before.runtime,after.runtime);const proof=writePushProof(before,{mode:process.argv[3]??'full',files:['value.mjs']},.1);writeFileSync(process.argv[2],JSON.stringify(proof));`);
 const receipt=join(work,'receipt.json');execFileSync(process.execPath,[writer,receipt],{cwd:producer,env:{...env,PWD:producer},stdio:'pipe'});
 mkdirSync(dirname(receiver));git(work,['clone','--quiet','--branch=main',remote,receiver]);install(receiver,true);
 // The queue really deletes its producer snapshot. No .git receipt remains.
 rmSync(producer,{recursive:true,force:true});
 let result=probe();assert.equal(result.status,0,`A separately installed clone must reuse the surviving full proof: ${result.stderr}`);
 const proof=JSON.parse(readFileSync(receipt,'utf8'));assert.equal(JSON.parse(result.stdout).run,proof.run);
 if(helper!==undefined){
  const peer=join(work,'peer');git(work,['clone','--quiet','--branch=main',remote,peer]);writeFileSync(join(peer,'peer.md'),'peer source advances while release waits');git(peer,['add','peer.md']);git(peer,['commit','--quiet','-m','independent peer']);git(peer,['push','--quiet','origin','main']);
  git(receiver,['config','core.hooksPath','.githooks']);
  git(receiver,['config','user.name','Release proof']);git(receiver,['config','user.email','proof@example.test']);
  let release=spawnSync('bash',[resolve(helper),'v1.0.0','--finish'],{cwd:receiver,env:{...env,GH_FIXTURE_RED:'1'},encoding:'utf8',timeout:10_000});assert.notEqual(release.status,0,'A cached full result cannot replace exact-SHA green CI');
  assert.equal(JSON.parse(readFileSync(counter,'utf8')),1,'Even a refused release must reuse the already-proved complete local check');
  assert.notEqual(spawnSync('git',['--git-dir',remote,'show-ref','--verify','refs/tags/v1.0.0'],{stdio:'pipe'}).status,0);
  release=spawnSync('bash',[resolve(helper),'v1.0.0','--finish'],{cwd:receiver,env,encoding:'utf8',timeout:10_000});assert.equal(release.status,0,release.stdout+release.stderr);assert.match(release.stdout,new RegExp(proof.run));assert.match(release.stderr,/exact-tree green reuse before lease/u);
  assert.equal(git(work,['--git-dir',remote,'rev-parse','refs/tags/v1.0.0^{}']),proof.commit);
  assert.equal(existsSync(join(work,'scheduler/queue.json')),false,'Actual helper and tag must reuse before acquiring any full-test lease');
  assert.equal(JSON.parse(readFileSync(counter,'utf8')),1,'Actual helper/tag must not repeat the complete fixture check');
 }
 result=probe({CPATH:join(work,'changed-compiler-input')});assert.equal(result.status,3,'Changed compiler inputs require rechecking');
 assert.equal(probe({CI:'true'}).status,3,'CI never consumes a local cached proof');
 const pkg=fileURLToPath(execFileSync(process.execPath,['--input-type=module','-e','console.log(import.meta.resolve("valibot"))'],{cwd:receiver,env,encoding:'utf8'}).trim()),original=readFileSync(pkg),temporary=join(dirname(pkg),`ds2-${process.pid}.tmp`);
 writeFileSync(temporary,"export const parse=()=>2;export const number=()=>({});\n");renameSync(temporary,pkg);
 assert.equal(spawnSync(process.execPath,['value-check.mjs'],{cwd:receiver,env,stdio:'pipe'}).status,1,'The installed-byte edit genuinely breaks the unchanged program');
 assert.equal(probe().status,3,'A real installed package edit cannot reuse a source-only tree proof');
 writeFileSync(temporary,original);renameSync(temporary,pkg);assert.equal(probe().status,0,'Exact installed bytes restored retain the actual proof');
 const link=join(receiver,'node_modules/valibot'),target=readlinkSync(link);rmSync(link);symlinkSync(join(engine,'node_modules/valibot'),link,'dir');
 assert.equal(probe().status,3,'An out-of-store live source alias is not a portable pinned proof');rmSync(link);symlinkSync(target,link,'dir');assert.equal(probe().status,0);
 writeFileSync(join(receiver,'value.mjs'),'export const value=2;');git(receiver,['commit','--quiet','-m','genuinely changed source','--','value.mjs']);assert.equal(probe().status,3,'A new source tree requires its own full proof');
 writeFileSync(join(receiver,'value.mjs'),'export const value=1;');git(receiver,['commit','--quiet','-m','new tree for partial scope','--','value.mjs']);writeFileSync(join(receiver,'note.md'),'partial scope');git(receiver,['add','note.md']);git(receiver,['commit','--quiet','-m','partial result tree']);
 execFileSync(process.execPath,[writer,receipt,'related'],{cwd:receiver,env:{...env,PWD:receiver},stdio:'pipe'});assert.equal(probe().status,3,'A successful related proof never qualifies a release full gate');
 // The same public entry also supports a tiny ordinary package. Remove only
 // its fixture profile marker to prove the real no-cache complete-check path.
 git(receiver,['rm','scripts/push-budget.mjs']);symlinkSync(join(engine,'.githooks/run-checks.mjs'),join(receiver,'.githooks/run-checks.mjs'));git(receiver,['add','.githooks/run-checks.mjs']);git(receiver,['commit','--quiet','-m','complete fallback fixture']);
 const before=JSON.parse(readFileSync(counter,'utf8'));result=spawnSync(process.execPath,[join(engine,'scripts/release-check.mjs')],{cwd:receiver,env,encoding:'utf8',timeout:10_000});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(readFileSync(counter,'utf8')),before+1,'A cache miss executes the actual complete check');
 console.log(JSON.stringify({actualInstalledPackageCheck:true,checkedSelfLinkRelocates:true,deletedProducerProofSurvives:true,crossCloneFullRunId:true,actualReleaseHelperTagReuse:helper!==undefined,noDuplicateCompleteCheck:helper!==undefined,noTagFullTestLease:helper!==undefined,exactCIRetained:helper!==undefined,publishedAncestorSupported:helper!==undefined,compilerChangeRefused:true,ciRefused:true,installedDependencyChangeRefused:true,liveAliasRefused:true,changedSourceRefused:true,relatedCannotCoverRelease:true,cacheMissRunsCompleteCheck:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
