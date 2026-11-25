import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {test} from 'vitest';
import {hostedReleaseProof,releaseOnlyParent,releasePreparation,releaseTag} from '../../scripts/release-gate.mjs';
import {pushSelection} from '../../scripts/push-selection.mjs';

const ORIGIN='https://github.com/project-wildshard/engine.git';
const RELEASE='v0.1.37', NAME=`release/${RELEASE}`, BRANCH=`refs/heads/${NAME}`, TAG=`refs/tags/${RELEASE}`;
const zero='0'.repeat(40);
const publish=(ref,sha)=>`${ref} ${sha} ${ref} ${zero}`;

function fixture({codeChange=false,scriptChange=false,notes='# Changelog\n\n## v0.1.37\n\n- Version notes\n\n## v0.1.36\n'}={}){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp');
 mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'release-gate-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const file=(name,content)=>writeFileSync(join(root,name),content);
 git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 git('remote','add','origin',ORIGIN);
 mkdirSync(join(root,'test'));
 mkdirSync(join(root,'scripts'));
 file('test/quarantine.json','{"schema":1,"entries":[]}\n');
 file('scripts/push-budget.mjs','// Engine push-lane marker.\n');
 file('package.json',JSON.stringify({version:'0.1.36',scripts:{check:'node old.mjs'}}));
 file('CHANGELOG.md','# Changelog\n\n## v0.1.36\n');
 git('add','package.json','CHANGELOG.md','test/quarantine.json','scripts/push-budget.mjs');git('commit','-m','Initial tree');
 git('update-ref','refs/remotes/origin/main','HEAD');
 git('switch','-c',NAME);
 file('package.json',JSON.stringify({version:'0.1.37',scripts:{check:scriptChange?'node new.mjs':'node old.mjs'}}));
 file('CHANGELOG.md',notes);
 if(codeChange){file('engine.mjs','export const change = 1;\n');git('add','engine.mjs');}
 git('add','package.json','CHANGELOG.md');git('commit','-m','Prepare release');
 git('tag','-a',RELEASE,'-m','Prepared release');
 const commit=git('rev-parse','HEAD'),tag=git('rev-parse',TAG);
 git('update-ref',`refs/remotes/origin/${NAME}`,commit);
 return {root,git,commit,tag,release:{commit,version:RELEASE}};
}

test('prepare is a local docs selection only for the allowed release metadata',ctx=>{
 for(const [options,expected] of [[{},true],[{codeChange:true},false],[{scriptChange:true},false]]){
  const {root,commit,git}=fixture(options);
  ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
  assert.equal(releasePreparation(publish(BRANCH,commit),ORIGIN,root),expected);
  assert.equal(pushSelection(publish(BRANCH,commit),root,{releaseDestination:ORIGIN}).mode,expected?'docs':'full');
  assert.equal(pushSelection(publish(BRANCH,commit),root,{hosted:true,releaseDestination:ORIGIN}).mode,'full');
  assert.equal(releasePreparation(publish(BRANCH,commit),'https://example.invalid/engine',root),false);
  assert.equal(releasePreparation(`${publish(BRANCH,commit)}\n${TAG} ${zero} ${TAG} ${commit}`,ORIGIN,root),false);
  git('update-ref','-d','refs/remotes/origin/main');
  assert.equal(releasePreparation(publish(BRANCH,commit),ORIGIN,root),false);
 }
});

