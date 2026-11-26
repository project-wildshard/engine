import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {cpus} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'vitest';
import {holdBrokerCpu,startCpuBroker} from '../scripts/cpu-broker.mjs';

const capacity=Math.min(8,cpus().length-2);

test.skipIf(capacity<2)('bounds one test run without taking spare CPU from peers or shrinking exclusive proofs',async()=>{
 const scratch=resolve(process.env.VITEST_TMP_ROOT??'tmp');
 mkdirSync(scratch,{recursive:true});
 const work=mkdtempSync(join(scratch,'cpu-cohort-')),root=join(work,'cpu');
 const cohortSlots=Math.min(6,capacity-1);
 const brokers=[],leases=[];
 try{
  const scoped=await startCpuBroker({root,capacity,cohortSlots});brokers.push(scoped);
  const peer=await startCpuBroker({root,capacity});brokers.push(peer);
  const request=async(broker,slots)=>{
   const lease=await holdBrokerCpu(broker.environment,slots,work,{signal:AbortSignal.timeout(5000)});
   leases.push(lease);return lease;
  };

  await assert.rejects(request(scoped,capacity),/cohort CPU budget/u);
  const large=await request(scoped,cohortSlots);
  let overflowAdmitted=false;
  const overflow=request(scoped,1).then(held=>{overflowAdmitted=true;return held;});
  void overflow.catch(()=>undefined);
  const spare=await request(peer,capacity-cohortSlots);
  assert.equal(overflowAdmitted,false);
  await spare.release();await large.release();
  const small=await overflow;
  assert.equal(small.proof.slots,1);
  await small.release();

  const whole=await request(scoped,'all');
  assert.equal(whole.proof.slots,capacity);
  await whole.release();
  for(const broker of brokers)await broker.close();
  const state=JSON.parse(readFileSync(join(root,'queue.json'),'utf8'));
  assert.deepEqual(state.cpuActive,[]);
  assert.deepEqual(state.cpuQueue,[]);
 }finally{
  await Promise.allSettled(leases.map(held=>held.release()));
  await Promise.allSettled(brokers.map(broker=>broker.close()));
  rmSync(work,{recursive:true,force:true});
 }
},20000);
