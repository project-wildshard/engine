// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import { createNativeProofWorker } from '../headless-worker.ts';
import { emptyShardfile } from '../../../src/shared/host/author.ts';
import { decodeSimSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
const source = emptyShardfile({slug:'deferred-fixture',name:'Deferred fixture',author:'Test',revision:1,seed:435});
for(const checkpoint of [6,18]) {
  const original = await createNativeProofWorker(source,new Map(),'deferred');
  try {
    let result;
    for(let tick=0;tick<checkpoint;tick++) result=await original.step([]);
    assert.ok(result);
    const actors=decodeSimSnapshot(result.snapshot).entities.map(actor=>actor.id);
    assert.deepEqual(actors,checkpoint===6?['deferred:1']:[]);
    const restored=await createNativeProofWorker(source,new Map(),'deferred',result.snapshot);
    try {
      for(let tick=checkpoint;tick<60;tick++) {
        const a=await original.step([]),b=await restored.step([]);
        assert.deepEqual(a,b,'the SDK install must receive the validated roster and keeper clock');
      }
    } finally {await restored.dispose();}
  } finally {await original.dispose();}
}
console.log(JSON.stringify({checkpoints:2,exact:true,respawns:true}));