test('a canonical tag push reuses hosted proof in its clean copy and leases the suite on a miss',ctx=>{
 const {root,commit,tag}=fixture();
 ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin');
 mkdirSync(bin);
 writeFileSync(join(bin,'gh'),`#!/usr/bin/env node
const complete = process.env.RELEASE_PROOF_COMPLETE === 'yes';
const pass = {status:'completed',conclusion:'success'};
const step = { name:"Run this job's packed share", ...pass };
const boundary = { name:'Cook, attach, and play the same bytes', ...pass };
const jobs = [...Array.from({length:9},(_,at)=>({name:'tests ('+(at+1)+')',...pass,steps:[step]})),{name:'boundaries',...pass,steps:[boundary]}];
const run = { head_sha:${JSON.stringify(commit)}, head_branch:${JSON.stringify(NAME)}, event:'push',...pass,id:151,run_started_at:new Date(Date.now()-30_000).toISOString(),head_repository:{full_name:'project-wildshard/engine'} };
console.log(JSON.stringify(process.argv.some(arg=>arg.includes('/jobs?'))
 ? {jobs:complete?jobs:jobs.slice(0,-1),total_count:jobs.length}
 : {workflow_runs:[run]}));
`,{mode:0o700});
 const python=execFileSync('which',['python3'],{encoding:'utf8'}).trim();
 writeFileSync(join(bin,'python3'),`#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
if(args[0]==='scripts/heavy-lane.py'){
 console.error('fixture-full-lease');process.exitCode=12;
}else{
 process.exitCode=spawnSync(${JSON.stringify(python)},args,{stdio:'inherit'}).status??1;
}
`,{mode:0o700});
 const env={...process.env,PATH:[bin,process.env.PATH??''].join(delimiter),WS_PUSH_REFS:publish(TAG,tag),WS_PUSH_DESTINATION:ORIGIN};
 for(const key of ['CI','GITHUB_ACTIONS','SKIP_CHECK','WS_MAIN_PUSH_GATED','WS_LAND_MAIN_PUSH'])delete env[key];
 const check=complete=>spawnSync(process.execPath,[resolve('.githooks/run-checks.mjs'),'push'],
  {cwd:root,env:{...env,RELEASE_PROOF_COMPLETE:complete},encoding:'utf8',timeout:20_000});
 const skipped=check('yes');
 assert.equal(skipped.status,0,skipped.stderr);
 assert.match(skipped.stderr,/gate in a clean copy/u);
 assert.match(skipped.stderr,/exact hosted CI proof 151/u);
 assert.doesNotMatch(skipped.stderr,/fixture-full-lease/u);
 const full=check('no');
 assert.equal(full.status,12,full.stderr);
 assert.match(full.stderr,/fixture-full-lease/u);
});

test('exact finished release CI is reusable only for the admitted release identity and its full inventory',ctx=>{
 const {root,git,commit,tag,release}=fixture();
 ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
 assert.notEqual(tag,commit);
 assert.deepEqual(releaseTag(publish(TAG,tag),ORIGIN,root),release);
 assert.equal(releaseTag(publish(TAG,tag),'https://example.invalid/engine',root),null);
 assert.equal(releaseTag(`${publish(TAG,tag)}\n${publish(BRANCH,commit)}`,ORIGIN,root),null);
 const now=Date.parse('2026-11-17T10:00:00-05:00'),scope=()=> 'same';
 const run={head_sha:commit,head_branch:NAME,event:'push',status:'completed',conclusion:'success',id:151,
  head_repository:{full_name:'project-wildshard/engine'},run_started_at:'2026-11-17T09:00:00-05:00'};
 const packed={name:'tests (1)',status:'completed',conclusion:'success',steps:[{name:"Run this job's packed share",status:'completed',conclusion:'success'}]};
 const boundaryStep={name:'Cook, attach, and play the same bytes',status:'completed',conclusion:'success'};
 const jobs=[packed,{name:'boundaries',status:'completed',conclusion:'success',steps:[boundaryStep]}];
 const check=({row=run,list=jobs,count=list.length,exclusions=scope}={})=>hostedReleaseProof(release,root,{now,scope:exclusions,api:path=>{
  if(path.includes('/jobs'))return {jobs:list,total_count:count};
  assert.ok(path.includes(`head_sha=${commit}&branch=${encodeURIComponent(row.head_branch)}`));
  return {workflow_runs:[row]};
 }});
 assert.deepEqual(check(),{run:151,branch:NAME,commit});
 for(const row of [{...run,head_sha:'a'.repeat(40)},{...run,head_repository:{full_name:'fork/engine'}},{...run,event:'pull_request'},{...run,conclusion:'failure'}])assert.equal(check({row}),null);
 assert.equal(check({list:[packed]}),null);
 assert.equal(check({list:[packed,{...jobs[1],steps:[{...boundaryStep,conclusion:'skipped'}]}]}),null);
 assert.equal(check({list:[{...packed,steps:[{...packed.steps[0],conclusion:'skipped'}]},jobs[1]]}),null);
 assert.equal(check({count:jobs.length+1}),null);
 assert.equal(check({exclusions:time=>String(time===now)}),null);
 git('update-ref','-d',`refs/remotes/origin/${NAME}`);
 assert.equal(check(),null);
 git('update-ref','refs/remotes/origin/main','HEAD');
 assert.deepEqual(check({row:{...run,head_branch:'main'}}),{run:151,branch:'main',commit});
});

