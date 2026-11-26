// EV6: the original cold-native suites must wait before collection, not burn
// their setup deadlines while sharing CPU with another admitted workload.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {holdCpu} from './cpu-admission.mjs';
import {startCpuBroker} from './cpu-broker.mjs';
import {NATIVE_CONTENTION_SUITES} from './vitest-ci-files.ts';

const repo=process.cwd(),directory=resolvePath(process.argv[2]??'tmp/native-contention',`run-${process.pid}`);
mkdirSync(directory,{recursive:true});
/** @type {readonly string[]} */
const original=NATIVE_CONTENTION_SUITES;
const selected=process.argv[3];
assert.ok(selected===undefined||original.includes(selected),'Unknown native contention file');
const files=selected===undefined?original:[selected];
// Keep the real machine budget, including small hosted runners. With at most
// two slots the old native grant was already effectively exclusive; the red
// partial-holder counterexample is discriminating only on larger machines.
let outer;
/** @type {{child:import('node:child_process').ChildProcess,done:Promise<number|null>}[]} */
const actors=[];
/** @type {Awaited<ReturnType<typeof holdCpu>>[]} */
const leases=[];
/** @type {Awaited<ReturnType<typeof startCpuBroker>>|undefined} */
let broker;
let stopped=false;
const stop=()=>{
 stopped=true;broker?.expectExit();
 for(const actor of actors)if(actor.child.exitCode===null&&actor.child.signalCode===null)actor.child.kill('SIGTERM');
};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
/** @param {()=>boolean} ready @param {string} message */
async function until(ready,message){
 const end=Date.now()+20000;
 while(!ready()){assert.ok(!stopped,'Native proof interrupted');assert.ok(Date.now()<end,message);await new Promise(resolve=>{setTimeout(resolve,20);});}
}
/** @type {{file:string,queuedBeforeCollection:boolean,originalCasesPassed:boolean}[]} */
const results=[];
let problem;
try{
 outer=await holdCpu('all',{inherit:true});
 assert.ok(!stopped,'Native proof interrupted');
 const root=join(directory,'cpu');
 broker=await startCpuBroker({root});
 /** @type {NodeJS.ProcessEnv} */
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('WS_CPU_')&&!key.startsWith('WS_HEAVY_')&&!key.startsWith('WS_PUSH_')&&!['CI','GITHUB_ACTIONS'].includes(key)));
 Object.assign(env,{WS_CPU_ROOT:root,WS_CPU_BROKER:broker.environment,VITEST_TMP_ROOT:join(directory,'vitest')});
 const state=()=>JSON.parse(readFileSync(join(root,'queue.json'),'utf8'));
 for(const [index,file] of files.entries()){
  assert.ok(!stopped,'Native proof interrupted');
  const holder=await holdCpu(1,{root});leases.push(holder);
  const marker=join(directory,`collected-${index}`),setup=join(directory,`marker-${index}.mjs`),config=join(directory,`native-${index}.config.ts`);
  writeFileSync(setup,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'collected');`);
  writeFileSync(config,`import {defineConfig} from 'vitest/config';import base from ${JSON.stringify(join(repo,'vitest.config.ts'))};const {projects,...test}=base.test??{};export default defineConfig({...base,test:{...test,include:[${JSON.stringify(file)}],setupFiles:[...(test.setupFiles??[]),${JSON.stringify(setup)}],maxWorkers:1,fileParallelism:false}});`);
  const child=spawn(process.execPath,['src/scripts/vitest-tmp.ts','run','--config',config,file],{env,stdio:['ignore','pipe','pipe']});
  let output='';
  const log=join(directory,`native-${index}.log`);
  /** @param {Buffer} data */
  const collect=data=>{output+=data.toString();writeFileSync(log,output.replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,'[address]'));};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  /** @type {Promise<number|null>} */
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  actors.push({child,done});
  await until(()=>state().cpuQueue.length>0||state().cpuActive.length>1||child.exitCode!==null,`${file}: worker never reached admission`);
  assert.equal(state().cpuQueue.length,1,`${file}: native work started beside a partial CPU holder`);
  assert.equal(state().cpuActive.length,1,`${file}: native work spent slots before exclusive admission`);
  assert.equal(existsSync(marker),false,`${file}: collection started before admission`);
  await holder.release();
  const code=await done;
  assert.equal(code,0,readFileSync(log,'utf8'));
  assert.ok(existsSync(marker),`${file}: original file never collected`);
  assert.equal(state().cpuActive.length,0);assert.equal(state().cpuQueue.length,0);
  results.push({file,queuedBeforeCollection:true,originalCasesPassed:true});
 }
 console.log(JSON.stringify({files:results,allGrantsReleased:true}));
}catch(error){problem=error;}
finally{
 const cleanup=await Promise.allSettled(actors.map(async actor=>{
  if(actor.child.exitCode===null&&actor.child.signalCode===null)actor.child.kill('SIGTERM');
  await actor.done;
 }));
 cleanup.push(...await Promise.allSettled(leases.map(lease=>lease.release())));
 try{await broker?.close();}catch(error){problem??=error;}
 finally{try{await outer?.release();}catch(error){problem??=error;}}
 for(const result of cleanup)if(result.status==='rejected')problem??=result.reason;
 process.off('SIGTERM',stop);process.off('SIGINT',stop);
}
if(problem!==undefined)throw problem;
