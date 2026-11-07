import { copyFileSync, mkdirSync, writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserBakeBytes } from '../bake-output.mjs';
import { array, number, object, percentile, string } from './value.mjs';
import { matches, normalize } from './compare.mjs';
import { ssim } from './ssim.mjs';

/** @param {import('playwright').Page} page @param {string} golden @param {string} current @param {number[][]} masks @param {boolean} [includeDiff] */
export async function imageScore(page,golden,current,masks,includeDiff=true) {
  const inputs=new Map([['golden',readFileSync(golden)],['current',readFileSync(current)]]);
  const url=`https://parity-images.invalid/${randomUUID()}/`,pattern=`${url}*`;
  /** @param {import('playwright').Route} route */
  const read=async route=>{
    const request=route.request(),bytes=request.method()==='GET'?inputs.get(request.url().slice(url.length)):undefined;
    await route.fulfill({status:bytes===undefined?404:200,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'image/jpeg'},body:bytes??'Missing parity image'});
  };
  await page.route(pattern,read);
  try {
    const sink=includeDiff?await browserBakeBytes(page,{maxFiles:1}):undefined;
    try {
      const {hasDiff,...score}=await page.evaluate(ssim,{a:`${url}golden`,b:`${url}current`,...sink===undefined?{}:{diff:`${sink.url}diff`},mask:masks});
      return {...score,...hasDiff&&sink!==undefined?{diff:sink.take('diff')}:{}};
    } finally {await sink?.dispose();}
  } finally {await page.unroute(pattern,read);}
}
/** @param {import('playwright').Page} page @param {import('./value.mjs').RecordValue[]} runs @param {{sha:string,browser:string}} meta */
export async function aggregate(page,runs,meta) {
  const records=runs.map(normalize),base=structuredClone(records[0]??{}),spread=/** @type {import('./value.mjs').RecordValue} */ ({}),selfMin=/** @type {import('./value.mjs').RecordValue} */ ({});
  // Traverse real object keys: sound IDs and phase names may themselves contain dots.
  /** @param {import('./value.mjs').RecordValue} target @param {import('./value.mjs').RecordValue[]} samples @param {string} prefix */
  function aggregateFields(target,samples,prefix) {
    for(const [key,v] of Object.entries(target)) {
      const path=prefix?`${prefix}.${key}`:key,values=samples.map((sample)=>sample[key]);
      if(typeof v==='number') {const numbers=values.map(number);if(numbers.every(Number.isFinite)){target[key]=percentile(numbers);spread[path]=Math.max(...numbers)-Math.min(...numbers);}}
      else if(Array.isArray(v) && v.every((x)=>typeof x==='number')) {
        const vectors=values.map(array),ranges=v.map((_,i)=>{const numbers=vectors.map((vec)=>number(vec[i]));return Math.max(...numbers)-Math.min(...numbers);});
        target[key]=v.map((_,i)=>percentile(vectors.map((vec)=>number(vec[i]))));spread[path]=ranges;
      }
      else if(path.endsWith('.ambient'))target[key]=array(v).filter((id)=>values.every((value)=>array(value).includes(id)));
      else if(v!==null && typeof v==='object' && !Array.isArray(v))aggregateFields(object(v),values.map(object),path);
    }
  }
  aggregateFields(base,records,'');
  for(const [name,pose] of Object.entries(object(base.poses))) {
    const golden=string(object(pose).shot),boxes=/** @type {number[][]} */ (array(object(pose).boxes));
    const scores=[];
    for(const record of records.slice(1)) {const p=object(object(record.poses)[name]),score=await imageScore(page,golden,string(p.shot),[...boxes,.../** @type {number[][]} */ (array(p.boxes))]);scores.push(score.ssim ?? 0);}
    selfMin[name]=Math.min(1,...scores);object(pose).ssim=1;
  }
  return {...base,spread,selfMin,harness:2,sha:meta.sha,recorded:new Date().toISOString(),browser:meta.browser};
}
/** Replace accepted values, including removed keys; never merge an accepted sound multiset.
 * @param {import('./value.mjs').RecordValue} baseline @param {import('./value.mjs').RecordValue} current @param {string[]} fields */
export function acceptFields(baseline,current,fields) {
  const next=structuredClone(baseline);
  /** @param {import('./value.mjs').RecordValue} target @param {import('./value.mjs').RecordValue} source @param {string} prefix */
  function replace(target,source,prefix) {
    let changed=false;
    for(const key of new Set([...Object.keys(target),...Object.keys(source)])) {
      if(!prefix && ['spread','selfMin','sha','recorded'].includes(key))continue;
      const path=prefix?`${prefix}.${key}`:key;
      if(fields.some((field)=>matches(field,path))) {
        changed=true;
        if(source[key]===undefined)delete target[key];else target[key]=structuredClone(source[key]);
      } else {
        const before=target[key],after=source[key];
        if((before!==null&&typeof before==='object'&&!Array.isArray(before))||(after!==null&&typeof after==='object'&&!Array.isArray(after))) {
          const child=object(before),childChanged=replace(child,object(after),path);
          if(childChanged){changed=true;if(Object.keys(child).length>0)target[key]=child;else delete target[key];}
        }
      }
    }
    return changed;
  }
  replace(next,current,'');
  for(const key of ['spread','selfMin']) {
    const target=object(next[key]),source=object(current[key]);
    for(const path of new Set([...Object.keys(target),...Object.keys(source)])) {
      const fieldPath=key==='selfMin'?`poses.${path}.ssim`:path;
      if(fields.some((field)=>matches(field,fieldPath))) {
        if(source[path]===undefined)delete target[path];else target[path]=structuredClone(source[path]);
      }
    }
    next[key]=target;
  }
  for(const [name,pose] of Object.entries(object(next.poses)))if(fields.some((field)=>matches(field,`poses.${name}.ssim`))) {
    const source=object(object(current.poses)[name]);object(pose).shot=source.shot;object(pose).boxes=structuredClone(source.boxes);
  }
  next.sha=current.sha;next.recorded=current.recorded;
  return next;
}
/** @param {string} root @param {string} lane @param {string} shard @param {string} tier @param {import('./value.mjs').RecordValue} baseline @param {string[]|undefined} fields */
export function writeBaseline(root,lane,shard,tier,baseline,fields) {
  const dir=join(root,'test/parity/baselines',lane);mkdirSync(dir,{recursive:true});
  for(const [name,pose] of Object.entries(object(baseline.poses))) {
    if(fields && !fields.some((p)=>p.startsWith(`poses.${name}`)))continue;
    if(tier==='desktop')continue; // X22 (G416): desktop pose SSIM is information; only the phone's references are stored
    const target=join(dir,`${shard}.${tier}.${name}.jpg`);copyFileSync(string(object(pose).shot),target);object(pose).shot=target;
  }
  writeFileSync(join(dir,`${shard}.${tier}.json`),`${JSON.stringify(baseline,null,2)}\n`);
}
