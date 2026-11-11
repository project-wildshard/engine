// CI-JOB-PACKING (J244): run one packed job's share of a push's CI work.
//
//   node scripts/ci-pack.mjs --jobs=<N> --job=<i> [--concurrency=<C>] [--units=static,e2e,plan-proofs,tests,products,boundaries]
//   node scripts/ci-pack.mjs --check-walls --job=<i>   after the artifact upload: every shard's charged wall, once more
//
// Every packed job of a run computes the same assignment: the same plan (scripts/engine-ci-plan.ts, already written to
// WS_CI_PLAN, its exclusions judged at the run's start) and the same longest-first packing of its units over N jobs,
// so no planning job has to run first. A unit is one of:
//   static      scripts/ci-static.sh (CI_STATIC_MODE, default code); runs before `pnpm pins`, as it installs its own few pins
//   e2e         the Playwright smoke, the title-layout proof and J245's settings-tabs proof (needs no pins)
//   plan-proofs the planner's own proofs (membership, order, module cache, CPU census, budget refusal, shard wall)
//   shard:<k>   one planned test shard: exact membership, the 60 s file budget, and the five-minute shard wall (J193)
//   quarantine  every active quarantined file, non-blocking (J193/J200); ci.yml runs it as its own job instead
//   products    Ring 1's cook-step, build and boot; it replaces the full pins with Ring 1's, so it runs after the shards
//   boundaries  engine-boundaries' push half, cook-to-play on Ring 1's products: report-only (J186), so non-blocking,
//               and always in the job that runs products
// Phases run in order: before pins (up to C units at once), `pnpm pins && pnpm gen:inputs`, the shards ONE AT A TIME,
// then products and boundaries. A shard has the runner to itself, as its plan assumes: two at once on the 4-vCPU runner
// pushed four files past the 60 s cap and failed a timing proof (run 42955579476, CI-JOB-PACKING-PLAN).
// A shard's wall is charged its job's shared set-up (job start to ci-pack, plus pins), as when it was a job of its own;
// work that belongs to other units isn't charged to it. Each unit's output goes to tmp/ci-pack/logs/<unit>.log and is
// printed, grouped, when it ends. The job's report (units, seconds, exit codes, CPU busy share, peak memory) is
// tmp/ci-pack/job-<i>.json. With GITHUB_OUTPUT set, `products=true` says this job ran Ring 1's products.
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync,mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {cpus,totalmem} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Seconds a unit takes alone on the hosted runner (spikes 42953892606 and 42955579476); only the packing reads them. */
export const UNIT_SECONDS=Object.freeze({static:180,e2e:20,'plan-proofs':30,quarantine:135,products:230,boundaries:60});
const PHASE=Object.freeze({static:0,e2e:0,'plan-proofs':0,quarantine:2,products:3,boundaries:4});
/** Units that go wherever another unit went, after it (they need its state), instead of being balanced on their own. */
const FOLLOWS=Object.freeze(/** @type {Record<string,string>} */({boundaries:'products'}));
const NONBLOCKING=new Set(['quarantine','boundaries']);
const SHARD_LIMIT_MS=300_000;
/** @typedef {{name:string,phase:number,seconds:number,blocking:boolean}} Unit */
/** @typedef {{name:string,phase:number,blocking:boolean,started:number,charged:number,ended:number,seconds:number,code:number}} UnitResult */

/** The units a run has, from its plan's shard count and the kinds asked for.
 * @param {number} shards @param {readonly string[]} kinds @param {(index:number)=>number} [shardSeconds] @returns {Unit[]} */
export function runUnits(shards,kinds,shardSeconds=()=>120){
  /** @type {Unit[]} */const units=[];
  for(const kind of kinds){
    if(kind==='tests'){for(let index=1;index<=shards;index++)units.push({name:`shard:${index}`,phase:2,seconds:shardSeconds(index),blocking:true});continue;}
    if(!Object.hasOwn(UNIT_SECONDS,kind))throw new Error(`Unknown CI unit kind ${kind}`);
    const key=/** @type {keyof typeof UNIT_SECONDS} */(kind);
    units.push({name:kind,phase:PHASE[key],seconds:UNIT_SECONDS[key],blocking:!NONBLOCKING.has(kind)});
  }
  return units;
}

/** Longest first onto the least-loaded job; ties go to the lower job, so every job computes the same answer.
 * A following unit joins its leader's job (or the least-loaded one if its leader isn't in the run).
 * @param {readonly Unit[]} units @param {number} jobs @returns {Unit[][]} */
