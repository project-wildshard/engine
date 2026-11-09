import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {homedir} from 'node:os';
import {resolve as resolvePath} from 'node:path';
import * as v from 'valibot';

const endpointSchema=v.object({port:v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(65535)),token:v.string()});
const grantSchema=v.object({lease:v.string(),slots:v.number(),capacity:v.number(),queueSeconds:v.number()});

/** One owned child per Vitest invocation, with the same machine scheduler root.
 * @param {{root?:string,capacity?:number}} [options] */
export async function startCpuBroker(options={}){
 const root=resolvePath(options.root??process.env.WS_CPU_ROOT??process.env.WS_HEAVY_SCHEDULER_ROOT??resolvePath(homedir(),'.wildshard-heavy-lanes'));
 const child=spawn('python3',[resolvePath('scripts/cpu-broker.py'),'--root',root,...(options.capacity===undefined?[]:['--capacity',String(options.capacity)])],{stdio:['pipe','pipe','pipe']});
 let buffer='',errors='',ready=false,closing=false;
 child.stderr.on('data',data=>{errors+=data.toString();});
 /** @type {Promise<v.InferOutput<typeof endpointSchema>>} */
 const readiness=new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',code=>{if(!ready)reject(new Error(`CPU broker refused (${code}): ${errors}`));});
  child.stdout.on('data',data=>{buffer+=data.toString();if(!ready&&buffer.includes('\n')){
   try{const value=v.parse(endpointSchema,JSON.parse(buffer.slice(0,buffer.indexOf('\n'))));ready=true;resolve(value);}catch(error){child.stdin.end();reject(error instanceof Error?error:new Error('Invalid broker message'));}
  }});
 });
 const endpoint=await readiness;
 /** @type {Promise<void>} */
 const ended=new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',()=>resolve());});
 const lost=ended.then(()=>{if(!closing)throw new Error(`CPU broker exited before its owner: ${errors}`);return undefined;});
 // Consumers observe loss explicitly; installing a handler also covers early failure.
 void lost.catch(()=>undefined);
 return {environment:JSON.stringify(endpoint),pid:child.pid,lost,close:async()=>{
  if(!closing){closing=true;child.stdin.end();}await ended;
  if(child.exitCode!==0)throw new Error(`CPU broker cleanup failed (${child.exitCode}): ${errors}`);
 }};
}

/** A connection is the file's grant lifetime; the owner must await close before reuse.
 * @param {string} address @param {number|'all'} slots @param {string} repo */
export async function holdBrokerCpu(address,slots,repo){
 const endpoint=v.parse(endpointSchema,JSON.parse(address));
 const socket=createConnection({host:'127.0.0.1',port:endpoint.port});
 let buffer='',granted=false,closing=false;
 socket.once('connect',()=>{socket.write(`${JSON.stringify({...endpoint,slots,repo})}\n`);});
 /** @type {Promise<v.InferOutput<typeof grantSchema>>} */
 const admission=new Promise((resolve,reject)=>{
  socket.once('error',reject);socket.once('close',()=>{if(!granted)reject(new Error('CPU broker closed before admission'));});
  socket.on('data',data=>{buffer+=data.toString();if(!granted&&buffer.includes('\n')){
   try{const value=v.parse(grantSchema,JSON.parse(buffer.slice(0,buffer.indexOf('\n'))));if(value.slots<1)throw new Error('Invalid CPU grant');granted=true;resolve(value);}catch(error){socket.destroy();reject(error instanceof Error?error:new Error('Invalid broker message'));}
  }});
 });
 const proof=await admission;
 /** @type {Promise<void>} */
 const ended=new Promise(resolve=>{if(socket.closed)resolve();else socket.once('close',()=>resolve());});
 /** @type {Promise<void>} */
 const lost=new Promise(resolve=>{void (async()=>{await ended;if(!closing)resolve();})();});
 return {proof,pid:undefined,lost,release:async()=>{if(closing)return;closing=true;socket.end();await ended;}};
}
