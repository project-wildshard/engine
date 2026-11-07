import { memoryOwnerInventory } from './memory-report-blocks.mjs';

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a memory report object');
  return /** @type {Record<string,unknown>} */ (value);
}
/** @param {unknown} value */
function bytes(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid memory report bytes');
  return value;
}
/** Historical estimate arithmetic can have a fractional byte; preserve the original in evidence.
 * @param {unknown} value */
function estimatedBytes(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw new RangeError('Invalid historical byte estimate');
  return Math.round(value);
}
/** @param {unknown} value */
function text(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw new TypeError('Invalid memory report text');
  return value;
}
/** @param {unknown} value */
function list(value) { if (!Array.isArray(value)) throw new TypeError('Expected memory report array'); return /** @type {unknown[]} */(value); }
/** @param {unknown} value @returns {import('./memory-report-blocks.mjs').MemoryAllocation} */
function allocation(value) {
  const row = object(value);
  if (row.domain !== 'ram' && row.domain !== 'gpu') throw new TypeError('Invalid allocation domain');
  if (row.precision !== 'exact' && row.precision !== 'estimate') throw new TypeError('Invalid allocation precision');
  return { id:text(row.id),domain:row.domain,owner:text(row.owner),asset:text(row.asset),kind:text(row.kind),precision:row.precision,bytes:bytes(row.bytes) };
}
/** @param {unknown} value */
function pair(value) { const row=object(value);return {ram:bytes(row.ram),gpu:bytes(row.gpu)}; }
/** @param {unknown} value */
function optionalPair(value) { const row=object(value);return {ram:row.ram===null?null:bytes(row.ram),gpu:row.gpu===null?null:bytes(row.gpu)}; }

/** Native physical footprint and live GL are the cap ruler; observed RAM storage is not added to it.
 * @param {unknown} value
 * @returns {import('./memory-report-data.mjs').MemoryMeasured|null}
 */
export function readMemoryMeasured(value) {
  if (value === null) return null;
  const row=object(value), wc=bytes(row.wc), gl=bytes(row.gl);
  if (bytes(row.total)!==wc+gl) throw new Error('Memory ruler must equal WC + GL');
  if (typeof row.time !== 'string' || !Number.isFinite(Date.parse(row.time))) throw new Error('Memory measurement requires a timestamp');
  const pid=bytes(row.pid);if(pid===0)throw new Error('Memory measurement requires the fixed game PID');
  return {wc,gl,total:wc+gl,time:row.time,source:text(row.source),pid};
}

/** Consume the engine's scalar v1 snapshot without substituting allocator estimates for observed storage.
 * @param {unknown} value
 * @returns {import('./memory-report-data.mjs').MemoryAccounted}
 */
export function readMemoryAttribution(value) {
  const row=object(value);
  if(row.version!==1)throw new Error('Unsupported memory attribution version');
  const allocations=list(row.allocations).map(allocation), owners=memoryOwnerInventory(allocations);
  const totals={ram:0,gpu:0}, unattributed={ram:0,gpu:0};
  for(const owner of owners){totals[owner.domain]+=owner.bytes;if(owner.owner==='unattributed')unattributed[owner.domain]+=owner.bytes;}
  const declared=pair(row.totals), missing=pair(row.unattributed);
  if(declared.ram!==totals.ram||declared.gpu!==totals.gpu||missing.ram!==unattributed.ram||missing.gpu!==unattributed.gpu)throw new Error('Memory attribution totals do not reconcile');
  return {total:row.accountedBytes===null?null:bytes(row.accountedBytes),allocations,unattributed,storageTotals:totals};
}