export function packUnits(units,jobs){
  if(!Number.isSafeInteger(jobs)||jobs<1)throw new Error('Invalid packed job count');
  /** @type {Unit[][]} */const bins=Array.from({length:jobs},()=>[]);const load=Array.from({length:jobs},()=>0);
  const byName=(/** @type {Unit} */a,/** @type {Unit} */b)=>a.name.localeCompare(b.name,'en',{numeric:true});
  const least=()=>{let best=0;for(let index=1;index<jobs;index++)if((load[index]??0)<(load[best]??0))best=index;return best;};
  // A leader is balanced with its followers' seconds, so the job that takes both isn't the long one.
  const weight=(/** @type {Unit} */unit)=>unit.seconds+units.filter(row=>FOLLOWS[row.name]===unit.name).reduce((sum,row)=>sum+row.seconds,0);
  const order=[...units].filter(unit=>FOLLOWS[unit.name]===undefined).sort((a,b)=>weight(b)-weight(a)||byName(a,b));
  for(const unit of order){const best=least();bins[best]?.push(unit);load[best]=(load[best]??0)+weight(unit);}
  for(const unit of units.filter(row=>FOLLOWS[row.name]!==undefined)){
    const leader=bins.findIndex(bin=>bin.some(row=>row.name===FOLLOWS[unit.name])),at=leader===-1?least():leader;
    bins[at]?.push(unit);if(leader===-1)load[at]=(load[at]??0)+unit.seconds;
  }
  return bins.map(bin=>bin.sort((a,b)=>a.phase-b.phase||b.seconds-a.seconds||byName(a,b)));
}

/** The command a unit runs. @param {Unit} unit @param {number} charged the shard wall's start @returns {{command:string[],env:NodeJS.ProcessEnv}} */
function commandOf(unit,charged){
  // scripts/heavy-lane.py admits one full-test per machine, for a shared Mac. A hosted job is its own VM, so each unit
  // gets its own lane scheduler (shards still run one at a time, by this runner, not by a lock).
  /** @type {NodeJS.ProcessEnv} */
  const env={...process.env,WS_HEAVY_SCHEDULER_ROOT:resolve('tmp/ci-pack/lanes',unit.name.replace(':','-'))};
  if(unit.name.startsWith('shard:')){
    env.WS_CI_SHARD=unit.name.slice(6);env.WS_CI_SHARD_STARTED_MS=String(charged);
    return {command:['bash','-c','node scripts/ci-shard-wall.mjs -- node scripts/engine-ci-shard.mjs; code=$?; node scripts/ci-shard-wall.mjs --check || code=1; exit $code'],env};
  }
  if(unit.name==='static')return {command:['bash','scripts/ci-static.sh',process.env.CI_STATIC_MODE??'code'],env};
  if(unit.name==='e2e')return {command:['bash','-c','pnpm exec playwright install --with-deps --only-shell chromium && pnpm test:e2e && node --test test/title-layout-browser.proof.mjs test/settings-tabs-browser.proof.mjs'],env};
  if(unit.name==='plan-proofs')return {command:['bash','-c',['node scripts/engine-ci-membership-proof.ts','node scripts/engine-order-proof.mjs','node scripts/module-cache-proof.mjs',
    'python3 scripts/cpu-census-proof.py','node scripts/engine-ci-proof.mjs','node scripts/engine-ci-proof.mjs tmp/engine-ci-budget-proof --import','node scripts/ci-shard-wall-proof.mjs'].join(' && ')],env};
  if(unit.name==='quarantine')return {command:['node','scripts/test-quarantine.mjs','--shard=1/1'],env};
  // BROWSER-TESTS-BENCH BB2 (J231): Chromium installs in the background while Ring 1 cooks and builds.
  if(unit.name==='products')return {command:['bash','-c','bash scripts/ci-browser.sh start && bash scripts/ring1.sh cook-step && bash scripts/ring1.sh build && bash scripts/ci-browser.sh wait && bash scripts/ring1.sh boot'],env};
  if(unit.name==='boundaries')return {command:['bash','-c','node scripts/pins.ts install --ring 1 && pnpm gen:inputs && node scripts/cook-to-play.mjs --out=tmp/engine-boundaries'],env};
  throw new Error(`No command for ${unit.name}`);
}

