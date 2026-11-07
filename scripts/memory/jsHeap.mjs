// G1: clean-path Chromium allocation diagnostics, separate from WebKit footprint.
import * as v from 'valibot';

const amount=v.pipe(v.number(),v.finite(),v.minValue(0));
const metrics=v.object({bootAllocatedBytes:amount,settledUsedBytes:amount,idleBytesPerSecond:amount,majorGCsPer30Seconds:amount});
const reading=v.object({shard:v.picklist(['_template','blender-template']),metrics});
const ratchet=v.object({version:v.literal(1),baselines:v.record(v.string(),metrics)});

/** Sampled allocations include objects collected during the sample, not only
 * live objects. Walk the complete native profile, including anonymous roots.
 * @param {unknown} profile */
export function sampledHeapBytes(profile) {
  const root=v.parse(v.object({head:v.unknown()}),profile).head,queue=[root];let total=0;
  for(let index=0;index<queue.length;index++) {
    const row=v.parse(v.object({selfSize:amount,children:v.array(v.unknown())}),queue[index]);
    total+=row.selfSize;queue.push(...row.children);
  }
  return v.parse(amount,total);
}

/** MajorGC is the outer trace event. Inner V8 compactor phases must not count
 * a second time; complete and begin/end encodings both count once.
 * @param {unknown} events @param {number} seconds */
export function majorHeapGCs(events,seconds) {
  if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Invalid heap sample duration');
  const rows=v.parse(v.array(v.object({name:v.string(),ph:v.string(),ts:v.number(),pid:v.number(),tid:v.number()})),events);
  const unique=new Set(rows.filter(row=>row.name==='MajorGC'&&(row.ph==='X'||row.ph==='B'))
    .map(row=>`${row.pid}:${row.tid}:${row.ts}`));
  return unique.size*30/seconds;
}

/** Missing baselines refuse qualification. Only an explicit rebase can seed
 * them; existing limits can only fall, even inside the normal 10% tolerance.
 * @param {unknown} input @param {unknown} baseline @param {boolean} [rebase] */
export function checkHeapRatchet(input,baseline,rebase=false) {
  const rows=v.parse(v.array(reading),input),limits=v.parse(ratchet,baseline);
  if(rows.length===0||new Set(rows.map(row=>row.shard)).size!==rows.length)throw new Error('Empty or duplicate heap readings');
  /** @type {string[]} */ const failures=[];
  const next={version:1,baselines:{...limits.baselines}};
  for(const row of rows) {
    const previous=limits.baselines[row.shard];
    if(previous===undefined) {
      if(rebase)next.baselines[row.shard]=row.metrics;
      else failures.push(`${row.shard}: heap baseline pending; use --rebase after a qualified clean reading`);
      continue;
    }
    for(const key of /** @type {(keyof typeof row.metrics)[]} */ (Object.keys(row.metrics)))
      if(row.metrics[key]>previous[key]*(rebase?1:1.1))failures.push(`${row.shard}: ${key} ${row.metrics[key]} exceeds ${rebase?'lower-only rebase':'10% regression'} limit ${previous[key]*(rebase?1:1.1)}`);
    if(rebase)next.baselines[row.shard]=row.metrics;
  }
  return {passed:failures.length===0,failures,ratchet:next};
}
