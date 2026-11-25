// A green docs-only verdict is never evidence that the code was tested.
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {pushSelection} from './push-selection.mjs';
import {provesCode} from './ci-proof-jobs.mjs';
import {provesBoundaries,releaseOnlyParent} from './release-gate.mjs';

const shaPattern=/^[a-f0-9]{40}$/u;
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const historyStep='Scan the complete incoming history';
const releaseRef=/^refs\/heads\/release\/(v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;

/** FAST-RELEASE FR6: what a release commit can still break is what reads its version or notes. These tests run in the
 * docs lane on a release branch that reused main's proof (scripts/changelog.mjs feeds the title screen through
 * vite.config.ts; whatsNew.ts and buildCheck.ts show it; scripts/app-build/versionFiles.ts writes version.json).
 * Job 1's `changelog.mjs check --at` runs before the verdict either way. test/ci-release-reuse.test.ts keeps this
 * list complete. */
export const RELEASE_READER_TESTS=Object.freeze([
 'src/client/engine/ui/build-row.test.ts',
 'test/bugbash-shard-select.test.ts',
 'test/build-identity.test.ts',
 'test/changelog.test.ts',
 'test/fp47b-engine-floor.test.ts',
 'test/npm-release-ci.test.ts',
 'test/save-whole-documents.test.ts',
 'test/staging-smoke-checks.test.ts',
 'test/staging-smoke-vision.test.ts',
 'test/version-json-describe.test.ts',
 'test/version-json-main-boot.test.ts',
]);

/** @param {readonly unknown[]} jobs */
function provesHistory(jobs){
 return jobs.some(job=>record(job)&&job.name==='tests (1)'&&job.status==='completed'&&job.conclusion==='success'
   &&Array.isArray(job.steps)&&job.steps.some(step=>record(step)&&step.name===historyStep&&step.status==='completed'&&step.conclusion==='success'));
}

/** The optimization fails closed on missing API evidence, incomplete jobs or history.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [cwd] @param {boolean} [historyOnly] */
export async function selectCI(env=process.env,cwd=process.cwd(),historyOnly=false){
 const sha=env.GITHUB_SHA??'',repo=env.GITHUB_REPOSITORY??'',token=env.GH_TOKEN;
 /** @param {string} reason */
 const full=reason=>({docs:false,base:null,tests:/** @type {string[]} */([]),reason});
 const event=historyOnly?'workflow_dispatch':'push';
 if(env.GITHUB_EVENT_NAME!==event||!shaPattern.test(sha)||!token||!/^[-\w.]+\/[-\w.]+$/u.test(repo))return full('No exact successful code proof; run full');
 const origin=env.GITHUB_API_URL??'https://api.github.com';
 /** @param {string} path @returns {Promise<unknown>} */
 const api=async path=>{
  const response=await fetch(`${origin}/repos/${repo}/${path}`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error('Actions proof lookup unavailable');
  return response.json();
 };
 /** @param {number} id */
 const jobsOf=async id=>{
  /** @type {unknown[]} */
  const jobs=[];
  for(let page=1;page<=20;page++){
   const raw=await api(`actions/runs/${id}/jobs?filter=latest&per_page=100&page=${page}`);
   if(!record(raw)||!Array.isArray(raw.jobs))throw new Error('Malformed code-proof jobs');
   jobs.push(...raw.jobs);
   if(raw.jobs.length<100)return jobs;
  }
  throw new Error('Incomplete code-proof job inventory');
 };
 try{
  // FR6: a release branch whose head only stamps the version and adds notes over a cut that main's ci proved (every
  // share and the boundaries ring, as the tag push asks) reruns nothing main already ran: the docs lane plus the release
  // readers. Anything else (a --pick, a cut without its own code-proving main run) falls through to the full suite.
  const version=historyOnly?undefined:releaseRef.exec(env.GITHUB_REF??'')?.[1];
  const parent=version===undefined?null:releaseOnlyParent(cwd,sha,version);
  if(parent!==null){
   const data=await api(`actions/workflows/ci.yml/runs?head_sha=${parent}&branch=main&event=push&status=success&per_page=20`);
   for(const run of record(data)&&Array.isArray(data.workflow_runs)?data.workflow_runs:[]){
    if(!record(run)||run.head_sha!==parent||run.head_branch!=='main'||run.event!=='push'||run.status!=='completed'||run.conclusion!=='success'||
       typeof run.id!=='number'||!Number.isSafeInteger(run.id)||!record(run.head_repository)||run.head_repository.full_name!==repo)continue;
    const jobs=await jobsOf(run.id);
    if(!provesCode('ci.yml',jobs)||!provesBoundaries(jobs))continue;
    return {docs:true,base:parent,tests:[...RELEASE_READER_TESTS],reason:`Release ${version} only stamps its version and notes over ${parent.slice(0,10)}, proved by main CI run ${run.id}; the docs lane runs the release readers`};
   }
  }
  const data=await api('actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100');
  if(!record(data)||!Array.isArray(data.workflow_runs))return full('Malformed Actions proof; run full');
  for(const run of data.workflow_runs){
   if(!record(run)||run.status!=='completed'||run.conclusion!=='success'||run.event!=='push'||typeof run.id!=='number'||!Number.isSafeInteger(run.id)||typeof run.head_sha!=='string'||!shaPattern.test(run.head_sha)||run.head_sha===sha)continue;
   try{execFileSync('git',['merge-base','--is-ancestor',run.head_sha,sha],{cwd,stdio:'pipe'});}catch{continue;}
   const jobs=await jobsOf(run.id);
   if(!provesCode('ci.yml',jobs))continue;
   if(historyOnly){
    if(!provesHistory(jobs))continue;
    return {...full(`History scanned by CI run ${run.id}`),base:run.head_sha};
   }
   const selected=pushSelection(`refs/heads/main ${sha} refs/heads/main ${run.head_sha}`,cwd,{hosted:true});
   // EV9: tests that read a changed doc's content run in the docs lane (scripts/ci-static.sh docs).
   return {docs:selected.mode==='docs',base:run.head_sha,tests:selected.mode==='docs'?selected.tests??[]:[],reason:`Compared with code-proving CI run ${run.id}: ${selected.reason}`};
  }
  return full('No successful code-proving ancestor in Actions history; run full');
 }catch{return full('Code-proof lookup unavailable; run full');}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const historyOnly=process.argv[2]==='--history-base';
 const result=await selectCI(process.env,process.cwd(),historyOnly);
 if(historyOnly)console.log(result.base??'');
 else{
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`docs=${String(result.docs)}\ncode_base=${result.base??''}\ndocs_tests=${result.tests.join(' ')}\n`);
  console.log(JSON.stringify(result));
 }
}