/** @param {unknown} value @returns {import('./memory-report-data.mjs').MemoryReport} */
export function readMemoryReport(value) {
  const row=object(value);
  if(row.schema!=='memory-report/1')throw new Error('Unsupported memory report schema');
  const cap=object(row.cap);if(cap.bytes!==1_000_000_000)throw new Error('Memory report cap must remain 1000 MB');
  const poses=list(row.poses).map(entry=>{
    const pose=object(entry), raw=object(pose.accounted);
    const measured=readMemoryMeasured(pose.measured);
    const allocations=list(raw.allocations).map(allocation), owners=memoryOwnerInventory(allocations);
    const unattributed=optionalPair(raw.unattributed);
    const storageTotals=raw.storageTotals===undefined?{ram:owners.filter(owner=>owner.domain==='ram').reduce((sum,owner)=>sum+owner.bytes,0),gpu:owners.filter(owner=>owner.domain==='gpu').reduce((sum,owner)=>sum+owner.bytes,0)}:optionalPair(raw.storageTotals);
    for(const domain of /** @type {const} */(['ram','gpu'])){
      const observed=owners.filter(owner=>owner.domain===domain).reduce((sum,owner)=>sum+owner.bytes,0);
      const unknown=owners.filter(owner=>owner.domain===domain&&owner.owner==='unattributed').reduce((sum,owner)=>sum+owner.bytes,0);
      if(storageTotals[domain]===null ? observed!==0||unattributed[domain]!==null : storageTotals[domain]!==observed||unattributed[domain]!==unknown)throw new Error('Memory report storage totals do not reconcile');
    }
    const accounted={total:raw.total===null?null:bytes(raw.total),allocations,storageTotals,unattributed};
    const missing=list(pose.missing).map(text);
    if(measured===null&&missing.length===0)throw new Error('Missing measurement must state why');
    /** @type {import('./memory-report-data.mjs').MemoryPose} */
    const result={name:text(pose.name),measured,accounted,missing};
    if(pose.evidence!==undefined)result.evidence=object(pose.evidence);
    return result;
  });
  if(new Set(poses.map(pose=>pose.name)).size!==poses.length)throw new Error('Duplicate memory report pose');
  return {schema:'memory-report/1',pin:text(row.pin),device:text(row.device),settings:object(row.settings),cap:{bytes:1_000_000_000},poses};
}

/** @returns {import('./memory-report-data.mjs').MemoryAccounted} */
export function emptyMemoryAttribution() { return {total:null,allocations:[],unattributed:{ram:null,gpu:null},storageTotals:{ram:null,gpu:null}}; }

/** The worst crossing is a complete same-PID matched window, never the largest settled pose.
 * @param {readonly import('./memory-report-data.mjs').CrossingMemorySample[]} samples
 * @param {boolean} complete
 * @returns {import('./memory-report-data.mjs').MemoryPose}
 */
export function worstMemoryCrossing(samples, complete) {
  const absent=(/** @type {string} */ reason)=>({name:'worst-crossing',measured:null,accounted:emptyMemoryAttribution(),missing:[reason]});
  if(!complete||samples.length<2)return absent('No complete matched crossing window; settled entry samples are not a crossing peak');
  let previous=-Infinity;
  const pid=samples[0]?.measured.pid;
  for(const sample of samples){
    const measured=readMemoryMeasured(sample.measured);if(measured===null)throw new Error('Missing crossing measurement');
    const time=Date.parse(measured.time), gpuTime=Date.parse(sample.glTime);
    if(!Number.isFinite(gpuTime)||Math.abs(time-gpuTime)>1000)return absent('Crossing WC and GL samples are not matched within one second');
    if(measured.pid!==pid||time<=previous||time-previous>1500&&previous!==-Infinity)return absent('Crossing sample PID changed or timeline is incomplete');
    previous=time;
  }
  const peak=[...samples].sort((a,b)=>b.measured.total-a.measured.total).at(0);
  if(!peak)throw new Error('Missing crossing peak');
  return {name:'worst-crossing',measured:peak.measured,accounted:peak.accounted,missing:peak.accounted.allocations.length===0?['No owner attribution at the peak sample']:[]};
}

/** Convert one fixed-PID native audit pose. No scene scan, getter read, GL query or world restore occurs here.
 * @param {unknown} value Native audit JSON (possibly failed; its partial measurements cannot qualify).
 * @param {string} label
 * @param {string} name
 * @param {string} source
 * @param {unknown} attribution Optional explicit engine v1 snapshot, or the new per-pose field.
 * @returns {import('./memory-report-data.mjs').MemoryPose}
 */