test('FR6: only what release.sh --prepare writes names a release-only parent',ctx=>{
 for(const [options,expected] of [[{},true],[{codeChange:true},false],[{scriptChange:true},false],[{notes:'# Changelog\n\n## v0.1.37\n'},false]]){
  const {root,git,commit}=fixture(options);
  ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
  assert.equal(releaseOnlyParent(root,commit,RELEASE),expected?git('rev-parse',`${commit}^`):null);
  assert.equal(releaseOnlyParent(root,commit,'v0.1.38'),null);
  assert.equal(releasePreparation(publish(BRANCH,commit),ORIGIN,root),expected);
 }
});

test('FR6: a tag push takes a reused release run only with main\'s own proof at the release-only parent',ctx=>{
 const {root,git,commit,release}=fixture();
 ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
 const parent=git('rev-parse',`${commit}^`),now=Date.parse('2026-11-24T19:00:00-05:00');
 const base={event:'push',status:'completed',conclusion:'success',head_repository:{full_name:'project-wildshard/engine'},run_started_at:'2026-11-24T18:00:00-05:00'};
 const releaseRun={...base,head_sha:commit,head_branch:NAME,id:152},mainRun={...base,head_sha:parent,head_branch:'main',id:150};
 const pass={status:'completed',conclusion:'success'},skip={status:'completed',conclusion:'skipped'};
 const shape=ran=>[{name:'tests (1)',...pass,steps:[{name:"Run this job's packed share",...(ran?pass:skip)}]},
  {name:'boundaries',...pass,steps:[{name:'Cook, attach, and play the same bytes',...(ran?pass:skip)}]}];
 const check=({rel=releaseRun,main=mainRun,mainJobs=shape(true)}={})=>hostedReleaseProof(release,root,{now,scope:()=>'same',api:path=>{
  if(path.startsWith('actions/runs/152/'))return {jobs:shape(false),total_count:2};
  if(path.startsWith('actions/runs/150/'))return {jobs:mainJobs,total_count:mainJobs.length};
  if(path.includes(`head_sha=${commit}&branch=${encodeURIComponent(NAME)}&`))return {workflow_runs:[rel]};
  if(path.includes(`head_sha=${parent}&branch=main&`))return {workflow_runs:[main]};
  return {workflow_runs:[]};
 }});
 assert.deepEqual(check(),{run:152,branch:NAME,commit,reused:150,parent});
 assert.equal(check({mainJobs:shape(false)}),null);
 assert.equal(check({main:{...mainRun,conclusion:'failure'}}),null);
 assert.equal(check({main:{...mainRun,head_repository:{full_name:'fork/engine'}}}),null);
 assert.equal(check({rel:{...releaseRun,conclusion:'failure'}}),null);
 git('update-ref','-d','refs/remotes/origin/main');
 assert.equal(check(),null);
});
