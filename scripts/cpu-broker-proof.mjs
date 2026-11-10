// Actual sockets and the shared FIFO policy, with real killed owners; outside hooks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {startCpuBroker,holdBrokerCpu} from './cpu-broker.mjs';
import {holdCpu} from './cpu-admission.mjs';

const directory=resolvePath(process.argv[2]??'tmp/cpu-broker-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),root=join(work,'cpu'),leases=[];
const broker=await startCpuBroker({root,capacity:2});
let killedBroker;
/** @param {number} ms */
const pause=ms=>new Promise(resolve=>{setTimeout(resolve,ms);});
try{
 const a=join(work,'a'),b=join(work,'b');mkdirSync(a);mkdirSync(b);
 const full=await holdBrokerCpu(broker.environment,'all',a);leases.push(full);
 let ready=false;
 const waiting=holdBrokerCpu(broker.environment,1,b).then(lease=>{ready=true;return lease;});
 await pause(60);assert.equal(ready,false);await full.release();
 const one=await waiting,two=await holdCpu(1,{root,capacity:2,repo:a});leases.push(one,two);
 assert.equal(one.proof.slots+two.proof.slots,2);
 let exclusiveReady=false;
 const exclusive=holdBrokerCpu(broker.environment,'all',b).then(lease=>{exclusiveReady=true;return lease;});
 await one.release();await pause(40);assert.equal(exclusiveReady,false);await two.release();
 const all=await exclusive;leases.push(all);await all.release();
 await assert.rejects(holdBrokerCpu(JSON.stringify({...JSON.parse(broker.environment),token:'wrong'}),1,a));
 await assert.rejects(holdBrokerCpu(broker.environment,3,a));

 const childFile=join(work,'client.mjs');
 writeFileSync(childFile,`import {holdBrokerCpu} from ${JSON.stringify(new URL('cpu-broker.mjs',import.meta.url).href)};const lease=await holdBrokerCpu(process.env.BROKER,'all',process.cwd());console.log('ready');process.stdin.resume();`);
 const child=spawn(process.execPath,[childFile],{env:{...process.env,BROKER:broker.environment},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',data=>{output+=data;});
 const childEnded=new Promise(resolve=>{child.once('exit',resolve);});
 const began=Date.now();while(!output.includes('ready')&&Date.now()-began<3000)await pause(5);assert.ok(output.includes('ready'));
 child.kill('SIGKILL');await childEnded;
 const afterKill=await holdBrokerCpu(broker.environment,'all',b);leases.push(afterKill);await afterKill.release();
 const lost=await holdBrokerCpu(broker.environment,1,a);leases.push(lost);
 await broker.close();await lost.lost;await lost.release();
 const state=JSON.parse(readFileSync(join(root,'queue.json'),'utf8'));
 assert.deepEqual(state.cpuActive,[]);assert.deepEqual(state.cpuQueue,[]);
 killedBroker=await startCpuBroker({root,capacity:2});
 const held=await holdBrokerCpu(killedBroker.environment,'all',a);leases.push(held);
 assert.ok(killedBroker.pid!==undefined);process.kill(killedBroker.pid,'SIGKILL');
 await assert.rejects(killedBroker.lost);await held.lost;await held.release();
 const recovered=await holdCpu('all',{root,capacity:2,repo:a});leases.push(recovered);await recovered.release();
 const scoped=await startCpuBroker({root,capacity:2,scopeSlots:1});
 try{
  await assert.rejects(async()=>{
   const oversized=await holdBrokerCpu(scoped.environment,2,a);
   leases.push(oversized);await oversized.release();
  },/CPU broker request/);
  const local=await holdBrokerCpu(scoped.environment,1,a);leases.push(local);
  let secondReady=false;
  const second=holdBrokerCpu(scoped.environment,1,b).then(lease=>{leases.push(lease);secondReady=true;return lease;});
  // Another repo can use the spare machine slot while this broker is full.
  const external=await holdCpu(1,{root,capacity:2,repo:b});leases.push(external);
  assert.equal(secondReady,false);await local.release();
  const next=await second;assert.equal(next.proof.capacity,2);await next.release();
  let quietReady=false;
  const quiet=holdBrokerCpu(scoped.environment,'all',a).then(lease=>{leases.push(lease);quietReady=true;return lease;});
  await pause(40);assert.equal(quietReady,false);await external.release();
  const exclusiveGrant=await quiet;assert.equal(exclusiveGrant.proof.slots,2);await exclusiveGrant.release();
 }finally{await scoped.close();}
 const scopedState=JSON.parse(readFileSync(join(root,'queue.json'),'utf8'));
 assert.deepEqual(scopedState.cpuActive,[]);assert.deepEqual(scopedState.cpuQueue,[]);
 console.log(JSON.stringify({sharedWithCommandOwners:true,exclusiveFIFO:true,capacity:2,scopeSlots:1,killedClientDrained:true,invalidRequestsRefused:true,brokerLossObserved:true,killedBrokerRecovered:true,remaining:0}));
}finally{await Promise.all(leases.map(lease=>lease.release()));await broker.close();if(killedBroker!==undefined)await killedBroker.close().catch(()=>undefined);rmSync(work,{recursive:true,force:true});}