export function nativeMemoryPose(value,label,name,source,attribution=null) {
  const report=object(value), missing=[];
  const errors=typeof report.errors==='string'?JSON.parse(report.errors):report.errors;
  if(report.failure||!report.closed||!Array.isArray(errors)||errors.length>0)return {name,measured:null,accounted:emptyMemoryAttribution(),missing:['Native audit failed or did not cleanly close; partial poses excluded']};
  const pose=list(report.snapshots).map(object).find(row=>row.label===label);
  if(!pose)return {name,measured:null,accounted:emptyMemoryAttribution(),missing:[`Native audit has no ${label} pose`]};
  const native=object(pose.native), samples=list(native.samples).map(object);
  const pid=bytes(report.gamePID??samples.at(0)?.pid);
  if(samples.length<3||new Set(samples.map(row=>row.at)).size!==samples.length||new Set(samples.map(row=>row.pid)).size!==1||samples[0]?.pid!==pid)throw new Error('Native memory pose requires fresh fixed-PID samples');
  let previous=-Infinity;
  for(const sample of samples){const at=Date.parse(text(sample.at));if(!Number.isFinite(at)||at<=previous)throw new Error('Native sample timestamps must increase');previous=at;}
  if(report.gamePID===undefined)missing.push('Historical report has only per-pose fixed PID; no cross-pose game-PID witness');
  const measuredWC=samples.map(row=>bytes(row.footprintBytes)).sort((a,b)=>a-b);
  const midpoint=Math.floor(measuredWC.length/2), middle=measuredWC.at(midpoint);
  if(middle===undefined)throw new Error('Missing native sample');
  const wc=measuredWC.length%2===1?middle:((measuredWC[midpoint-1]??middle)+middle)/2;
  // The fixed ruler (progress/memory/ruler) reads each pose's GL as tracker totals (`light`) before any census; the full
  // census exists only on the run's last pose, taken after its reading. Measure GL from the same-time totals when present.
  const census=pose.census===undefined?[]:list(object(pose.census).gl).map(object), light=pose.light===undefined?[]:list(object(pose.light).gl).map(object);
  const measuredGL=light.length>0?light:census;
  if(measuredGL.length===0)throw new Error('Native pose has no GL reading');
  if(measuredGL.some(row=>row.reconciled!==true)||census.some(row=>row.reconciled!==true))throw new Error('Native GL census does not reconcile');
  const gpu=measuredGL.reduce((sum,row)=>sum+bytes(row.totalBytes),0);
  const gl=census;
  const midSample=samples.at(midpoint);if(!midSample)throw new Error('Missing native sample timestamp');
  const measured=readMemoryMeasured({wc,gl:gpu,total:wc+gpu,time:midSample.at,source,pid});
  const scalar=attribution??pose.memoryAttribution;
  let accounted;
  if(scalar!==undefined&&scalar!==null)accounted=readMemoryAttribution(scalar);
  else {
    // Historical GPU records have actual live identities. RAM without the engine ledger stays missing.
    const hasGpuRows=gl.length>0&&gl.every(context=>Array.isArray(context.resources));
    const allocations=hasGpuRows?gl.flatMap((context,index)=>list(context.resources).map(entry=>{
      const resource=object(entry);return allocation({id:`legacy-gl:${index}:${text(String(resource.id))}`,domain:'gpu',kind:resource.kind,bytes:resource.bytes,owner:resource.owner,asset:resource.asset,precision:'exact'});
    })):[];
    const owners=memoryOwnerInventory(allocations), total=pose.residency===undefined?null:bytes(object(object(pose.residency).cost).accounted);
    accounted={total,allocations,storageTotals:{ram:null,gpu:hasGpuRows?owners.reduce((sum,row)=>sum+row.bytes,0):null},unattributed:{ram:null,gpu:hasGpuRows?owners.filter(row=>row.owner==='unlabelled'||row.owner==='unattributed').reduce((sum,row)=>sum+row.bytes,0):null}};
    // Normalize the historical unlabelled spelling to the engine's canonical explicit remainder.
    accounted.allocations=accounted.allocations.map(row=>row.owner==='unlabelled'?{...row,owner:'unattributed',asset:'unattributed'}:row);
    missing.push('RAM owner attribution unavailable in this historical native audit');
  }
  if(accounted.storageTotals.gpu!==gpu)missing.push('Owner GPU inventory differs from same-pose live GL; keep the measured ruler separate');
  missing.push('RAM storage capacity is not resident WC; native owner/region attribution remains separate');
  return {name,measured,accounted,missing,evidence:{native,wasm:pose.wasm??null,attribution:scalar??null}};
}

