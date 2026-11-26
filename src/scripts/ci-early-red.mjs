// Early red (meta FLOW-SIMPLE FS24, J435): when a push reaches main while main's running `ci` run already has a
// failed blocking job, cancel that run so the pending run for the new push starts now.
//
//   node src/scripts/ci-early-red.mjs        decide from main's ci runs and cancel at most one (ci-early-red.yml runs this)
//
// Why: ci.yml's main group (CIQ1, J222) keeps the running run and replaces only the pending one. A run whose blocking
// job has failed is already red, yet it ran on for a median 8 min (p90 20) after that failure, and the fix behind it
// waited. Cancelling it changes no verdict: main-watch reads a started run cancelled with a blocking job failed as red,
// and the pending run covers every commit the cancelled one had. 26 h of main (2026-11-18 02:09 to 11-19 04:12 UTC,
// 281 push runs) replayed: verdicts 82 to 111, push to verdict median 31 to 21 min, a push made while main is red
// waited median 34 to 20 min, job minutes +2 %. Cancel-in-progress for every push instead gave 15 verdicts in 26 h.
// Only push runs on main: release refs and qualification dispatches (their own groups) are never touched.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {advisory} from './main-watch.mjs';

/** @typedef {{id:number,event:string,status:string,head_branch?:string,head_sha:string,created_at:string}} Run */
/** @typedef {{name:string,status:string,conclusion:string|null,steps?:readonly {name:string,conclusion:string|null}[],runner_id?:number|null}} Job */

/** A finished blocking job that failed: the run's verdict is already red, whatever its other jobs do. A job still
 * running is not counted, so the cancel never turns its failure into `cancelled`.
 * @param {Job} job */
export const failedBlocking=job=>job.status==='completed'&&['failure','timed_out','startup_failure'].includes(job.conclusion??'')&&!advisory(job);

/** The run to cancel, or null. Pure. `runs` is main's ci runs in any order; `jobsFor` reads one run's jobs.
 * @param {readonly Run[]} runs @param {(id:number)=>readonly Job[]} jobsFor
 * @returns {{cancel:number,newer:number,failed:string[]}|null} */
export function earlyRed(runs,jobsFor){
  const push=runs.filter(run=>run.event==='push'&&(run.head_branch===undefined||run.head_branch==='main'))
    .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id);
  const running=push.filter(run=>run.status==='in_progress');
  for(const run of running){
    const newer=push.find(row=>row.id>run.id&&row.status!=='completed'&&row.status!=='in_progress');
    if(newer===undefined)continue;
    const failed=jobsFor(run.id).filter(failedBlocking).map(job=>job.name);
    if(failed.length>0)return {cancel:run.id,newer:newer.id,failed};
  }
  return null;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const repo=process.env.GITHUB_REPOSITORY??'project-wildshard/engine';
  const gh=(/** @type {string[]} */args)=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','inherit'],timeout:60_000,maxBuffer:32<<20});
  const runs=/** @type {Run[]} */(JSON.parse(gh(['api',`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&per_page=30`])).workflow_runs);
  const decision=earlyRed(runs,id=>JSON.parse(gh(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs);
  if(decision===null){process.stdout.write('ci-early-red: no running main run is both red and behind a newer push\n');}
  else{
    gh(['api','-X','POST',`repos/${repo}/actions/runs/${decision.cancel}/cancel`]);
    process.stdout.write(`ci-early-red: cancelled run ${decision.cancel} (failed: ${decision.failed.join(' | ')}); pending run ${decision.newer} starts now\n`);
  }
}
