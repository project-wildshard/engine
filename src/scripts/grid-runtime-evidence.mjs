// G458: read measured receipts, never replace a missing reading with declared costs.
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {latchedGridEvidence} from './grid-ready-latches.mjs';

const sha=v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u));
const positive=v.pipe(v.number(),v.finite(),v.minValue(1));
const memory=v.looseObject({measurement:v.literal('native-footprint+gpu'),samples:positive,playingPeakBytes:positive,loadingPeakBytes:positive});
const chromiumMemory=v.looseObject({measurement:v.literal('chromium-residency+cdp'),owner:v.string(),samples:positive,
  playingPeakBytes:positive,loadingPeakBytes:positive,cdp:v.literal('memory-infra'),
  browserProcessPeakBytes:positive,rendererProcessPeakBytes:positive,gpuProcessPeakBytes:positive});
const phoneProfile=v.strictObject({device:v.literal('iPhone 16 Pro'),tier:v.literal('phone'),cpu:v.literal(4),muted:v.literal(true)});
const run=v.looseObject({sha,when:v.string(),surface:v.picklist(['sim','desktop','chromium']),cohort:v.literal('grid'),complete:v.literal(true),glObserver:v.literal('off'),
  profile:v.optional(phoneProfile),memory:v.optional(v.union([memory,chromiumMemory])),cases:v.array(v.looseObject({shard:v.string(),complete:v.boolean(),errors:v.array(v.unknown()),
    routes:v.array(v.looseObject({name:v.string(),after:v.looseObject({current:v.nullable(v.string()),slug:v.optional(v.string())})})),
    rows:v.array(v.looseObject({name:v.string(),frames:positive,pass:v.boolean(),contextLost:v.optional(v.boolean()),skipped:v.optional(v.pipe(v.number(),v.finite(),v.minValue(0))),
      maxMs:v.optional(positive),worstMs:v.optional(positive),p95Ms:v.optional(positive),medianFps:v.optional(positive),stallPass:v.optional(v.boolean())}))}))});
const milestone=v.looseObject({schema:v.literal(1),source:sha,protocol:v.looseObject({profiler:v.literal(false),glObserver:v.literal('off'),quiet:v.optional(v.boolean())}),runs:v.array(v.unknown())});
const soak=v.looseObject({schema:v.literal(3),sha,driveStarted:v.string(),surface:v.literal('portrait iPhone Simulator Safari'),
  functionalPass:v.literal(true),seconds:positive,circuits:v.pipe(v.number(),v.integer(),v.minValue(2)),errors:v.pipe(v.array(v.unknown()),v.length(0)),grade:v.looseObject({
    sampling:v.literal(true),missingGlSamples:v.literal(0),rehearsal:v.literal(false),calibration:v.literal(true),leakZero:v.literal(true),
    requiredSeconds:positive,admitted:v.array(v.string()),peakBytes:positive,loadingPeakBytes:positive})});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Only committed milestone/soak locations, no scratch logs or process caches.
 * @param {string} root */
export function runtimeReceiptPaths(root) {
  const directory=resolve(root,'progress/shard-platform'),out=[];
  const walk=folder=>{if(!existsSync(folder))return;for(const entry of readdirSync(folder,{withFileTypes:true})) {
    const path=resolve(folder,entry.name);
    if(entry.isDirectory())walk(path);
    else if(entry.isFile()&&/^(?:receipt|(?:dev|shipped)(?:-cells)?)\.json$/u.test(entry.name)&&statSync(path).size<=5_000_000)out.push(relative(root,path));
  }};
  walk(directory);return out.sort((a,b)=>a.localeCompare(b));
}

/** Unlatched observations require their measured source. G560 passes stay latched until manually removed.
 * The newest eligible unlatched observation overrides earlier observations, including with a fail.
 * Current frame-floor receipts have no native memory readings: they cannot supply memory.
 * @param {string} root @param {string} slug @param {string|null} revision
 * @param {readonly string[]} paths @param {{explorerMB:number,loadingMB:number}} caps
 * @param {boolean} [includeLatches] False only when qualifying a new observation for the latch writer.
 * @returns {Partial<Record<'memory'|'oneFrameLooks'|'frameFloor',import('./shard-milestones.mjs').Criterion>>} */
