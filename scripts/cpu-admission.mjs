import {spawn,spawnSync} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import {realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import * as v from 'valibot';
import {holdBrokerCpu} from './cpu-broker.mjs';

const grantSchema=v.object({lease:v.string(),slots:v.number(),capacity:v.number(),queueSeconds:v.number()});

/** A real scheduler child holds the grant until its owner's pipe closes.
 * @param {number|'all'} slots @param {{root?:string,capacity?:number,repo?:string}} [options] */
export async function holdCpu(slots,options={}){
 if(process.env.WS_CPU_BROKER!==undefined&&options.root===undefined&&options.capacity===undefined)
  return holdBrokerCpu(process.env.WS_CPU_BROKER,slots,options.repo??process.cwd());
 const child=spawn('python3',[resolvePath('scripts/cpu-admission.py'),'hold','--slots',String(slots),'--repo',options.repo??process.cwd(),...(options.capacity===undefined?[]:['--capacity',String(options.capacity)])],{
  env:{...process.env,...(options.root===undefined?{}:{WS_CPU_ROOT:options.root})},stdio:['pipe','pipe','pipe']});
 let stderr='',buffer='',closed=false,granted=false;
 child.stderr.on('data',data=>{stderr+=data;});
 /** @type {Promise<v.InferOutput<typeof grantSchema>>} */
 const grantedProof=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('exit',code=>{if(!granted)reject(new Error(`CPU admission refused (${code}): ${stderr}`));});
  child.stdout.on('data',data=>{buffer+=data;if(buffer.includes('\n')&&!granted){
   try{const value=v.parse(grantSchema,JSON.parse(buffer.slice(0,buffer.indexOf('\n'))));if(value.slots<1)throw new Error('Invalid CPU grant');granted=true;resolve(value);}catch(error){child.stdin.end();reject(error instanceof Error?error:new Error('Invalid CPU grant'));}
  }});
 });
 const proof=await grantedProof;
 /** @type {Promise<void>} */
 const lost=new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>{if(!closed)resolve();});});
 return {proof,pid:child.pid,lost,release:async()=>{
  if(closed)return;closed=true;child.stdin.end();
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);});
 }};
}


export const PARENT_CONTEXT = 'WS_CPU_PARENT_GRANT';
/** @param {NodeJS.ProcessEnv} [env] */
export function cpuRoot(env=process.env) {
 return realpathSync(resolvePath(env.WS_CPU_ROOT??env.WS_HEAVY_SCHEDULER_ROOT??resolvePath(homedir(),'.wildshard-heavy-lanes')));
}
/** A capability identifies a live grant; Python validates the ledger and actual ancestry.
 * @param {{lease:string}} proof @param {NodeJS.ProcessEnv} [env] */
export function parentCpuContext(proof,env=process.env) {
 if(typeof proof.lease!=='string'||proof.lease.length===0||proof.lease.length>128)throw new Error('Missing CPU grant');
 return JSON.stringify({version:1,root:cpuRoot(env),lease:proof.lease,ownerPid:process.pid});
}
const ancestorSchema=v.nullable(v.object({slots:v.pipe(v.number(),v.integer(),v.minValue(1)),capacity:v.pipe(v.number(),v.integer(),v.minValue(1)),parentPid:v.pipe(v.number(),v.integer(),v.minValue(2))}));
/** Canonical ledger validation, also used by Python command admission. No raw capability in diagnostics.
 * @param {NodeJS.ProcessEnv} [env] */
export function ancestorCpuBudget(env=process.env) {
 if(env[PARENT_CONTEXT]===undefined)return null;
 const result=spawnSync('python3',[resolvePath('scripts/cpu-admission.py'),'inspect-parent'],{env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 if(result.status!==0||result.signal!==null||result.error!==undefined)throw new Error('Inherited CPU grant is unavailable or is not an actual ancestor grant');
 try{return v.parse(ancestorSchema,JSON.parse(result.stdout));}catch{throw new Error('Inherited CPU grant is unavailable or is not an actual ancestor grant');}
}
