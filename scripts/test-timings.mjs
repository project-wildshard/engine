// LAND-SIMPLIFY LS2 (J250, J258): measured seconds per test file are build output, never committed.
// Main's ci measures every planned file and saves the table to the Actions cache (`timings-<run id>`); each run
// restores the newest entry made before the run started, the same one in every job. With none, `fetch` rebuilds
// it from the newest earlier green run's engine-ci-* artifacts (7-day retention); only with neither does a
// reader fall back to defaults.
// A local checkout reads ~/.cache/wildshard/timings, filled by the same `fetch` (worktree new starts one).
// Node built-ins only: main's timings job runs this with no install.
//
//   node scripts/test-timings.mjs collect <artifact-dir>   merge a run's shard reports into the table
//   node scripts/test-timings.mjs pick --before=<ms>       name the main cache entry this run restores (CI)
//   node scripts/test-timings.mjs fetch [--if-stale] [--before=<ms>] [--strict]   rebuild from the newest green run
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const TIMINGS_FILE='timings.json';
/** The measured median file (1,255 Linux CI files, run 42966259441), for a file the table doesn't hold. */
export const DEFAULT_SECONDS=0.3;
/** How long a local table counts as fresh before worktree new refreshes it. */
export const LOCAL_MAX_AGE_MS=24*60*60*1000;

/** @typedef {{version:1,run:string,sha:string,measuredAt:number,full:Record<string,number>,ring1:Record<string,number>}} Timings */

/** Where the table lives: WS_TIMINGS_DIR, else tmp/timings on CI, else the machine's cache.
 * @param {NodeJS.ProcessEnv} [env] */
export function timingsDir(env=process.env){
  if(env.WS_TIMINGS_DIR)return resolve(env.WS_TIMINGS_DIR);
  return env.GITHUB_ACTIONS?resolve('tmp/timings'):resolve(homedir(),'.cache/wildshard/timings');
}

/** @param {unknown} value @returns {value is Record<string,number>} */
const weightTable=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.values(value).every(seconds=>typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0);

/** The table, or null when it is missing or not a valid table.
 * @param {NodeJS.ProcessEnv} [env] @returns {Timings|null} */
export function readTimings(env=process.env){
  const file=join(timingsDir(env),TIMINGS_FILE);
  if(!existsSync(file))return null;
  try{
    const value=JSON.parse(readFileSync(file,'utf8'));
    if(value?.version!==1||typeof value.run!=='string'||typeof value.sha!=='string'||!weightTable(value.full)||!weightTable(value.ring1))return null;
    return /** @type {Timings} */(value);
  }catch{return null;}
}

/** Seconds per file for a ring; empty when there is no table.
 * @param {'full'|'1'} [ring] @param {NodeJS.ProcessEnv} [env] @returns {Record<string,number>} */
export function readWeights(ring='full',env=process.env){
  return readTimings(env)?.[ring==='1'?'ring1':'full']??{};
}

/** @param {Timings} timings @param {NodeJS.ProcessEnv} [env] */
export function writeTimings(timings,env=process.env){
  const file=join(timingsDir(env),TIMINGS_FILE);mkdirSync(dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;writeFileSync(temporary,`${JSON.stringify(timings,null,1)}\n`);renameSync(temporary,file);
  return file;
}

/** @param {string} directory @returns {string[]} */
const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const path=join(directory,entry.name);
  return entry.isDirectory()?walk(path):[path];
});

/** Merge one run's shard reports (engine-ci-budget/2) into the previous table. A passed file takes its
 * measured seconds; a file the run's plan holds but didn't measure keeps its old value; a file outside
 * the plan's inventory leaves the ring.
 * @param {Timings|null} previous @param {string} directory a run's downloaded engine-ci-* artifacts
 * @returns {{timings:Timings,measured:number}|null} null when the directory holds no plan */
export function collectTimings(previous,directory){
  const files=existsSync(directory)?walk(directory):[];
  const planFile=files.find(path=>path.endsWith('/engine-ci/plan.json'));
  if(planFile===undefined)return null;
  const plan=JSON.parse(readFileSync(planFile,'utf8'));
  const key=plan.ring==='1'?'ring1':'full',inventory=new Set(/** @type {string[]} */(plan.files));
  /** @type {Record<string,number>} */const measured={};
  let run='',measuredAt=0;
  for(const path of files.filter(name=>/\/engine-ci\/shard-\d+-(?:native|ordinary)\.json$/u.test(name))){
    const report=JSON.parse(readFileSync(path,'utf8'));
    if(report?.schema!=='engine-ci-budget/2'||!Array.isArray(report.files))continue;
    run=String(report.run??run);measuredAt=Math.max(measuredAt,Number(report.endedAt)||0);
    for(const row of report.files)if(row?.state==='passed'&&typeof row.durationMs==='number'&&inventory.has(row.file))measured[row.file]=Math.round(row.durationMs)/1000;
  }
  const old=previous?.[key]??{},next=/** @type {Record<string,number>} */({});
  for(const file of [...inventory].sort()){const seconds=measured[file]??old[file];if(seconds!==undefined)next[file]=seconds;}
  /** @type {Timings} */const base=previous??{version:1,run:'',sha:'',measuredAt:0,full:{},ring1:{}};
  return {timings:{...base,run:run||base.run,sha:String(plan.sha),measuredAt:measuredAt||Date.now(),[key]:next},measured:Object.keys(measured).length};
}

