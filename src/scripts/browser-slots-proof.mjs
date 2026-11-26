// J402 native admission control: real broker connections, private ledger, no browser.
// DS20c (FS17): a browser is admitted while four cores are free (free cores / 4), not under a fixed two.
import assert from 'node:assert/strict';
import {availableParallelism} from 'node:os';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {startCpuBroker,holdBrokerCpu} from './cpu-broker.mjs';
import {holdCpu,parentCpuContext,PARENT_CONTEXT} from './cpu-admission.mjs';

if(availableParallelism()<14)console.log(JSON.stringify({skipped:'needs a twelve-core private budget'}));
else await prove();

async function prove(){
const root=resolve(process.argv[2]??'tmp/codex-pagesize/browser-slots-proof',`run-${process.pid}`);mkdirSync(root,{recursive:true});
const broker=await startCpuBroker({root,capacity:12}),held=[];
/** @type {import('node:child_process').ChildProcessWithoutNullStreams[]} */const children=[];
let third;
const deadline=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');throw new Error('browser admission control timed out');},15000);
try{
 const first=await holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true});held.push(first);
 const second=await holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true});held.push(second);
 // DS20c: with two browsers open, the four free cores of twelve admit a third at once (J402's fixed two made it wait).
 const extra=await holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true});
 await extra.release();
 const filler=await holdBrokerCpu(broker.environment,1,process.cwd());held.push(filler);
 let admitted=false;
 third=holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true}).then(lease=>{admitted=true;held.push(lease);return lease;});
 await queuedBrowser(root);
 assert.equal(admitted,false,'a third browser must wait while fewer than four cores are free (3 free: 0 slots)');
 const ordinary=await holdBrokerCpu(broker.environment,1,process.cwd());held.push(ordinary);
 /** @type {{cpuActive:{browser?:boolean,slots:number}[]}} */const state=JSON.parse(readFileSync(resolve(root,'queue.json'),'utf8'));
 assert.equal(state.cpuActive.filter(row=>row.browser===true).length,2);
 assert.equal(state.cpuActive.reduce((sum,row)=>sum+row.slots,0),10);
 await first.release();
 await third;
 assert.equal(admitted,true);
 const controller=new AbortController();
 const cancelled=holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true,signal:controller.signal});
 await queuedBrowser(root);
 controller.abort();
 await assert.rejects(cancelled,/aborted/);
 await Promise.all(held.map(lease=>lease.release()));held.length=0;
 const direct=await holdCpu('all',{root,capacity:12});held.push(direct);
 const oldContext=process.env[PARENT_CONTEXT];
 process.env[PARENT_CONTEXT]=parentCpuContext(direct.proof,{WS_CPU_ROOT:root});
 try{
  const borrowed=await holdCpu(4,{root,capacity:12,browser:true});held.push(borrowed);
  await borrowed.release();
  /** @type {{cpuActive:{browser?:boolean}[]}} */
  const released=JSON.parse(readFileSync(resolve(root,'queue.json'),'utf8'));
  assert.equal(released.cpuActive.some(row=>row.browser===true),false,'releasing an ancestor-backed browser must remove its own row without another admission pruning it');
 }finally{if(oldContext===undefined)delete process.env[PARENT_CONTEXT];else process.env[PARENT_CONTEXT]=oldContext;}
 await direct.release();
 const parent=await holdBrokerCpu(broker.environment,'all',process.cwd());held.push(parent);
 const blocked=holdBrokerCpu(broker.environment,1,process.cwd()).then(lease=>{held.push(lease);return lease;});
 const previous=process.env[PARENT_CONTEXT];
 process.env[PARENT_CONTEXT]=parentCpuContext(parent.proof,{WS_CPU_ROOT:root});
 try{
  const nested=await holdCpu(4,{root,capacity:12,browser:true});held.push(nested);
  /** @type {{cpuActive:{browser?:boolean,borrowedFrom?:string}[]}} */const snapshot=JSON.parse(readFileSync(resolve(root,'queue.json'),'utf8'));
  assert.equal(snapshot.cpuActive.length,2);
  assert.equal(snapshot.cpuActive.find(row=>row.browser)?.borrowedFrom,parent.proof.lease);
  await nested.release();await parent.release();await blocked;
 }finally{if(previous===undefined)delete process.env[PARENT_CONTEXT];else process.env[PARENT_CONTEXT]=previous;}
 await Promise.all(held.map(lease=>lease.release()));held.length=0;
 const program=`import {holdBrokerCpu} from ${JSON.stringify(new URL('cpu-broker.mjs',import.meta.url).href)};
const grant=await holdBrokerCpu(process.env.WS_BROWSER_CONTROL,4,process.cwd(),{browser:true});
console.log('READY');process.stdin.resume();process.stdin.on('end',async()=>{await grant.release();});`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{env:{...process.env,WS_BROWSER_CONTROL:broker.environment},stdio:['pipe','pipe','pipe']});children.push(child);
 child.stdin.on('error',()=>undefined);child.stderr.resume();
 const ended=new Promise(_resolve=>{child.once('close',_resolve);});
 await new Promise((_resolve,_reject)=>{child.stdout.once('data',_resolve);child.once('error',_reject);child.once('exit',()=>{_reject(new Error('Browser owner ended before admission'));});});
 const survivor=await holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true});held.push(survivor);
 const busy=await holdBrokerCpu(broker.environment,1,process.cwd());held.push(busy);
 third=holdBrokerCpu(broker.environment,4,process.cwd(),{browser:true}).then(lease=>{held.push(lease);return lease;});
 child.kill('SIGKILL');await ended;await third;
 console.log(JSON.stringify({freeCoreSlots:true,thirdWaits:true,ordinaryWorkContinues:true,weightedCpu:10,releaseAdmitsNext:true,cancellation:true,exclusiveParentLent:true,ancestorBrowserReleased:true,crashedOwnerReclaimed:true}));
}finally{
 clearTimeout(deadline);
 await broker.close();
 await Promise.allSettled(held.map(lease=>lease.release()));
 await third?.catch(()=>undefined);
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
}

/** Observe admission's actual pending row instead of assuming a scheduler delay.
 * @param {string} directory */
async function queuedBrowser(directory){
 const until=Date.now()+3000;
 while(Date.now()<until){
  /** @type {{cpuQueue:{browser?:boolean}[]}} */const state=JSON.parse(readFileSync(resolve(directory,'queue.json'),'utf8'));
  if(state.cpuQueue.some(row=>row.browser===true))return;
  await new Promise(_resolve=>{setTimeout(_resolve,10);});
 }
 throw new Error('Browser request never entered the pending ledger');
}
}