/** Reuse the first SF64 itemization, preserving confidence and non-additive vmmap context.
 * Historical RAM capacities/other-process heap rows remain estimates; the WC residual is NEVER an allocation.
 * @param {import('./memory-report-data.mjs').MemoryPose} pose
 * @param {unknown} value
 * @param {string} id
 * @param {string} source
 * @returns {import('./memory-report-data.mjs').MemoryPose}
 */
export function withItemizedMemoryPose(pose,value,id,source){
  const situation=list(object(value).situations).map(object).find(row=>row.id===id);
  if(!situation)throw new Error('Itemized situation not found');
  if(pose.measured===null)throw new Error('Itemized rows require a validated native pose');
  if(bytes(situation.wcBytes)!==pose.measured.wc||bytes(situation.glBytes)!==pose.measured.gl||bytes(situation.vmmapPid)!==pose.measured.pid)throw new Error('Itemized data does not match native pose');
  const rows=list(situation.blocks).map(object);
  const allocations=rows.flatMap((row,index)=>{
    if(row.side!=='RAM'&&row.side!=='GPU')throw new Error('Invalid itemized domain');
    if(row.conf!=='M'&&row.conf!=='E'&&row.conf!=='U')throw new Error('Invalid itemized confidence');
    // U RAM is a modelled resident-footprint residual, not observed storage. Browser floor overlaps capacity rows.
    if(row.side==='RAM'&&(row.conf==='U'||row.owner==='Browser & OS'))return [];
    const owner=text(row.owner), system=text(row.system);
    return [allocation({id:`itemized:${id}:${index}`,domain:row.side==='RAM'?'ram':'gpu',bytes:row.conf==='E'?estimatedBytes(row.bytes):row.bytes,
      owner:/Unknown/u.test(owner)?'unattributed':`${owner} / ${system}`,asset:system,kind:row.side==='RAM'?'historical-storage-estimate':system,
      precision:row.side==='GPU'&&row.conf==='M'?'exact':'estimate'})];
  });
  const owners=memoryOwnerInventory(allocations), totals={ram:0,gpu:0}, unattributed={ram:0,gpu:0};
  for(const owner of owners){totals[owner.domain]+=owner.bytes;if(owner.owner==='unattributed')unattributed[owner.domain]+=owner.bytes;}
  if(totals.gpu!==pose.measured.gl)throw new Error('Itemized GPU rows do not reconcile');
  const residual=rows.filter(row=>row.side==='RAM'&&row.conf==='U').reduce((sum,row)=>sum+estimatedBytes(row.bytes),0);
  return {...pose,accounted:{total:pose.accounted.total,allocations,storageTotals:totals,unattributed},
    evidence:{...pose.evidence,itemized:{source,situation},historicalResidentRemainderBytes:residual},
    missing:[...pose.missing,`Historical RAM rows are capacity/heap estimates, not resident owner measurements. Itemized WC remainder ${residual} bytes stays unassigned; vmmap dirty regions overlap and are not added.`]};
}

/** Owners that name no one: the explicit remainder and the scene walk's unnamed-path bucket (SF64). */
export const NO_OWNER=/^(?:unattributed|unlabelled|engine\/scene)$/u;
/** The share of the native ruler (WC + GL) with no named owner, the SF64 target (< 10 %). Owned GPU storage is matched
 * against live GL; owned RAM storage is clamped to WC because capacity rows can exceed resident pages. Null when either
 * side is missing: no zero is inferred.
 * @param {import('./memory-report-data.mjs').MemoryPose} pose
 * @returns {import('./memory-report-data.mjs').MemoryNoOwner|null}
 */
export function memoryNoOwner(pose){
  const measured=pose.measured, totals=pose.accounted.storageTotals;
  if(measured===null||totals.gpu===null||totals.ram===null)return null;
  const owned={gpu:0,ram:0};
  for(const row of pose.accounted.allocations)if(!NO_OWNER.test(row.owner))owned[row.domain]+=row.bytes;
  const gpuOwned=Math.min(measured.gl,owned.gpu), ramOwned=Math.min(measured.wc,owned.ram);
  const gpu=measured.gl-gpuOwned, ram=measured.wc-ramOwned;
  return {gpuOwned,ramOwned,gpu,ram,bytes:gpu+ram,share:measured.total>0?(gpu+ram)/measured.total:0};
}
