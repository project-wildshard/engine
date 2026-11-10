// J240: a plan lands by fast-forwarding main to the exact SHA its branch CI
// proved (scripts/land.mjs). The main push of that SHA must not run the same
// workflow twice: when this workflow already ran in full and green on a
// plan/<slug> push of this exact SHA, main's run reuses it and skips its jobs.
// Same SHA, same tree, same workflow file. Anything uncertain (no token, API
// error, a docs-only or partial branch run, an exclusion that expired since,
// a rebased SHA nobody ran) fails closed and the run goes ahead in full.
import {appendFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readLiftPending} from './lift-pending.mjs';
import {activeQuarantineFiles} from './test-quarantine.mjs';

const shaPattern=/^[a-f0-9]{40}$/u,planBranch=/^plan\/[a-z0-9][a-z0-9._-]*$/u;
/** The jobs a branch run must have actually passed, beyond its `tests (N)` matrix. */
export const REQUIRED_JOBS=Object.freeze(/** @type {Record<string,readonly string[]>} */({'ci.yml':['changes','static','plan','e2e'],'ring-1.yml':['static','plan','cook-step','build-boot']}));
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Which tests the blocking suite excluded at a time: J200 quarantine and lift-pending.
 * A reuse is valid only if this is the same now as when the branch run started.
 * @param {number} at @param {string} [cwd] */
export function exclusionScope(at,cwd=process.cwd()){
 const lift=existsSync(resolve(cwd,'test/lift-pending-policy.json'))?readLiftPending(cwd,at).excluded:[];
 return JSON.stringify({quarantine:[...activeQuarantineFiles(at)].sort(),lift:[...lift].sort()});
}

/** @param {string} workflow e.g. `ci.yml` @param {NodeJS.ProcessEnv} [env]
 * @param {{scope?:(at:number)=>string,now?:number}} [options]
 * @returns {Promise<{reused:boolean,run:number|null,reason:string}>} */
export async function exactBranchProof(workflow,env=process.env,options={}){
 const sha=env.GITHUB_SHA??'',repo=env.GITHUB_REPOSITORY??'',token=env.GH_TOKEN,self=Number(env.GITHUB_RUN_ID);
 const scope=options.scope??(at=>exclusionScope(at)),now=options.now??Date.now();
 /** @param {string} reason */
 const full=reason=>({reused:false,run:null,reason});
 const required=REQUIRED_JOBS[workflow];
 if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main')return full('Not a main push; run in full');
 if(!shaPattern.test(sha)||!token||!/^[-\w.]+\/[-\w.]+$/u.test(repo)||required===undefined)return full('No exact proof inputs; run in full');
 const origin=env.GITHUB_API_URL??'https://api.github.com';
 /** @param {string} path @returns {Promise<unknown>} */
 const api=async path=>{
  const response=await fetch(`${origin}/repos/${repo}/${path}`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`Actions lookup HTTP ${response.status}`);
  return response.json();
 };
 try{
  const data=await api(`actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&status=success&per_page=100`);
  if(!record(data)||!Array.isArray(data.workflow_runs))return full('Malformed Actions response; run in full');
  for(const run of data.workflow_runs){
   if(!record(run)||run.head_sha!==sha||run.event!=='push'||run.status!=='completed'||run.conclusion!=='success'||typeof run.id!=='number'||run.id===self)continue;
   if(typeof run.head_branch!=='string'||!planBranch.test(run.head_branch))continue;
   if(!record(run.head_repository)||run.head_repository.full_name!==repo)continue;
   // A green aggregate is not a proof that the blocking jobs ran: a docs-only
   // or skip-propagated run is green too. Require each one, latest attempt.
   const raw=await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
   if(!record(raw)||!Array.isArray(raw.jobs)||raw.jobs.length>=100)continue;
   const jobs=raw.jobs.filter(record);
   const passed=(/** @type {string} */ name)=>jobs.some(job=>job.name===name&&job.status==='completed'&&job.conclusion==='success');
   const tests=jobs.filter(job=>typeof job.name==='string'&&/^tests(?: \(.+\))?$/u.test(job.name));
   if(!required.every(passed)||tests.length===0||tests.some(job=>job.status!=='completed'||job.conclusion!=='success'))continue;
   const stamp=typeof run.run_started_at==='string'?run.run_started_at:typeof run.created_at==='string'?run.created_at:'',started=Date.parse(stamp);
   if(!Number.isFinite(started))continue;
   if(scope(started)!==scope(now))return full(`${workflow} run ${run.id} predates a quarantine or lift-pending change in what the suite excludes; run in full`);
   return {reused:true,run:run.id,reason:`${workflow} run ${run.id} on ${run.head_branch} ran every blocking job green for exactly ${sha}; main reuses it (J240)`};
  }
  return full('No complete green plan-branch run of this exact SHA; run in full');
 }catch(error){return full(`Actions lookup unavailable (${error instanceof Error?error.message:'error'}); run in full`);}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await exactBranchProof(process.argv[2]??'');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`reused=${String(result.reused)}\nrun=${result.run??''}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### ${result.reused?'Reused':'Not reused'}: ${result.reason}\n`);
 console.log(JSON.stringify(result));
}