/** @param {NodeJS.ProcessEnv} env @returns {(args:string[])=>string} */
const ghCli=env=>args=>execFileSync('gh',args,{encoding:'utf8',env,stdio:['ignore','pipe','pipe'],timeout:60_000,maxBuffer:16<<20});

/** The newest main `timings-*` cache entry created before `before` (the run's start, ms). Every packed job of a run
 * restores this exact key, so they all plan from one table: jobs that planned from different tables would
 * pack different shards and skip files while staying green (J206 review). An API failure throws.
 * @param {number} before @param {NodeJS.ProcessEnv} [env] @param {string} [repo] @returns {string|null} */
export function pickCache(before,env=process.env,repo=env.WS_TIMINGS_REPO??'project-wildshard/engine'){
  const rows=JSON.parse(ghCli(env)(['api',`repos/${repo}/actions/caches?key=timings-&ref=refs/heads/main&sort=created_at&direction=desc&per_page=50`])).actions_caches;
  const pick=/** @type {{key:string,created_at:string}[]} */(rows).find(row=>row.key.startsWith('timings-')&&Date.parse(row.created_at)<before);
  return pick?.key??null;
}

/** Rebuild the table from the newest green ci run created before `before` that kept its engine-ci-* artifacts, on
 * main or a plan branch (a main push that reused its branch run uploads none). `strict` (CI) throws on an API
 * failure rather than skip to an older run, so every job of a run lands on the same one.
 * @param {NodeJS.ProcessEnv} [env] @param {{before?:number,strict?:boolean,repo?:string}} [options] @returns {string|null} the run used */
export function fetchTimings(env=process.env,options={}){
  const gh=ghCli(env),repo=options.repo??env.WS_TIMINGS_REPO??'project-wildshard/engine',before=options.before??Date.now();
  /** @type {{databaseId:number,createdAt:string}[]} */let runs;
  try{runs=JSON.parse(gh(['run','list','-R',repo,'--workflow','ci.yml','--event','push','--status','success','-L','40','--json','databaseId,createdAt']));}
  catch(error){if(options.strict)throw error;return null;}
  const scratch=resolve(env.GITHUB_ACTIONS?'tmp':join(homedir(),'.cache/wildshard'),'timings-fetch');mkdirSync(scratch,{recursive:true});
  for(const {databaseId:id} of runs.filter(row=>Date.parse(row.createdAt)<before)){
    try{
      const listed=JSON.parse(gh(['api',`repos/${repo}/actions/runs/${id}/artifacts?per_page=100`])).artifacts;
      if(!/** @type {{name:string,expired:boolean}[]} */(listed).some(row=>row.name.startsWith('engine-ci-')&&!row.expired))continue;
    }catch(error){if(options.strict)throw error;continue;}
    const work=mkdtempSync(join(scratch,`${id}-`));
    try{
      try{gh(['run','download',String(id),'-R',repo,'-p','engine-ci-*','-D',work]);}catch(error){if(options.strict)throw error;continue;}
      const result=collectTimings(null,work);
      if(result===null||result.measured===0)continue;
      writeTimings(result.timings,env);return String(id);
    }finally{rmSync(work,{recursive:true,force:true});}
  }
  return null;
}

/** True when the local table is missing or older than a day. @param {NodeJS.ProcessEnv} [env] */
export function timingsStale(env=process.env){
  const file=join(timingsDir(env),TIMINGS_FILE);
  return !existsSync(file)||Date.now()-statSync(file).mtimeMs>LOCAL_MAX_AGE_MS;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [command,directory]=process.argv.slice(2);
  const arg=(/** @type {string} */name)=>process.argv.find(row=>row.startsWith(`--${name}=`))?.slice(name.length+3);
  const output=(/** @type {string} */line)=>{if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,`${line}\n`,{flag:'a'});};
  if(command==='collect'&&directory!==undefined){
    const result=collectTimings(readTimings(),resolve(directory));
    if(result===null||result.measured===0){console.log('test-timings: no measured shard reports; table unchanged');output('measured=false');}
    else{const file=writeTimings(result.timings);console.log(`test-timings: ${result.measured} files measured by run ${result.timings.run}; ${file}`);output('measured=true');}
  }else if(command==='fetch'&&process.argv.includes('--if-stale')&&!timingsStale()){
    console.log('test-timings: the local table is under a day old');
  }else if(command==='pick'){
    const key=pickCache(Number(arg('before')??Date.now()));
    console.log(`test-timings: ${key===null?'no main timings cache before this run':`restoring ${key}`}`);output(`key=${key??''}`);
  }else if(command==='fetch'){
    const before=arg('before');
    const run=fetchTimings(process.env,{strict:process.argv.includes('--strict'),...(before===undefined?{}:{before:Number(before)})});
    if(run===null)console.log('test-timings: no green ci run with engine-ci artifacts; readers use defaults');
    else console.log(`test-timings: rebuilt from run ${run}; ${join(timingsDir(),TIMINGS_FILE)}`);
  }else{console.error('Usage: test-timings.mjs collect <artifact-dir> | pick --before=<ms> | fetch [--if-stale] [--before=<ms>] [--strict]');process.exitCode=2;}
}
