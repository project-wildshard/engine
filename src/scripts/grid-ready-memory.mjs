import * as v from 'valibot';

const hex = v.pipe(v.string(), v.regex(/^[a-f0-9]+$/iu));
const named = v.looseObject({pid:v.number(),name:v.literal('process_name'),args:v.looseObject({name:v.string()})});
const dump = v.looseObject({pid:v.number(),id:v.string(),ph:v.literal('v'),args:v.looseObject({dumps:v.looseObject({
  process_totals:v.looseObject({private_footprint_bytes:hex})})})});

/** Sum simultaneous processes by role within each dump, then retain each role's observed peak.
 * Chromium's memory-infra byte counts are hexadecimal. Missing roles refuse a receipt.
 * @param {readonly unknown[]} events */
export function chromiumProcessPeaks(events) {
  const names = new Map();
  for (const event of events) { const result=v.safeParse(named,event); if(result.success) names.set(result.output.pid,result.output.args.name); }
  /** @type {Map<string,Map<number,{role:string,bytes:number}>>} */
  const dumps = new Map();
  for (const event of events) {
    const result=v.safeParse(dump,event); if(!result.success)continue;
    const row=result.output,role=names.get(row.pid),bytes=Number.parseInt(row.args.dumps.process_totals.private_footprint_bytes,16);
    if(!['Browser','Renderer','GPU Process'].includes(role)||!Number.isSafeInteger(bytes)||bytes<=0)continue;
    let processes=dumps.get(row.id); if(processes===undefined){processes=new Map();dumps.set(row.id,processes);}
    processes.set(row.pid,{role,bytes});
  }
  const peaks={browser:0,renderer:0,gpu:0};
  for(const processes of dumps.values()) {
    const totals={browser:0,renderer:0,gpu:0};
    for(const {role,bytes} of processes.values()) {
      if(role==='Browser')totals.browser+=bytes;
      if(role==='Renderer')totals.renderer+=bytes;
      if(role==='GPU Process')totals.gpu+=bytes;
    }
    for(const key of /** @type {const} */ (['browser','renderer','gpu']))peaks[key]=Math.max(peaks[key],totals[key]);
  }
  if(Object.values(peaks).some(bytes=>bytes===0))throw new Error('CDP memory dump omitted a required process role');
  return peaks;
}

/** Allocator trees retain their paths: parent and child sizes are not additive.
 * Ownership attribution can move bytes away from a partition: keep its raw
 * size and live object bytes separately from the effective attributed size.
 * @param {readonly unknown[]} events */
export function chromiumAllocatorBytes(events) {
  const names = new Map();
  for (const event of events) { const row = v.safeParse(named, event); if (row.success) names.set(row.output.pid, row.output.args.name); }
  const schema = v.looseObject({ pid: v.number(), ph: v.literal('v'), args: v.looseObject({ dumps: v.looseObject({
    allocators: v.record(v.string(), v.looseObject({ attrs: v.optional(v.record(v.string(), v.unknown()), {}) })),
  }) }) });
  const bytes = v.looseObject({ units: v.literal('bytes'), value: hex });
  const rows = [];
  for (const event of events) {
    const parsed = v.safeParse(schema, event); if (!parsed.success) continue;
    const role = names.get(parsed.output.pid);
    if (role !== 'Renderer') continue;
    const entries = [];
    for (const [path, allocator] of Object.entries(parsed.output.args.dumps.allocators)) {
      const read = value => {
        const amount = v.safeParse(bytes, value); if (!amount.success) return undefined;
        const number = Number.parseInt(amount.output.value, 16);
        if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid allocator size');
        return number;
      };
      const effective = read(allocator.attrs.effective_size ?? allocator.attrs.size);
      if (effective === undefined) continue;
      const size = read(allocator.attrs.size), allocated = read(allocator.attrs.allocated_objects_size);
      const text = v.looseObject({type: v.literal('string'), value: v.string()});
      const url = v.safeParse(text, allocator.attrs.url), reason = v.safeParse(text, allocator.attrs.reason_not_deletable);
      entries.push({ path, bytes: effective, ...(size === undefined ? {} : { sizeBytes: size }),
        ...(allocated === undefined ? {} : { allocatedObjectsBytes: allocated }),
        ...(url.success ? {url: url.output.value} : {}), ...(reason.success ? {reasonNotDeletable: reason.output.value} : {}) });
    }
    rows.push({ pid: parsed.output.pid, role, entries });
  }
  if (!rows.some(row => row.entries.length > 0)) throw new Error('CDP memory dump omitted renderer allocators');
  return rows;
}

/** Attribute the cell's effective deduplicated claims plus its shared product transport once.
 * Other cells, platform and commons remain page totals, never another copy of the shard's charge.
 * @param {readonly {id:string,owner:string,accountedBytes:number}[]} claims @param {string} instance @param {string} slug */
export function ownedResidencyBytes(claims,instance,slug) {
  let bytes=0;
  for(const claim of claims)if(claim.owner===instance||claim.id===`product:grid:${slug}`) {
    if(!Number.isSafeInteger(claim.accountedBytes)||claim.accountedBytes<0)throw new Error('Invalid owned residency claim');
    bytes+=claim.accountedBytes;
  }
  return bytes;
}
