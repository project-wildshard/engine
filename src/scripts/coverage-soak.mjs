#!/usr/bin/env node
// Read-only evidence collector. Wall time and actual passing runs are both
// required; a week cannot be manufactured by repeating a case today.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {stripVTControlCharacters} from 'node:util';

const root=resolve(import.meta.dirname,'..', '..'),out=resolve(process.argv[2]??join(root,'tmp/coverage-soak'));
assert.ok(out.startsWith(`${root}/tmp/`));mkdirSync(out,{recursive:true});
writeFileSync(join(out,'receipt.json'),JSON.stringify({version:1,eligible:false,collection:'running'}));
/** @param {string} path */
const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}));
/** @param {string[]} args */
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourcePath='test/ci/coverage-fire-drill.proof.mjs',source=git(['show',`HEAD:${sourcePath}`]);
/** @param {string} text */
const hash=text=>createHash('sha256').update(text).digest('hex');
const sourceHash=hash(source);
const expected=[...source.matchAll(/timed\('([^']+)'/gu)].map(match=>match[1]);assert.ok(expected.length>0);
const branch=git(['branch','--show-current']);assert.ok(branch);
/** @type {{workflow_runs:{id:number,status:string,head_sha:string,run_started_at?:string,created_at:string,updated_at:string}[]}} */
const page=api(`repos/project-wildshard/engine/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=100`);
const observations=[];let completeHistory=page.workflow_runs.length<100;
for(const run of page.workflow_runs.filter(row=>row.status==='completed')){
  let committed;try{committed=git(['show',`${run.head_sha}:${sourcePath}`]);}catch{
    try{committed=execFileSync('gh',['api','--header','Accept: application/vnd.github.raw+json',`repos/project-wildshard/engine/contents/${sourcePath}?ref=${run.head_sha}`],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}).trim();}
    catch{completeHistory=false;continue;}
  }
  if(hash(committed)!==sourceHash)continue;
  /** @type {{id:number,name:string,steps?:{name:string,conclusion:string,started_at?:string|null,completed_at?:string|null}[]}[]} */
  const jobs=api(`repos/project-wildshard/engine/actions/runs/${run.id}/jobs?per_page=100`).jobs;
  const matches=jobs.filter(job=>job.name==='tests (1)').flatMap(job=>(job.steps??[]).filter(step=>step.name==='Soak actual host, door, format and outside-author contracts').map(step=>({job,step})));
  if(matches.length!==1){observations.push({run:run.id,sha:run.head_sha,started:run.run_started_at??run.created_at,completed:run.updated_at,ok:false,error:'Expected exactly one soak step'});continue;}
  const {job,step}=matches[0];
  const log=stripVTControlCharacters(execFileSync('gh',['api','--allow-escape-sequences',`repos/project-wildshard/engine/actions/jobs/${job.id}/logs`],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}));
  const begin=log.indexOf('##[group]Run node --import ./src/scripts/bake-loader.mjs --test test/ci/coverage-fire-drill.proof.mjs');
  const end=begin===-1?-1:log.indexOf('##[group]',begin+10),body=begin===-1?'':log.slice(begin,end===-1?undefined:end);
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(name=>[name,Number(new RegExp(`(?:#|ℹ)\\s+${name}\\s+(\\d+)`,'u').exec(body)?.[1]??'NaN')]));
  const ok=step.conclusion==='success'&&counts.tests===expected.length&&counts.pass===expected.length&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  observations.push({run:run.id,sha:run.head_sha,job:job.id,started:step.started_at??run.run_started_at??run.created_at,completed:step.completed_at??run.updated_at,ok,counts,logHash:hash(body)});
}
observations.sort((a,b)=>Date.parse(a.started??'')-Date.parse(b.started??''));
const lastFailure=observations.reduce((last,row,index)=>row.ok?last:index,-1),clean=observations.slice(lastFailure+1).filter(row=>row.ok);
const first=clean[0],last=clean.at(-1),week=7*24*60*60*1000;
const due=first===undefined?null:Date.parse(first.started)+week;
const eligible=completeHistory&&due!==null&&first!==undefined&&last!==undefined&&Date.parse(last.completed)>=due;
const report={version:1,branch,sourceHash,cases:expected,generatedAt:new Date().toISOString(),completeHistory,eligible,due:due===null?null:new Date(due).toISOString(),observations};
writeFileSync(join(out,'receipt.json'),JSON.stringify(report,null,2));
console.log(eligible?'Soak complete: actual passing observations span seven days':due===null?'Soak open: no completed hosted run of the current case body yet':`Soak open until a green observation after ${new Date(due).toLocaleString('en-CA',{timeZone:'America/Cancun',hour12:false})} Cancún`);
