// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import {HeadlessSimulation} from '../../../src/server/host/headless.ts';
import {emptyShardfile} from '../../../src/shared/host/author.ts';
import {decodeSimSnapshotBytes, leadSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
const source=emptyShardfile({slug:'verb-tape-fixture',name:'Verb tape',author:'Test',revision:1,seed:435});
source.serverBudget.commandsPerTick=1;
const input={kind:'player',moveX:.2,moveZ:0,yaw:0};
const plan={version:1,observe:[],segments:[{id:'walk',ticks:12,commands:[input]},{id:'release',ticks:60,commands:[]}]};
const sim=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
const control=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  const initial=sim.checkpoint;
  await assert.rejects(sim.verbTape({...plan,segments:[{id:'overflow',ticks:1,commands:[input],route:[{x:0,z:0},{x:2,z:0}]}]}),/Aggregate/);
  assert.deepEqual(sim.checkpoint,initial,'generated route input shares the ordinary command allowance');
  await assert.rejects(sim.verbTape({...plan,segments:[{id:'too-many',ticks:60_001,commands:[]}]}));
  assert.deepEqual(sim.checkpoint,initial,'invalid tape must retain the real continuation');
  let last=decodeSimSnapshotBytes(control.checkpoint.snapshot);
  for(let tick=0;tick<72;tick++)last=decodeSimSnapshotBytes((await control.step([{source:'control',commands:tick<12?[input]:[]}])).snapshot);
  const report=await sim.verbTape(plan);
  assert.equal(report.ticks,72);assert.deepEqual(report.observations.map(row=>row.tick),[12,72]);
  assert.deepEqual(report.observations.at(-1).position,leadSnapshot(last).position,'batch must use exactly the normal native ticks');
  assert.equal(report.observations.at(-1).grounded,leadSnapshot(last).motor.result.grounded);
  assert.deepEqual(sim.checkpoint,initial,'terminal observations cannot become a resumable checkpoint');
  assert.equal(sim.quarantined,false);
  await assert.rejects(sim.step(),/validation finished/);
  await assert.rejects(sim.verbTape(plan),/already finished/);
}finally{await sim.dispose();await control.dispose();}
const runtime=await HeadlessSimulation.create(source,new Map());
try {
  await assert.rejects(runtime.verbTape(plan),/trusted offline timing/);
  assert.equal(runtime.checkpoint.tick,0);await runtime.step();
}finally{await runtime.dispose();}
const failed=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  const before=failed.checkpoint;
  await assert.rejects(failed.verbTape({...plan,observe:['undeclared.owner']}),/Missing tape observation owner/);
  assert.equal(failed.quarantined,true);assert.deepEqual(failed.checkpoint,before);
}finally{await failed.dispose();}
console.log('native verb tape parity, terminal ownership and runtime refusal pass');

const recorded=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
const ordinary=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  const frames=Array.from({length:72},(_,tick)=>tick<48?[{kind:'player',moveX:tick<24?.3:0,moveZ:tick<24?0:-.3,yaw:tick/100}]:[]);
  const initial=recorded.checkpoint;
  await assert.rejects(recorded.verbTape({version:1,observe:[],segments:[{id:'too-many',ticks:1,commands:[],frames:[[input,input]]}]}),/Aggregate/);
  assert.deepEqual(recorded.checkpoint,initial,'every explicit frame retains the ordinary command budget');
  for(const commands of frames)await ordinary.step([{source:'recording',commands}]);
  const report=await recorded.verbTape({version:1,observe:[],segments:[{id:'recorded',ticks:frames.length,commands:[],frames}]});
  assert.deepEqual(report.observations[0].position,leadSnapshot(decodeSimSnapshotBytes(ordinary.checkpoint.snapshot)).position,'explicit frames must run the same actual native ticks');
  assert.equal(report.ticks,72);assert.equal(recorded.quarantined,false);
}finally{await recorded.dispose();await ordinary.dispose();}
console.log('native per-tick input replay and frame budget pass');
