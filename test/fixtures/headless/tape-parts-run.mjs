// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert native worker results, never a supplied gameplay verdict.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the unchanged request clock without a real 30-second stall.
import {hrtime} from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the fixed trusted native loader.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Node imports the loader by file URL.
import {pathToFileURL} from 'node:url';
import {HeadlessSimulation} from '../../../src/server/host/headless.ts';
import {TickWorkerHost} from '../../../src/server/host/tickWorkerHost.ts';
import {emptyShardfile} from '../../../src/shared/host/author.ts';

const source=emptyShardfile({slug:'tape-parts-fixture',name:'Tape parts',author:'Test',revision:1,seed:417});
source.serverBudget.commandsPerTick=1;
const open=()=>HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
const plan=(id,frames)=>({version:1,observe:[],segments:[{id,ticks:frames.length,commands:[],frames}]});
const actual=await open(),control=await open();
try{
  const frames=Array.from({length:72},(_,tick)=>tick<48?[{kind:'player',moveX:.2,moveZ:tick<24?0:-.3,yaw:tick/100}]:[]);
  for(let from=0;from<frames.length;from+=24){
    for(const commands of frames.slice(from,from+24))await control.step([{source:'control',commands}]);
    const part=await actual.verbTapePart(plan(String(from),frames.slice(from,from+24)));
    assert.equal(part.report.ticks,24);assert.equal(part.commit.tick,from+24);
    assert.equal(part.report.observations.at(-1).tick,part.commit.tick);
    assert.equal(part.commit.snapshot,control.checkpoint.snapshot,'same input, native world, and complete checkpoint');
    assert.equal(actual.checkpoint.snapshot,part.commit.snapshot);
    part.commit.snapshot='caller mutation';assert.equal(actual.checkpoint.snapshot,control.checkpoint.snapshot);
  }
  const saved=actual.checkpoint;
  await assert.rejects(actual.verbTapePart(plan('0',[[]])),/aggregate allowance/);
  await assert.rejects(actual.verbTapePart(plan('too-many',[[{kind:'player',moveX:0,moveZ:0,yaw:0},{kind:'player',moveX:0,moveZ:0,yaw:0}]])),/commandsPerTick/);
  assert.deepEqual(actual.checkpoint,saved);assert.equal(actual.quarantined,false);
  await assert.rejects(actual.step(),/busy/);
  await assert.rejects(actual.verbTape(plan('terminal',[[]])),/busy/);
  await assert.rejects(actual.observe(),/busy/);
  assert.equal((await actual.finish()).ticks,72);
  await assert.rejects(actual.verbTapePart(plan('after-finish',[[]])),/finished/);
}finally{await actual.dispose();await control.dispose();}
// A first tape part may follow ordinary real steps or a non-terminal walk.
// Both it and an independent worker restored at that earned checkpoint must
// publish the identical next native continuation, including nonzero clocks.
for(const prefix of ['step','walk']){
  const first=await open();let restored;
  try{
    if(prefix==='step')await first.step([{source:'prefix',commands:[{kind:'player',moveX:.2,moveZ:0,yaw:0}]}]);
    else await first.walkLeg({ticks:4,points:[{x:0,z:0},{x:40,z:0}]});
    const saved=first.checkpoint;assert.ok(saved);assert.ok(saved.tick>0);
    restored=await HeadlessSimulation.create(source,new Map(),saved.snapshot,{deadline:'advisory'});
    const continued=await first.verbTapePart(plan('after-prefix',[[]]));
    const replayed=await restored.verbTapePart(plan('after-restore',[[]]));
    assert.equal(continued.commit.tick,saved.tick+1);
    assert.equal(replayed.commit.tick,saved.tick+1);
    assert.equal(continued.commit.snapshot,replayed.commit.snapshot,'prior '+prefix+' and nonzero restore retain the complete native continuation');
    assert.equal(first.quarantined,false);assert.equal(restored.quarantined,false);
  }finally{await restored?.dispose();await first.dispose();}
}
const runtime=await HeadlessSimulation.create(source,new Map());
try{const before=runtime.checkpoint;await assert.rejects(runtime.verbTapePart(plan('runtime',[[]])),/trusted offline/);assert.deepEqual(runtime.checkpoint,before);}
finally{await runtime.dispose();}
const idle=await open(),realClock=hrtime.bigint;
try{
  await idle.verbTapePart(plan('first',[[]]));
  hrtime.bigint=()=>realClock()+31_000_000_000n;
  assert.equal((await idle.verbTapePart(plan('second',[[]]))).commit.tick,2,'a new request has its own unchanged clock');
}finally{hrtime.bigint=realClock;await idle.dispose();}
const args=['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href];
for(const mode of ['deadline','dispose']){
  const entered=new Int32Array(new SharedArrayBuffer(4));
  const blocked=new TickWorkerHost(new URL('tape-part-blocked-worker.mjs',import.meta.url),{entered:entered.buffer},
    {tickMicros:16666,commandsPerTick:1},args,'advisory');
  try{
    const pending=blocked.verbTapePart(plan('blocked',[[]]));
    const competing=assert.rejects(blocked.observe(),/busy/);
    await blocked.initialized();const before=blocked.checkpoint;
    const rejected=assert.rejects(pending,mode==='deadline'?/request deadline exceeded/:/disposed/);
    const waiting=Atomics.waitAsync(entered,0,0);if(waiting.async)await waiting.value;await competing;
    if(mode==='deadline')hrtime.bigint=()=>realClock()+31_000_000_000n;else await blocked.dispose();
    await rejected;assert.equal(blocked.quarantined,true);assert.deepEqual(blocked.checkpoint,before);
  }finally{hrtime.bigint=realClock;await blocked.dispose();}
}
const wide=new TickWorkerHost(new URL('stream-wide-worker.mjs',import.meta.url),{},
  {tickMicros:16666,commandsPerTick:1},args,'advisory');
try{
  await wide.initialized();const observe=Array.from({length:6},(_,index)=>`wide-${index}`);
  for(let index=0;index<2;index++)await wide.verbTapePart({...plan(String(index),[[]]),observe});
  const before=wide.checkpoint;
  await assert.rejects(wide.verbTapePart({...plan('too-wide',[[]]),observe}),/observation allowance/);
  assert.equal(wide.quarantined,true);assert.deepEqual(wide.checkpoint,before);
}finally{await wide.dispose();}
console.info('bounded tape parts retain native parity, commits, ownership, aggregate budgets and request deadlines');
