import {spawn} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import * as v from 'valibot';

const grantSchema=v.object({lease:v.string(),slots:v.number(),capacity:v.number(),queueSeconds:v.number()});

/** A real scheduler child holds the grant until its owner's pipe closes.
 * @param {number|'all'} slots @param {{root?:string,capacity?:number,repo?:string}} [options] */
export async function holdCpu(slots,options={}){
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
