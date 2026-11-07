import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {tamingRig} from './fixtures/tamingServices';

test.each([[null,[.25]],[null,[.65,.8,.1]],[null,[.9,.3,.8]],['bond',[.25]]] as const)('guest/native taming preserves historical wire and native order from %s', (saved,draws)=>{
  const next=tamingRig(saved,'wild',null,'ordinary',1,false,new Scope('next'),draws),old=tamingRig(saved,'wild',null,'ordinary',1,true,new Scope('old'),draws);
  expect(next.binding.snapshot()).toBe(old.binding.snapshot());
  next.allowMount();old.allowMount();next.binding.startBreaking();old.binding.startBreaking();
  expect(next.events).toStrictEqual(old.events);expect(next.binding.snapshot()).toBe(old.binding.snapshot());
  let previous=0;
  for(let i=0;i<400&&old.binding.phase==='breaking';i++){
    const balance=old.binding.view.balance,lean=Math.max(-1,Math.min(1,balance*8+(balance-previous)*20));previous=balance;
    next.hud.lean=lean;old.hud.lean=lean;next.events.length=0;old.events.length=0;
    const dt=[.016,.017,.067,.1,.2,.03,.07][i%7]??.1;
    next.binding.update(dt);old.binding.update(dt);
    expect(next.events).toStrictEqual(old.events);expect(next.binding.snapshot()).toBe(old.binding.snapshot());
    expect(next.binding.view).toStrictEqual(old.binding.view);expect(next.herd.stallion?.mem).toStrictEqual(old.herd.stallion?.mem);
  }
  expect(next.binding.phase).toBe(old.binding.phase);
});

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
