// EV4: prove the exact release tree before acquiring a second test lease.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {provesCode} from './ci-proof-jobs.mjs';
import {activeQuarantineFiles} from './test-quarantine.mjs';

const REPO='project-wildshard/engine';
const ORIGIN=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)project-wildshard\/engine(?:\.git)?$/u;
const SHA=/^[a-f0-9]{40}$/u;
const ZERO='0'.repeat(40);
const VERSION='v(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)';
const branchRef=new RegExp(`^refs/heads/release/(${VERSION})$`,'u');
const tagRef=new RegExp(`^refs/tags/(${VERSION})$`,'u');
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** The blocking suite's active J200 quarantine at the observation time: a hosted proof counts only when it is the same
 * set as when that run started. @param {number} at @param {string} cwd */
export function exclusionScope(at,cwd){
 return JSON.stringify(activeQuarantineFiles(at,resolve(cwd,'test/quarantine.json')).sort());
}

/** @param {string} cwd @param {string[]} args @param {number} [timeout] */
function git(cwd,args,timeout=3000){
 return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout}).trimEnd();
}

/** A shortcut applies to a push containing exactly one new ref.
 * @param {string|undefined} refs */
function newRef(refs){
 const [source,object,target,previous,...other]=(refs??'').trim().split(/\s+/u);
 return source===target&&target!==undefined&&object!==undefined&&SHA.test(object)&&object!==ZERO&&previous===ZERO&&other.length===0?{object,target}:null;
}

/** @param {string} cwd @param {string} commit @param {string} ref */
function reachable(cwd,commit,ref){
 try{git(cwd,['merge-base','--is-ancestor',commit,ref]);return true;}catch{return false;}
}

/** FAST-RELEASE FR6: the commit `release.sh --prepare` writes changes nothing a test could see but the release's
 * identity: one parent, `package.json` differing in `version` alone (set to this release's) and `CHANGELOG.md`
 * gaining lines only. Returns that parent, or null for anything else (a --pick, a merge, a stamp that writes code).
 * Git may fetch a partial clone's blobs on demand here (CI checks out with blob:none), hence the longer timeout.
 * @param {string} cwd @param {string} commit @param {string} version e.g. `v0.1.85` @returns {string|null} */
export function releaseOnlyParent(cwd,commit,version){
 if(!SHA.test(commit)||!tagRef.test(`refs/tags/${version}`))return null;
 try{
  const [,parent,merge]=git(cwd,['rev-list','--parents','-n','1',commit],30_000).split(' ');
  if(parent===undefined||!SHA.test(parent)||merge!==undefined)return null;
  const rows=git(cwd,['diff','--numstat','--no-renames',parent,commit],30_000).split('\n').map(line=>line.split('\t'));
  if(!isDeepStrictEqual(rows.map(row=>row[2]),['CHANGELOG.md','package.json'])||rows[0]?.[1]!=='0')return null;
  const old=/** @type {unknown} */(JSON.parse(git(cwd,['show',`${parent}:package.json`],30_000)));
  const next=/** @type {unknown} */(JSON.parse(git(cwd,['show',`${commit}:package.json`],30_000)));
  if(!record(old)||!record(next)||typeof old.version!=='string'||old.version===next.version||next.version!==version.slice(1))return null;
  return isDeepStrictEqual({...old,version:next.version},next)?parent:null;
 }catch{return null;}
}

/** A release branch's hosted CI reuses main's code proof at the cut (FR6, scripts/ci-selection.mjs); this is its local
 * twin: only the locally redundant metadata-only branch push can use the docs lane.
 * @param {string|undefined} refs @param {string|undefined} destination @param {string} cwd */
export function releasePreparation(refs,destination,cwd){
 const push=newRef(refs),version=branchRef.exec(push?.target??'')?.[1];
 if(push===null||version===undefined||!ORIGIN.test(destination??''))return false;
 const parent=releaseOnlyParent(cwd,push.object,version);
 return parent!==null&&reachable(cwd,parent,'refs/remotes/origin/main');
}

/** The ring the tag-push shortcut has always demanded beside the packed shares.
 * @param {readonly unknown[]} jobs */
