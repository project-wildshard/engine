import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,symlinkSync,chmodSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {holdCpu,PARENT_CONTEXT as CONTEXT,parentCpuContext} from './cpu-admission.mjs';
import {startCpuBroker,holdBrokerCpu} from './cpu-broker.mjs';

const root=resolve(process.argv[2]??'tmp/cpu-ancestor-proof',`run-${process.pid}`);mkdirSync(root,{recursive:true});
const helper=new URL('cpu-admission.mjs',import.meta.url).href;
const program=`import {ancestorCpuBudget} from ${JSON.stringify(helper)};try{console.log(JSON.stringify({budget:ancestorCpuBudget()}));}catch(error){process.exitCode=2;console.log(JSON.stringify({refused:true,message:error.message}));}`;
/** @type {import('node:child_process').ChildProcessWithoutNullStreams[]} */ const children=[];
/** @type {Awaited<ReturnType<typeof holdCpu>>[]} */ const leases=[];
/** @type {Awaited<ReturnType<typeof startCpuBroker>>[]} */ const brokers=[];
/** @param {string[]} args @param {NodeJS.ProcessEnv} env */
function start(args,env){const p=spawn(args[0]??'',args.slice(1),{env,stdio:['pipe','pipe','pipe']});children.push(p);let out='',err='';p.stdout.on('data',s=>{out+=s;});p.stderr.on('data',s=>{err+=s;});return {p,done:new Promise((_resolve,reject)=>{p.once('error',reject);p.once('close',code=>{_resolve({code,out,err});});})};}
/** @param {NodeJS.ProcessEnv} env */
function probe(env){const x=start([process.execPath,'--input-type=module','-e',program],env);return x.done;}
let assertions=0;
try{
 for(const kind of ['direct','broker']){
  const directory=resolve(root,kind);mkdirSync(directory,{recursive:true});
  /** @type {NodeJS.ProcessEnv} */ const env={...process.env,WS_CPU_ROOT:directory};
  const grant=kind==='direct'?await holdCpu('all',{root:directory,capacity:2}):await(async()=>{const broker=await startCpuBroker({root:directory,capacity:2});brokers.push(broker);return holdBrokerCpu(broker.environment,'all',process.cwd());})();leases.push(grant);
  const context=parentCpuContext(grant.proof,env);env[CONTEXT]=context;
  const nested=await probe(env);assert.equal(nested.code,0,nested.err);assert.deepEqual(JSON.parse(nested.out).budget,{slots:2,capacity:2,parentPid:process.pid});assertions++;
  const hidden=await probe({...env,[CONTEXT]:'CENSUS_NO_ECHO invalid'});assert.equal(hidden.code,2);assert.ok(!hidden.out.includes('CENSUS_'));assertions++;
  const alias=resolve(directory,'alias');mkdirSync(alias,{recursive:true});symlinkSync(resolve(directory,'queue.json'),resolve(alias,'queue.json'));const aliasContext=JSON.stringify({...JSON.parse(context),root:alias});assert.equal((await probe({...env,WS_CPU_ROOT:alias,[CONTEXT]:aliasContext})).code,2);assertions++;
  const unsafe=resolve(directory,'unsafe');mkdirSync(unsafe,{recursive:true});writeFileSync(resolve(unsafe,'queue.json'),readFileSync(resolve(directory,'queue.json')));chmodSync(resolve(unsafe,'queue.json'),0o666);assert.equal((await probe({...env,WS_CPU_ROOT:unsafe,[CONTEXT]:JSON.stringify({...JSON.parse(context),root:unsafe})})).code,2);assertions++;
  const state=JSON.parse(readFileSync(resolve(directory,'queue.json'),'utf8'));assert.equal(state.cpuActive.length,1);assert.equal(state.cpuQueue.length,0);assertions++;
  for(const patch of [{lease:'foreign-token'},{ownerPid:process.ppid},{ownerPid:1},{version:0},{slots:999}]){
   const refused=await probe({...env,[CONTEXT]:JSON.stringify({...JSON.parse(context),...patch})});assert.equal(refused.code,2);assertions++;
  }
  const unscoped={...env};delete unscoped[CONTEXT];assert.equal(JSON.parse((await probe(unscoped)).out).budget,null);assertions++;
  const other=resolve(directory,'other');mkdirSync(other);assert.equal(JSON.parse((await probe({...env,WS_CPU_ROOT:other})).out).budget,null);assertions++;
  let admitted=false;const pending=holdCpu(1,{root:directory,capacity:2}).then(value=>{admitted=true;return value;});
  const again=await probe(env);assert.equal(again.code,0);assert.equal(admitted,false);assertions++;
  await grant.release();const after=await pending;leases.push(after);assert.equal(admitted,true);await after.release();assertions++;
  assert.equal((await probe(env)).code,2);assertions++;
  const scoped=resolve(directory,'unrelated');mkdirSync(scoped,{recursive:true});const record=resolve(scoped,'context');
  const admission=new URL('cpu-admission.mjs',import.meta.url).href;
  const childProgram=`import {holdCpu} from ${JSON.stringify(admission)};import {parentCpuContext} from ${JSON.stringify(helper)};import {writeFileSync} from 'node:fs';import {once} from 'node:events';const lease=await holdCpu('all',{root:process.env.WS_CPU_ROOT,capacity:2});writeFileSync(process.env.RECORD,parentCpuContext(lease.proof),{mode:0o600});process.stdin.resume();await once(process.stdin,'end');await lease.release();`;
  const actor=start([process.execPath,'--input-type=module','-e',childProgram],{...process.env,WS_CPU_ROOT:scoped,RECORD:record});
  const deadline=Date.now()+3000;while(!existsSync(record)){assert.ok(Date.now()<deadline);await new Promise(_resolve=>{setTimeout(_resolve,10);});}
  assert.equal((await probe({...process.env,WS_CPU_ROOT:scoped,[CONTEXT]:readFileSync(record,'utf8')})).code,2);assertions++;
  actor.p.stdin.end();assert.equal((await actor.done).code,0);assertions++;
  const lastBroker=brokers.at(-1);
  const doomed=kind==='direct'?await holdCpu('all',{root:directory,capacity:2}):await holdBrokerCpu(lastBroker?.environment??'','all',process.cwd());leases.push(doomed);
  const lostEnv={...env,[CONTEXT]:parentCpuContext(doomed.proof,env)};
  if(kind==='direct'){assert.ok(doomed.pid);process.kill(doomed.pid,'SIGTERM');}else {assert.ok(lastBroker);await lastBroker.close();}
  await doomed.lost;assert.equal((await probe(lostEnv)).code,2);assertions++;

 }
 console.log(JSON.stringify({state:'TS22a canonical ancestor-ledger qualification; focused/build wiring still pending',adapters:['real direct holder','real broker holder'],controls:assertions,realAncestorBudgetBorrowed:true,noSecondBudget:true,independentWorkStillBlocked:true,expiredForeignAndForgedRefused:true,privateRootDistinct:true,providerLossRefused:true,actualNonAncestorRefused:true,unsafeStateRefused:true,contextNeverEchoed:true,allChildrenReaped:true}));
}catch(e){console.error(e);process.exitCode=1;}finally{
 for(const lease of leases)await lease.release();for(const broker of brokers)await broker.close();
 for(const p of children)if(p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');await new Promise(_resolve=>{p.once('close',_resolve);});}
}