/** Busy share of all CPUs and used memory, sampled from /proc every two seconds (Linux runners; empty elsewhere). */
function sampler(){
  /** @type {{at:number,busy:number,usedMb:number}[]} */
  const samples=[];
  /** @type {{idle:number,total:number}|null} */
  let last=null;
  const read=()=>{
    if(!existsSync('/proc/stat'))return;
    const cpu=(readFileSync('/proc/stat','utf8').split('\n')[0]??'').trim().split(/\s+/u).slice(1).map(Number);
    const idle=(cpu[3]??0)+(cpu[4]??0),total=cpu.reduce((sum,value)=>sum+value,0);
    const mem=Object.fromEntries(readFileSync('/proc/meminfo','utf8').split('\n').map(line=>/^(\w+):\s+(\d+)/u.exec(line)).filter(match=>match!==null).map(match=>[match[1],Number(match[2])]));
    if(last!==null&&total>last.total)samples.push({at:Date.now(),busy:1-(idle-last.idle)/(total-last.total),usedMb:Math.round(((mem.MemTotal??0)-(mem.MemAvailable??0))/1024)});
    last={idle,total};
  };
  read();const timer=setInterval(read,2000);timer.unref();
  return {samples,stop:()=>clearInterval(timer)};
}

/** @param {Unit} unit @param {string} logs @param {number} setupMs shared set-up charged to a shard's wall @returns {Promise<UnitResult>} */
function runUnit(unit,logs,setupMs){
  const started=Date.now(),charged=started-setupMs;
  const {command,env}=commandOf(unit,charged),file=resolve(logs,`${unit.name.replace(':','-')}.log`),out=createWriteStream(file);
  return new Promise(_resolve=>{
    const [bin='',...args]=command;
    const child=spawn(bin,args,{env,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
    const finish=(/** @type {number} */code)=>{
      out.end(()=>{
        const ended=Date.now(),seconds=(ended-started)/1000;
        console.log(`::group::${unit.name} ${code===0?'green':'RED'} in ${seconds.toFixed(0)} s`);
        process.stdout.write(readFileSync(file,'utf8'));console.log('::endgroup::');
        if(code!==0)console.log(`::${unit.blocking?'error':'warning'} title=${unit.name}::${unit.blocking?'':'non-blocking '}unit exited ${code} after ${seconds.toFixed(0)} s; log in this job's group`);
        _resolve({name:unit.name,phase:unit.phase,blocking:unit.blocking,started,charged,ended,seconds,code});
      });
    };
    child.once('error',()=>finish(127));child.once('exit',(code,signal)=>finish(signal===null?code??1:1));
  });
}

/** Runs units C at a time. @param {readonly Unit[]} units @param {number} concurrency @param {string} logs @param {number} setupMs @returns {Promise<UnitResult[]>} */
async function runPhase(units,concurrency,logs,setupMs){
  /** @type {UnitResult[]} */
  const results=[];
  const queue=[...units];
  const lane=async()=>{for(let unit=queue.shift();unit!==undefined;unit=queue.shift())results.push(await runUnit(unit,logs,setupMs));};
  await Promise.all(Array.from({length:Math.min(concurrency,units.length)},lane));
  return results;
}

/** @param {string[]} command @returns {Promise<number>} */
function step(command){
  const [bin='',...args]=command;
  return new Promise(_resolve=>{const child=spawn(bin,args,{stdio:'inherit'});child.once('error',()=>_resolve(127));child.once('exit',code=>_resolve(code??1));});
}

/** J193 after the upload: each shard's charged wall plus everything since the pack ended, as the old last step did.
 * @param {number} job @param {number} [now] */
export function checkWalls(job,now=Date.now()){
  /** @type {{ended:number,units:UnitResult[]}} */const report=JSON.parse(readFileSync(`tmp/ci-pack/job-${job}.json`,'utf8'));
  const over=report.units.filter(unit=>unit.name.startsWith('shard:')).map(unit=>({name:unit.name,ms:unit.ended-unit.charged+(now-report.ended)})).filter(row=>row.ms>=SHARD_LIMIT_MS);
  for(const row of over)console.error(`::error file=scripts/ci-pack.mjs,title=CI_SHARD_BUDGET_EXCEEDED::${row.name} used ${row.ms} ms against ${SHARD_LIMIT_MS} ms, its job's set-up and the artifact upload included`);
  return over.length===0;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const arg=(/** @type {string} */name,/** @type {string} */fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
  const job=Number(arg('job','1'));
  if(process.argv.includes('--check-walls')){process.exitCode=checkWalls(job)?0:1;}
  else{
    const jobs=Number(arg('jobs','1')),concurrency=Number(arg('concurrency','2'));
    if(!Number.isSafeInteger(job)||job<1||job>jobs||!Number.isSafeInteger(concurrency)||concurrency<1)throw new Error('Invalid --job or --concurrency');
    const kinds=arg('units','static,e2e,plan-proofs,tests').split(',').filter(Boolean);
    const planFile=process.env.WS_CI_PLAN??'tmp/engine-ci/plan.json';
    /** @type {{setupSeconds:number,factor:number,shards:{index:number,expectedSeconds:number}[]}} */const plan=kinds.includes('tests')?JSON.parse(readFileSync(planFile,'utf8')):{setupSeconds:0,factor:1,shards:[]};
    const mine=packUnits(runUnits(plan.shards.length,kinds,index=>((plan.shards[index-1]?.expectedSeconds??190)-plan.setupSeconds)/plan.factor),jobs)[job-1]??[];
    const logs=resolve('tmp/ci-pack/logs');mkdirSync(logs,{recursive:true});
    console.log(`ci-pack: job ${job} of ${jobs}, ${cpus().length} CPUs, ${Math.round(totalmem()/2**20)} MB: ${mine.map(unit=>unit.name).join(' ')}`);
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`products=${String(mine.some(unit=>unit.name==='products'))}\n`);
    const began=Date.now(),probe=sampler(),jobStart=Number(process.env.WS_CI_SHARD_STARTED_MS??began);
    let setupMs=Number.isSafeInteger(jobStart)&&jobStart>0&&jobStart<=began?began-jobStart:0;
    /** @type {UnitResult[]} */
    const results=[];
    /** @type {{phase:string,started:number,ended:number}[]} */
    const phases=[];
    const timed=async(/** @type {string} */phase,/** @type {()=>Promise<void>} */work)=>{const started=Date.now();await work();phases.push({phase,started,ended:Date.now()});};
    await timed('before-pins',async()=>{results.push(...await runPhase(mine.filter(unit=>unit.phase===0),concurrency,logs,0));});
    let pinsCode=0;
    if(mine.some(unit=>unit.phase>=2))await timed('pins',async()=>{const started=Date.now();pinsCode=await step(['bash','-c','pnpm pins && pnpm gen:inputs']);setupMs+=Date.now()-started;});
    if(pinsCode!==0)console.log('::error title=pins::pnpm pins && pnpm gen:inputs failed; no test unit ran');
    else{
      await timed('tests',async()=>{results.push(...await runPhase(mine.filter(unit=>unit.phase===2),1,logs,setupMs));});
      for(const phase of [3,4])await timed(phase===3?'products':'boundaries',async()=>{results.push(...await runPhase(mine.filter(unit=>unit.phase===phase),1,logs,0));});
    }
    probe.stop();
    const busy=probe.samples.map(sample=>sample.busy),red=results.filter(result=>result.blocking&&result.code!==0),ended=Date.now();
    const report={job,jobs,concurrency,cpus:cpus().length,memMb:Math.round(totalmem()/2**20),seconds:(ended-began)/1000,setupMs,ended,
      cpuBusy:busy.length===0?null:busy.reduce((sum,value)=>sum+value,0)/busy.length,memPeakMb:Math.max(0,...probe.samples.map(sample=>sample.usedMb)),
      pinsCode,phases,units:results,samples:probe.samples};
    mkdirSync('tmp/ci-pack',{recursive:true});writeFileSync(`tmp/ci-pack/job-${job}.json`,`${JSON.stringify(report)}\n`);
    const table=['| unit | seconds | exit |','|---|---:|---:|',...results.map(result=>`| ${result.name} | ${result.seconds.toFixed(0)} | ${result.code}${result.blocking?'':' (non-blocking)'} |`)].join('\n');
    const line=`ci-pack job ${job}/${jobs}: ${report.seconds.toFixed(0)} s, CPU busy ${report.cpuBusy===null?'n/a':`${(report.cpuBusy*100).toFixed(0)} %`}, peak ${report.memPeakMb} MB of ${report.memMb}`;
    console.log(line);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### ${line}\n\n${table}\n`);
    process.exitCode=pinsCode!==0||red.length>0?1:0;
  }
}