export function runtimeGridEvidence(root,slug,revision,paths,caps,includeLatches=true) {
  if(revision===null||!v.is(sha,revision))return includeLatches?latchedGridEvidence(root,slug):{};
  const basis=`source ${revision}; exact source SHA`;
  /** @type {Record<'memory'|'oneFrameLooks'|'frameFloor',Array<{at:number,path:string,criterion:import('./shard-milestones.mjs').Criterion}>>} */
  const candidates={memory:[],oneFrameLooks:[],frameFloor:[]};
  const add=(name,when,path,bytes,verdict,evidence)=>{
    const at=Date.parse(when);if(!Number.isFinite(at))return;
    candidates[name].push({at,path,criterion:{verdict,evidence:`${path} sha256:${hash(bytes)} ${basis}: ${evidence}`}});
  };
  const measured=(when,path,bytes,playing,loading,method='native WebContent + labelled GPU')=>add('memory',when,path,bytes,
    playing<=caps.explorerMB*1_000_000&&loading<=caps.loadingMB*1_000_000?'pass':'fail',
    `${method} peaks playing/loading ${playing}/${loading} bytes; per-shard caps ${caps.explorerMB}/${caps.loadingMB} MB`);
  for(const path of paths) {
    const file=resolve(root,path);if(!existsSync(file)||statSync(file).size>5_000_000)continue;
    const bytes=readFileSync(file);
    let input;try{input=JSON.parse(bytes.toString('utf8'));}catch{continue;}
    const recordedSoak=v.safeParse(soak,input);
    if(recordedSoak.success&&recordedSoak.output.grade.admitted.includes(slug)&&recordedSoak.output.sha===revision) {
      const receipt=recordedSoak.output;
      if(receipt.seconds>=receipt.grade.requiredSeconds)measured(receipt.driveStarted,path,bytes,receipt.grade.peakBytes,receipt.grade.loadingPeakBytes);
    }
    const recordedMilestone=v.safeParse(milestone,input);if(!recordedMilestone.success)continue;
    for(const value of recordedMilestone.output.runs) {
      const parsed=v.safeParse(run,value);if(!parsed.success||parsed.output.sha!==recordedMilestone.output.source||parsed.output.sha!==revision)continue;
      const receipt=parsed.output;
      const chromium=receipt.surface==='chromium'&&receipt.profile!==undefined;
      if(receipt.surface==='chromium'&&!chromium)continue;
      for(const scene of receipt.cases.filter(row=>row.shard==='grid'&&row.complete&&row.errors.length===0)) {
        const names=scene.routes.filter(route=>route.after.current!==null&&(route.after.slug??route.after.current)===slug).map(route=>`grid-${route.name}`);
        const rows=scene.rows.filter(row=>names.some(name=>row.name===name||row.name===`${name}-travel`||row.name===`${name}-drive`));
        if(rows.length===0||!names.every(name=>rows.some(row=>row.name===`${name}-drive`)))continue;
        const quiet=recordedMilestone.output.protocol.quiet!==false;
        if(quiet||chromium) {
          const invalid=rows.some(row=>row.contextLost===true||(row.skipped??0)>0);
          // Complete error-free entry cases already passed the route's reload/hole witness. The composite row.pass
          // also includes FPS and content CPU limits, so it cannot decide the separate visual/stall criterion.
          if(receipt.surface==='sim'||chromium) {
            const stalled=rows.some(row=>row.stallPass===false||(row.maxMs??row.worstMs??0)>200);
            const observed=rows.every(row=>row.contextLost===false&&(row.maxMs??row.worstMs)!==undefined);
            const passed=!invalid&&!stalled&&observed;
            // GR3: load can worsen cadence. A green under load is conservative;
            // a non-quiet miss requires quiet confirmation, never a failure latch.
            if(quiet||passed)add('oneFrameLooks',receipt.when,path,bytes,invalid||stalled?'fail':observed?'pass':'unknown',
              `completed ${chromium?'Chromium phone 4x':'Safari'} entry without reload/hole; ${rows.length} look/travel windows, requires intact context and every observed frame <= 200 ms; missing observations stay unknown${quiet?'':'; quiet false, green under load accepted'}`);
          }
          const floor=receipt.surface==='sim'||chromium?30:60,limit=receipt.surface==='sim'||chromium?35:17.5;
          const slow=rows.some(row=>row.p95Ms!==undefined&&row.p95Ms>limit||row.medianFps!==undefined&&Math.round(row.medianFps)<floor);
          const observed=rows.every(row=>row.contextLost===false&&row.p95Ms!==undefined&&row.medianFps!==undefined);
          if(quiet||!invalid&&!slow&&observed)add('frameFloor',receipt.when,path,bytes,invalid||slow?'fail':observed?'pass':'unknown',
            `${receipt.surface}: every one of ${rows.length} grid entry/look/travel rows requires p95 <= ${limit} ms and rounded median >= ${floor} fps; missing observations stay unknown`);
        }
        if(receipt.surface==='sim'&&receipt.memory?.measurement==='native-footprint+gpu')measured(receipt.when,path,bytes,receipt.memory.playingPeakBytes,receipt.memory.loadingPeakBytes);
        if(chromium&&receipt.memory?.measurement==='chromium-residency+cdp'&&receipt.memory.owner===slug)measured(receipt.when,path,bytes,
          receipt.memory.playingPeakBytes,receipt.memory.loadingPeakBytes,
          `owner residency; CDP process peaks browser/renderer/GPU ${receipt.memory.browserProcessPeakBytes}/${receipt.memory.rendererProcessPeakBytes}/${receipt.memory.gpuProcessPeakBytes} bytes (page totals informational)`);
      }
    }
  }
  return {...Object.fromEntries(Object.entries(candidates).flatMap(([name,rows])=>{
    rows.sort((a,b)=>b.at-a.at||a.path.localeCompare(b.path));return rows.slice(0,1).map(row=>[name,row.criterion]);
  })),...(includeLatches?latchedGridEvidence(root,slug,revision):{})};
}
