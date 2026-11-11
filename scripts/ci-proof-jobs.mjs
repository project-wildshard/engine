// CI-JOB-PACKING (J244): which jobs of a ci run prove that it tested code. A run proves code only when every job
// of one whole shape passed. Runs from before the packing still count, as do the packed ones:
//   packed  every `tests (N)` share passed AND ran its step "Run this job's packed share" (static, e2e, the plan
//           proofs, every shard and Ring 1's products run inside those); a reused or docs-only share skips that step
//   before  changes, static, plan, e2e and every `tests (N)` shard
// A docs-only or skip-propagated run is green too, so a skipped job or step never stands in for a passed one.

/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const TESTS=/^tests(?: \(.+\))?$/u;

/** Each workflow's accepted shapes: named jobs that must pass, and whether a `tests (N)` matrix must too. */
export const PROOF_SHAPES=Object.freeze(/** @type {Record<string,readonly {jobs:readonly string[],tests:boolean}[]>} */({
  'ci.yml':[{jobs:[],tests:true},{jobs:['changes','static','plan','e2e'],tests:true}],
}));
/** The step every packed share runs when it tests code. */
export const PACKED_STEP="Run this job's packed share";
/** Job names a packed run never has: if one appears, the run is the older shape and is judged as that. */
const LEGACY=Object.freeze(/** @type {Record<string,readonly string[]>} */({'ci.yml':['changes','static','plan','e2e']}));

/** Whether a run's latest-attempt job list proves it tested code.
 * @param {string} workflow e.g. `ci.yml` @param {readonly unknown[]} jobs */
export function provesCode(workflow,jobs){
  const shapes=PROOF_SHAPES[workflow],legacy=LEGACY[workflow];
  if(shapes===undefined||legacy===undefined)return false;
  const rows=jobs.filter(record);
  const passed=(/** @type {string} */name)=>rows.some(job=>job.name===name&&job.status==='completed'&&job.conclusion==='success');
  const tests=rows.filter(job=>typeof job.name==='string'&&TESTS.test(job.name));
  const testsGreen=tests.length>0&&tests.every(job=>job.status==='completed'&&job.conclusion==='success');
  const old=legacy.some(name=>rows.some(job=>job.name===name));
  const ranPack=(/** @type {Record<string,unknown>} */job)=>Array.isArray(job.steps)&&job.steps.some(step=>record(step)&&step.name===PACKED_STEP&&step.status==='completed'&&step.conclusion==='success');
  if(!old)return testsGreen&&tests.every(ranPack);
  return shapes.some((shape,index)=>index>0&&shape.jobs.every(passed)&&(!shape.tests||testsGreen));
}
