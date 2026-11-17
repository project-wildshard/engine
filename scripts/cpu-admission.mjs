import {spawn,spawnSync} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import {realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import * as v from 'valibot';
import {holdBrokerCpu} from './cpu-broker.mjs';

const grantSchema=v.object({lease:v.string(),slots:v.number(),capacity:v.number(),queueSeconds:v.number()});
export const PARENT_CONTEXT = 'WS_CPU_PARENT_GRANT';
// A filesystem companion, not a Vite asset URL in DOM workers.
const admissionScript=resolvePath(import.meta.dirname,'cpu-admission.py');

/** A real scheduler child holds the grant until its owner's pipe closes.
 * @param {number|'all'} slots @param {{root?:string,capacity?:number,repo?:string,inherit?:boolean,buildWork?:boolean,browser?:boolean}} [options] */
export async function holdCpu(slots,options={}){
 /** @type {NodeJS.ProcessEnv} */
 const env={...process.env,...(options.root===undefined?{}:{WS_CPU_ROOT:options.root})};
 const ancestor=options.inherit&&!options.browser?ancestorCpuBudget(env):null;
 if(!options.buildWork&&ancestor!==null&&(options.capacity!==undefined&&options.capacity!==ancestor.capacity||(slots==='all'?ancestor.capacity:slots)>ancestor.slots))throw new Error('Inherited CPU budget cannot satisfy this workload');
 const broker=env.WS_CPU_BROKER;
 if(!options.buildWork&&ancestor===null&&broker!==undefined&&options.root===undefined&&options.capacity===undefined&&(!options.browser||env[PARENT_CONTEXT]===undefined)){
  // An inherited broker belongs to its original root. Private nested fixtures
  // must not accidentally spend a grant from that other scheduler domain.
  const endpoint=JSON.parse(broker);
  if(typeof endpoint.root==='string'&&endpoint.root===cpuRoot(env))return holdBrokerCpu(broker,slots,options.repo??process.cwd(),{browser:options.browser});
 }
 const child=spawn('python3',[admissionScript,options.browser?'browser':options.buildWork?'build-work':ancestor===null?'hold':'borrow','--slots',String(slots),'--repo',options.repo??process.cwd(),...(options.capacity===undefined?[]:['--capacity',String(options.capacity)])],{
  env,stdio:['pipe','pipe','pipe']});
 /** @type {Promise<void>} */
 const ended=new Promise(resolve=>{child.once('close',()=>{resolve();});});
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
 let proof;
 try{proof=await grantedProof;}catch(error){
  child.stdin.end();
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  await ended;
  throw error;
 }
 /** @type {Promise<void>} */
 const lost=new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>{if(!closed)resolve();});});
 return {proof,pid:child.pid,lost,parentContext:ancestor===null?undefined:env[PARENT_CONTEXT],release:async()=>{
  if(closed)return;closed=true;child.stdin.end(options.buildWork?'R':undefined);
  await ended;
  if(options.buildWork&&(child.exitCode!==0||child.signalCode!==null))throw new Error('Build-work completion was not acknowledged; reservation retained');
 }};
}

/** One in-process build interval in an existing private-group service. */
export function holdBuildCpu(){return holdCpu(1,{inherit:true,buildWork:true});}


/** @param {NodeJS.ProcessEnv} [env] */
export function cpuRoot(env=process.env) {
 const path=resolvePath(env.WS_CPU_ROOT??env.WS_HEAVY_SCHEDULER_ROOT??resolvePath(homedir(),'.wildshard-heavy-lanes'));
 try{return realpathSync(path);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return path;throw error;}
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
 const result=spawnSync('python3',[admissionScript,'inspect-parent'],{env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 if(result.status!==0||result.signal!==null||result.error!==undefined)throw new Error('Inherited CPU grant is unavailable or is not an actual ancestor grant');
 try{return v.parse(ancestorSchema,JSON.parse(result.stdout));}catch{throw new Error('Inherited CPU grant is unavailable or is not an actual ancestor grant');}
}
