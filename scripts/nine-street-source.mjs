// NB6's advisory must observe its source run's exact client. Only a main
// run that reused an exact green plan may borrow that plan's artifact.
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {exactBranchProof} from './ci-exact-reuse.mjs';

/** @param {NodeJS.ProcessEnv} [env] */
export async function nineStreetSource(env=process.env){
 const repo=env.GITHUB_REPOSITORY??'',sha=env.SOURCE_SHA??'',run=Number(env.SOURCE_RUN);
 if(!/^[-\w.]+\/[-\w.]+$/u.test(repo)||!/^[a-f0-9]{40}$/u.test(sha)||!Number.isSafeInteger(run)||run<1||!env.GH_TOKEN)
  throw new Error('Nine street requires an exact source repository, SHA, run and read token');
 /** @param {number} id */
 const artifact=async id=>{
  const response=await fetch(`${env.GITHUB_API_URL??'https://api.github.com'}/repos/${repo}/actions/runs/${id}/artifacts?per_page=100`,
   {headers:{authorization:`Bearer ${env.GH_TOKEN}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new Error(`Nine source artifacts: HTTP ${response.status}`);
  /** @type {unknown} */const data=await response.json();
  if(data===null||typeof data!=='object'||!('artifacts'in data)||!Array.isArray(data.artifacts))throw new Error('Malformed Nine source artifacts');
  return data.artifacts.some(row=>row!==null&&typeof row==='object'&&row.name==='nine-ring1-client'&&row.expired===false);
 };
 if(await artifact(run))return{run,sha,artifact:true};
 const proof=await exactBranchProof('ci.yml',{...env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,GITHUB_RUN_ID:String(run)});
 if(proof.run!==null&&await artifact(proof.run))return{run:proof.run,sha,artifact:true};
 return{run,sha,artifact:false}; // docs-only and skipped producers have no observation
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await nineStreetSource();
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`run=${result.run}\nartifact=${result.artifact}\n`);
 console.log(JSON.stringify(result));
}
