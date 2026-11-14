// KR1 metrics are observations from the real DecisionHost, not declarations.
import { representativeProduct } from './shard-outputs.mjs';
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {outputFormat} from './node-format.mjs';
import {formatSource} from './format-package.mjs';

const hash=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u)),natural=v.pipe(v.number(),v.safeInteger(),v.minValue(0));
const schema=v.strictObject({schema:v.literal('script-scenario/1'),slug:v.string(),script:v.string(),scenario:v.string(),
  sectionHash:hash,hostHash:hash,passed:v.literal(true),calls:v.pipe(natural,v.minValue(1)),fuel:natural,maxFuel:natural,refusals:natural});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Fuel and scheduling observations also bind the defining host, module and
 * ABI table. An old script with a changed host is not a current observation.
 * @param {string} root */
export function scenarioHostHash(root) {
  const fingerprint=createHash('sha256');
  for(const path of ['src/server/engine/script/decision.ts','src/shared/engine/script/decisionModule.ts','src/format/scriptAbiV1.ts']) {
    // The fingerprint keeps format's old path: same bytes, same receipts.
    const file=path.startsWith('src/format/')?formatSource(root,path.slice('src/format/'.length)):resolve(root,path);if(!existsSync(file))return null;
    fingerprint.update(`${path}\0`);fingerprint.update(readFileSync(file));fingerprint.update('\0');
  }
  return fingerprint.digest('hex');
}
/** Only the result of a completed assertion-bearing scenario belongs here.
 * Fuel is coarse host fuel, never CPU time. Trace calls include failed calls.
 * @param {{slug:string,script:string,scenario:string,sectionHash:string,hostHash:string,trace:readonly import('../src/server/engine/script/decision').DecisionTrace[]}} input */
export function scriptScenarioReceipt({slug,script,scenario,sectionHash,hostHash,trace}) {
  const calls=trace.filter(entry=>entry.kind==='call');
  return v.parse(schema,{schema:'script-scenario/1',slug,script,scenario,sectionHash,hostHash,passed:true,calls:calls.length,
    fuel:calls.reduce((sum,row)=>sum+row.fuel,0),maxFuel:Math.max(0,...calls.map(row=>row.fuel)),refusals:calls.filter(row=>!row.ok).length});
}
/** @param {string} root */
export function scriptReceiptPaths(root) {
  const paths=[];
  const walk=folder=>{if(!existsSync(folder))return;for(const entry of readdirSync(folder,{withFileTypes:true})) {
    const path=resolve(folder,entry.name);
    if(entry.isDirectory())walk(path);
    else if(entry.isFile()&&entry.name==='script-scenario.json'&&statSync(path).size<=100_000)paths.push(relative(root,path));
  }};
  walk(resolve(root,'progress/shard-platform'));return paths.sort((a,b)=>a.localeCompare(b));
}
/** Verify the actual sim/scripts bytes before matching a scenario's section
 * hash AND script id. Legacy v0 or missing/stale receipts remain unknown.
 * Every scenario is displayed separately; fuel/calls are not universal costs.
 * @param {string} slug @param {{sections:{name:string,path:string,hash:string}[]}} index
 * @param {(path:string)=>Uint8Array} read @param {readonly string[]} paths @param {string|null} hostHash */
export function scriptScenarioMetrics(slug,index,read,paths,hostHash) {
  const section=index.sections.find(row=>row.name==='sim/scripts');
  if(section===undefined)return {status:'not-applicable',scripts:[],scenarios:[]};
  const bytes=read(section.path);
  if(digest(bytes)!==section.hash)throw new Error(`${slug}: scenario section hash mismatch`);
  const rows=v.parse(v.array(v.looseObject({id:v.string()})),JSON.parse(new TextDecoder().decode(bytes))),ids=new Set(rows.map(row=>row.id));
  const scenarios=[];
  for(const path of paths) {
    const wire=read(path);if(wire.length>100_000)continue;
    let input;try{input=JSON.parse(new TextDecoder().decode(wire));}catch{continue;}
    const result=v.safeParse(schema,input);
    if(!result.success)continue;
    const row=result.output;
    if(row.slug===slug&&row.sectionHash===section.hash&&row.hostHash===hostHash&&ids.has(row.script)&&row.maxFuel<=row.fuel&&row.refusals<=row.calls)
      scenarios.push({...row,path,receiptHash:digest(wire)});
  }
  const scripts=rows.map(row=>({id:row.id,measured:scenarios.some(scenario=>scenario.script===row.id)}));
  return {status:scripts.length===0?'not-applicable':scripts.every(row=>row.measured)?'measured':'unknown',scripts,scenarios};
}
/** Missing products cannot supply a zero-cost script claim.
 * @param {string} root @param {string} slug @param {string} products @param {readonly string[]} paths */
export function productScriptMetrics(root,slug,products,paths) {
  const directory=resolve(products,representativeProduct(root,slug)),path=resolve(directory,'shard.json');
  if(!existsSync(path))return {status:'unknown',scripts:[],scenarios:[]};
  const index=outputFormat.parseOutputIndex(JSON.parse(readFileSync(path,'utf8')));
  return scriptScenarioMetrics(slug,index,file=>readFileSync(paths.includes(file)?resolve(root,file):resolve(directory,file)),paths,scenarioHostHash(root));
}
