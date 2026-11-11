// DEV-SPEED DS9 with J240: a plan lands on main by a fast-forward merge only
// after its branch's hosted CI is green. Pushing main then sends the exact
// SHA hosted CI already proved, so the main push reuses that hosted green
// instead of repeating local work. Anything uncertain returns null and the
// normal local gate runs.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {readLiftPending} from './lift-pending.mjs';
import {provesCode} from './ci-proof-jobs.mjs';

/** The hosted workflows a landing needs green, by workflow file. */
export const LANDING_WORKFLOWS=Object.freeze({ci:'.github/workflows/ci.yml'});

/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** @param {string} remote */
export function githubSlug(remote){
 const match=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([-\w.]+\/[-\w.]+?)(?:\.git)?\/?$/u.exec(remote.trim());
 return match?.[1]??null;
}

/** The newest push-event run of each landing workflow for exactly this SHA, decided.
 * Pull-request, dispatch (Ring 1 recording) and other workflows prove nothing here.
 * @param {unknown} data the Actions `runs?head_sha=` response
 * @param {string} sha */
export function landingVerdict(data,sha){
 const runs=record(data)&&Array.isArray(data.workflow_runs)?data.workflow_runs:[];
 /** @type {Record<string,{id:number,status:string,conclusion:string|null}>} */const latest={};
 for(const run of runs){
  if(!record(run)||run.head_sha!==sha||run.event!=='push'||typeof run.id!=='number'||typeof run.path!=='string')continue;
  const name=Object.entries(LANDING_WORKFLOWS).find(([,path])=>path===run.path)?.[0];
  if(name===undefined)continue;
  const current=latest[name];
  if(current===undefined||run.id>current.id)latest[name]={id:run.id,status:typeof run.status==='string'?run.status:'unknown',conclusion:typeof run.conclusion==='string'?run.conclusion:null};
 }
 const rows=Object.keys(LANDING_WORKFLOWS).map(name=>latest[name]);
 if(rows.some(run=>run===undefined||run.status!=='completed'))return {state:/** @type {const} */('pending'),runs:latest};
 if(rows.every(run=>run?.conclusion==='success'))return {state:/** @type {const} */('green'),runs:latest};
 return {state:/** @type {const} */('red'),runs:latest};
}

/** A docs-only `ci` run (static only) is not a code proof for skipping the local gate.
 * @param {unknown} data the Actions `runs/<id>/jobs` response */
export function codeProvingJobs(data){
 return provesCode('ci.yml',record(data)&&Array.isArray(data.jobs)?data.jobs:[]);
}

/** An expired lift-pending exclusion means newly blocking tests an older green never ran.
 * @param {string} root */
function exclusionsExpired(root){
 if(!existsSync(resolve(root,'test/lift-pending-policy.json')))return false;
 try{const pending=readLiftPending(root);return pending.files.length>0&&pending.excluded.length===0;}catch{return true;}
}

/** Hosted green for an exact SHA, or null (no gh, no runs, not green, any error).
 * @param {string} sha @param {string} remote
 * @param {(path:string)=>unknown} [api] @param {string} [root] */
export function hostedGreen(sha,remote,api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:15_000,stdio:['ignore','pipe','ignore']})),root=process.cwd()){
 const slug=githubSlug(remote);
 if(slug===null||!/^[a-f0-9]{40}$/u.test(sha))return null;
 try{
  if(exclusionsExpired(root))return null;
  const verdict=landingVerdict(api(`repos/${slug}/actions/runs?head_sha=${sha}&event=push&per_page=100`),sha);
  const ci=verdict.runs.ci;
  if(verdict.state!=='green'||ci===undefined)return null;
  if(!codeProvingJobs(api(`repos/${slug}/actions/runs/${ci.id}/jobs?filter=latest&per_page=100`)))return null;
  return verdict.runs;
 }catch{return null;}
}