export function provesBoundaries(jobs){
 return jobs.some(job=>record(job)&&job.name==='boundaries'&&job.status==='completed'&&job.conclusion==='success'&&
  Array.isArray(job.steps)&&job.steps.some(step=>record(step)&&step.name==='Cook, attach, and play the same bytes'&&step.status==='completed'&&step.conclusion==='success'));
}

/** Only the actual engine origin can use Actions for the pushed tag.
 * @param {string|undefined} refs @param {string|undefined} destination @param {string} cwd */
export function releaseTag(refs,destination,cwd){
 const push=newRef(refs),version=tagRef.exec(push?.target??'')?.[1];
 if(push===null||version===undefined||!ORIGIN.test(destination??''))return null;
 try{return {version,commit:git(cwd,['rev-parse','--verify',`${push.object}^{commit}`])};}catch{return null;}
}

/** @param {string} path @returns {unknown} */
function github(path){
 return JSON.parse(execFileSync('gh',['api','--hostname','github.com',`repos/${REPO}/${path}`],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:4*1024*1024}));
}

/** A successful aggregate and completed packed shares must refer to this
 * commit on this repository's published release branch or main. A green release-branch run that reused main's proof
 * (FR6: its docs verdict) counts when this commit is release-only over a parent whose own main run proves code here.
 * Every miss keeps the existing authenticated local proof and full-gate fallback.
 * @param {{commit:string,version:string}} release @param {string} cwd
 * @param {{api?:(path:string)=>unknown,scope?:(at:number)=>string,now?:number}} [options] */
export function hostedReleaseProof({commit,version},cwd,{api=github,scope=at=>exclusionScope(at,cwd),now=Date.now()}={}){
 if(!SHA.test(commit)||!tagRef.test(`refs/tags/${version}`))return null;
 try{
  if(!ORIGIN.test(git(cwd,['remote','get-url','--push','origin'])))return null;
  const manifest=/** @type {unknown} */(JSON.parse(git(cwd,['show',`${commit}:package.json`])));
  if(!record(manifest)||manifest.version!==version.slice(1))return null;
  const releaseBranch=`release/${version}`;
  /** @type {string[]} */
  const branches=[];
  try{if(git(cwd,['rev-parse','--verify',`refs/remotes/origin/${releaseBranch}^{commit}`])===commit)branches.push(releaseBranch);}catch{/* A legacy release can still have exact main CI. */}
  if(reachable(cwd,commit,'refs/remotes/origin/main'))branches.push('main');
  /** This repository's latest green push run of ci.yml for `sha` on `branch`, under today's quarantine, with its
   * complete job list. @param {string} sha @param {string} branch */
  const greenRun=(sha,branch)=>{
   const data=api(`actions/workflows/ci.yml/runs?head_sha=${sha}&branch=${encodeURIComponent(branch)}&event=push&per_page=1`);
   const run=record(data)&&Array.isArray(data.workflow_runs)?data.workflow_runs[0]:null;
   if(!record(run)||run.head_sha!==sha||run.head_branch!==branch||run.event!=='push'||run.status!=='completed'||run.conclusion!=='success'||
      typeof run.id!=='number'||!Number.isSafeInteger(run.id)||run.id<1||!record(run.head_repository)||run.head_repository.full_name!==REPO)return null;
   const started=typeof run.run_started_at==='string'?Date.parse(run.run_started_at):Number.NaN;
   if(!Number.isFinite(started)||started>now||scope(started)!==scope(now))return null;
   const jobs=api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
   if(!record(jobs)||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length)return null;
   return {id:run.id,proves:provesCode('ci.yml',jobs.jobs)&&provesBoundaries(jobs.jobs)};
  };
  for(const branch of branches){
   const run=greenRun(commit,branch);
   if(run===null)continue;
   if(run.proves)return {run:run.id,branch,commit};
   if(branch!==releaseBranch)continue;
   const parent=releaseOnlyParent(cwd,commit,version);
   if(parent===null||!reachable(cwd,parent,'refs/remotes/origin/main'))continue;
   const main=greenRun(parent,'main');
   if(main?.proves)return {run:run.id,branch,commit,reused:main.id,parent};
  }
 }catch{/* Missing Git or Actions evidence requires the existing gate. */}
 return null;
}
