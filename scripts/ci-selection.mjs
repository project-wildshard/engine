// A green docs-only verdict is never evidence that the code was tested.
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {pushSelection} from './push-selection.mjs';

const shaPattern=/^[a-f0-9]{40}$/u;
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** The optimization fails closed on missing API evidence, incomplete jobs or history.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [cwd] */
export async function selectCI(env=process.env,cwd=process.cwd()){
 const sha=env.GITHUB_SHA??'',repo=env.GITHUB_REPOSITORY??'',token=env.GH_TOKEN;
 /** @param {string} reason */
 const full=reason=>({docs:false,base:null,reason});
 if(env.GITHUB_EVENT_NAME!=='push'||!shaPattern.test(sha)||!token||!/^[-\w.]+\/[-\w.]+$/u.test(repo))return full('No exact successful code proof; run full');
 const origin=env.GITHUB_API_URL??'https://api.github.com';
 /** @param {string} path @returns {Promise<unknown>} */
 const api=async path=>{
  const response=await fetch(`${origin}/repos/${repo}/${path}`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error('Actions proof lookup unavailable');
  return response.json();
 };
 try{
  const data=await api('actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100');
  if(!record(data)||!Array.isArray(data.workflow_runs))return full('Malformed Actions proof; run full');
  for(const run of data.workflow_runs){
   if(!record(run)||run.status!=='completed'||run.conclusion!=='success'||run.event!=='push'||typeof run.id!=='number'||!Number.isSafeInteger(run.id)||typeof run.head_sha!=='string'||!shaPattern.test(run.head_sha)||run.head_sha===sha)continue;
   try{execFileSync('git',['merge-base','--is-ancestor',run.head_sha,sha],{cwd,stdio:'pipe'});}catch{continue;}
   /** @type {unknown[]} */
   const jobs=[];
   for(let page=1;page<=20;page++){
    const raw=await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`);
    if(!record(raw)||!Array.isArray(raw.jobs))throw new Error('Malformed code-proof jobs');
    jobs.push(...raw.jobs);
    if(raw.jobs.length<100)break;
    if(page===20)throw new Error('Incomplete code-proof job inventory');
   }
   /** @param {string} name */
   const passed=name=>jobs.some(job=>record(job)&&job.name===name&&job.status==='completed'&&job.conclusion==='success');
   const tests=jobs.filter(job=>record(job)&&typeof job.name==='string'&&/^tests(?: \(.+\))?$/u.test(job.name));
   if(!['changes','static','plan','e2e'].every(passed)||tests.length===0||tests.some(job=>!record(job)||job.status!=='completed'||job.conclusion!=='success'))continue;
   const selected=pushSelection(`refs/heads/main ${sha} refs/heads/main ${run.head_sha}`,cwd);
   return {docs:selected.mode==='docs',base:run.head_sha,reason:`Compared with code-proving CI run ${run.id}: ${selected.reason}`};
  }
  return full('No successful code-proving ancestor in Actions history; run full');
 }catch{return full('Code-proof lookup unavailable; run full');}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await selectCI();
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`docs=${String(result.docs)}\ncode_base=${result.base??''}\n`);
 console.log(JSON.stringify(result));
}
