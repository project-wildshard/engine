import {expect,test} from 'vitest';
import {tamingRig} from './fixtures/tamingServices';

// ZONE-SNAPSHOTS ZS9 (J507): the historical-wire replay of the finished port went with the frozen riding guest: Nalati's
// live v2 riding guest steers its cue on its own (-1 at rest) where the ABI1 witness still reports 0, so that oracle
// proves nothing players run. The checkpoint case below still holds on the live guest.
test('eligible queries are read only and an original mid-round checkpoint continues byte exactly',()=>{
  const next=tamingRig(),old=tamingRig(null,'wild',null,'ordinary',1,true);next.allowMount();old.allowMount();
  next.binding.startBreaking();old.binding.startBreaking();next.binding.update(.03);old.binding.update(.03);
  const checkpoint=old.binding.snapshot(),horse=next.herd.stallion;if(horse===null)throw new Error('Missing horse');
  next.binding.restore(checkpoint,[horse]);expect(next.binding.snapshot()).toBe(checkpoint);
  const wire=next.binding.snapshot();next.events.length=0;next.binding.canTame(horse);expect(next.events).toStrictEqual([]);expect(next.binding.snapshot()).toBe(wire);
  for(const dt of [.07,.03,.04,.03,.5,.01]){
    next.events.length=0;old.events.length=0;next.binding.update(dt);old.binding.update(dt);
    expect(next.binding.snapshot()).toBe(old.binding.snapshot());expect(next.events).toStrictEqual(old.events);
  }
});

test('driven-off and shot events preserve one-shot trust, alert and historical drove ordering',()=>{
  const next=tamingRig(),old=tamingRig(null,'wild',null,'ordinary',1,true);
  for(const apply of [(f:ReturnType<typeof tamingRig>)=>f.binding.noteEvent('pack-driven-off',0,0),(f:ReturnType<typeof tamingRig>)=>f.binding.noteEvent('pack-break',0,0),(f:ReturnType<typeof tamingRig>)=>f.binding.noteShot(0,0)]){
    next.events.length=0;old.events.length=0;apply(next);apply(old);expect(next.binding.snapshot()).toBe(old.binding.snapshot());expect(next.events).toStrictEqual(old.events);expect(next.herd.trust).toBe(old.herd.trust);expect(next.herd.alert).toBe(old.herd.alert);
  }
});
