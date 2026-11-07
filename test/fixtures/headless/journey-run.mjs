// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import { HeadlessSimulation } from '../../../src/server/host/headless.ts';
import { emptyShardfile } from '../../../src/shared/host/author.ts';
import { PhysicsRouteCursor } from '../../../src/shared/host/headlessJourney.ts';
import { decodeSimSnapshotBytes, leadSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
const source=emptyShardfile({slug:'journey-fixture',name:'Journey fixture',author:'Test',revision:1,seed:435});
const plan={ticks:30,points:[{x:source.spawn.x,z:source.spawn.z},{x:source.spawn.x+5,z:source.spawn.z}]};
const sim=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
const control=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  const entered=sim.checkpoint;
  await assert.rejects(sim.journey({...plan,ticks:14_401}));
  assert.deepEqual(sim.checkpoint,entered,'invalid route admission must leave the real continuation intact');
  const cursor=new PhysicsRouteCursor(plan.points);
  let saved=decodeSimSnapshotBytes(control.checkpoint.snapshot);
  for(let tick=0;tick<plan.ticks;tick++)saved=decodeSimSnapshotBytes((await control.step([{source:'control',commands:[cursor.command(leadSnapshot(saved).position,tick)]}])).snapshot);
  for(let tick=0;tick<60;tick++)saved=decodeSimSnapshotBytes((await control.step()).snapshot);
  const report=await sim.journey(plan);
  assert.equal(report.ticks,30);assert.equal(report.settledTicks,60);
  assert.equal(report.final.tick,saved.state.tick);
  assert.deepEqual(report.final.position,leadSnapshot(saved).position,'terminal route must use exactly the normal native movement');
  assert.equal(report.final.grounded,leadSnapshot(saved).motor.result.grounded);
  assert.ok(report.distance>0);
  assert.deepEqual(sim.checkpoint,entered,'compact observations are not a resumable checkpoint');
  await assert.rejects(sim.step(),/validation finished/);
  await assert.rejects(sim.journey(plan),/already finished/);
} finally {await sim.dispose();await control.dispose();}
await assert.rejects(sim.step());
const routeSim=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  const start={x:20,z:10,y:source.spawn.y??0,yaw:0};
  const report=await routeSim.journey({ticks:600,start,once:true,points:[{x:start.x,z:start.z},{x:22,z:10}]});
  assert.equal(report.complete,true);assert.equal(report.preparationTicks,36);assert.equal(report.settledTicks,0);
  assert.ok(report.ticks<600,'one-way physics walk must stop at its actual endpoint');
  assert.equal(report.stuck.length,0);assert.ok(Math.hypot(report.final.position[0]-22,report.final.position[2]-10)<.8);
} finally {await routeSim.dispose();}
const ordered=await HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
try {
  let previous=ordered.checkpoint.tick;
  for(const hover of [true,false]){
    const start={x:20,z:10,y:2,yaw:0,hover};
    const result=await ordered.walkLeg({ticks:600,start,once:true,points:[{x:20,z:10},{x:22,z:10}]});
    assert.equal(result.complete,true);assert.ok(result.final.tick>previous);
    const saved=decodeSimSnapshotBytes(ordered.checkpoint.snapshot);
    assert.equal(saved.state.tick,result.final.tick);assert.deepEqual(leadSnapshot(saved).position,result.final.position);
    assert.equal(leadSnapshot(saved).board!==undefined,hover,'a later foot leg must leave the prior board mode');
    previous=result.final.tick;
  }
  assert.equal((await ordered.step()).tick,previous+1,'completed leg publishes a real continuation');
} finally {await ordered.dispose();}
const live=await HeadlessSimulation.create(source,new Map());
try {await assert.rejects(live.journey(plan),/trusted offline timing/);assert.equal(live.checkpoint.tick,0);}
finally {await live.dispose();}
console.log('native journey parity, terminal disposal and runtime refusal pass');
