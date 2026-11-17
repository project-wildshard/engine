import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {test} from 'vitest';
import {hostedReleaseProof,releasePreparation,releaseTag} from '../../scripts/release-gate.mjs';
import {pushSelection} from '../../scripts/push-selection.mjs';

const ORIGIN='https://github.com/project-wildshard/engine.git';
const RELEASE='v0.1.37', NAME=`release/${RELEASE}`, BRANCH=`refs/heads/${NAME}`, TAG=`refs/tags/${RELEASE}`;
const zero='0'.repeat(40);
const publish=(ref,sha)=>`${ref} ${sha} ${ref} ${zero}`;

function fixture({codeChange=false,scriptChange=false}={}){
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
 file('CHANGELOG.md','# Changelog\n\n## v0.1.37\n\n- Version notes\n\n## v0.1.36\n');
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

test('the real push gate skips the lease on exact hosted proof and runs it on an incomplete result',ctx=>{
 const {root,git,commit,tag}=fixture();
 ctx.onTestFinished(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin'),tree=join(root,'release-tree');
 mkdirSync(bin);
 git('worktree','add','--detach',tree,commit);
 writeFileSync(join(bin,'gh'),`#!/usr/bin/env node
const complete = process.env.RELEASE_PROOF_COMPLETE === 'yes';
const pass = {status:'completed',conclusion:'success'};
const step = { name:"Run this job's packed share", ...pass };
const jobs = [...Array.from({length:9},(_,at)=>({name:'tests ('+(at+1)+')',...pass,steps:[step]})),{name:'boundaries',...pass}];
const run = { head_sha:${JSON.stringify(commit)}, head_branch:${JSON.stringify(NAME)}, event:'push',...pass,id:151,run_started_at:new Date(Date.now()-30_000).toISOString(),head_repository:{full_name:'project-wildshard/engine'} };
console.log(JSON.stringify(process.argv.some(arg=>arg.includes('/jobs?'))
 ? {jobs:complete?jobs:jobs.slice(0,-1),total_count:jobs.length}
 : {workflow_runs:[run]}));
`,{mode:0o700});
 writeFileSync(join(bin,'python3'),'#!/bin/sh\necho fixture-full-lease >&2\nexit 12\n',{mode:0o700});
 const env={...process.env,PATH:[bin,process.env.PATH??''].join(delimiter),WS_PUSH_REFS:publish(TAG,tag),WS_PUSH_DESTINATION:ORIGIN};
 for(const key of ['CI','GITHUB_ACTIONS','SKIP_CHECK','WS_MAIN_PUSH_GATED','WS_LAND_MAIN_PUSH'])delete env[key];
 const check=complete=>spawnSync(process.execPath,[resolve('.githooks/run-checks.mjs'),'push'],
  {cwd:tree,env:{...env,RELEASE_PROOF_COMPLETE:complete},encoding:'utf8',timeout:20_000});
 const skipped=check('yes');
 assert.equal(skipped.status,0,skipped.stderr);
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
 const jobs=[packed,{name:'boundaries',status:'completed',conclusion:'success'}];
 const check=({row=run,list=jobs,count=list.length,exclusions=scope}={})=>hostedReleaseProof(release,root,{now,scope:exclusions,api:path=>{
  if(path.includes('/jobs'))return {jobs:list,total_count:count};
  assert.ok(path.includes(`head_sha=${commit}&branch=${encodeURIComponent(row.head_branch)}`));
  return {workflow_runs:[row]};
 }});
 assert.deepEqual(check(),{run:151,branch:NAME,commit});
 for(const row of [{...run,head_sha:'a'.repeat(40)},{...run,head_repository:{full_name:'fork/engine'}},{...run,event:'pull_request'},{...run,conclusion:'failure'}])assert.equal(check({row}),null);
 assert.equal(check({list:[packed]}),null);
 assert.equal(check({list:[{...packed,steps:[{...packed.steps[0],conclusion:'skipped'}]},jobs[1]]}),null);
 assert.equal(check({count:jobs.length+1}),null);
 assert.equal(check({exclusions:time=>String(time===now)}),null);
 git('update-ref','-d',`refs/remotes/origin/${NAME}`);
 assert.equal(check(),null);
 git('update-ref','refs/remotes/origin/main','HEAD');
 assert.deepEqual(check({row:{...run,head_branch:'main'}}),{run:151,branch:'main',commit});
});
