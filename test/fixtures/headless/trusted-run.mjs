// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import { createNativeProofWorker } from '../headless-worker.ts';
import { emptyShardfile } from '../../../src/shared/host/author.ts';
import { decodeSimSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
const source = emptyShardfile({slug:'trusted-fixture',name:'Trusted fixture',author:'Test',revision:1,seed:435});
const sim = await createNativeProofWorker(source,new Map(),'trusted');
try {
  let checkpoint;
  for(let tick=0;tick<10;tick++) checkpoint=await sim.step([{source:'input',commands:[{kind:'player',moveX:0,moveZ:0,yaw:0,...(tick===0?{attack:{targetId:'fixture.actor'}}:{})}]}]);
  assert.ok(checkpoint);
  const saved=decodeSimSnapshot(checkpoint.snapshot);
  assert.equal(saved.entities.length,1);
  assert.ok((saved.entities[0]?.state.motion.hp??100)<100,'real combat must damage the actual actor');
  const fresh=await createNativeProofWorker(source,new Map(),'trusted',checkpoint.snapshot);
  try {
    let rewards=0;
    for(let tick=0;tick<30;tick++) {
      const commands=[{source:'fixture',commands:[{kind:'script',actorId:'fixture.actor',value:tick}]}];
      const a=await sim.step(commands),b=await fresh.step(commands);
      assert.deepEqual(a,b,'complete native and controller continuation must replay exactly');
      rewards+=a.effects.filter(effect=>effect.kind==='coins').length;
    }
    assert.equal(rewards,1);
  } finally {await fresh.dispose();}
  console.log(JSON.stringify({nativeActors:1,damaged:true,suffixTicks:30,exact:true,rewards:1}));
} finally {await sim.dispose();}
