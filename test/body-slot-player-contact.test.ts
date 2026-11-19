import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {Vector3} from 'three';
import {createSimHost} from '../src/server/engine/sim';
import {Bodies,RowBodySlots} from '../src/shared/engine/physics/bodies';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {Rng} from '@wildshard/format/seededRng';
import {perchFixture} from './fixtures/plain-perch';
import {SIM_LEVEL} from './fixtures/sim-level/level';

async function fixture(){
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host=createSimHost(SIM_LEVEL,{rapier}), body=perchFixture().creatures.perchBodies?.[0];
  const source=host.entities.get('boar:1');
  if(body===undefined||source===undefined)throw new Error('Missing actual pool fixture');
  const service=new Bodies(host.physics,host.playerFocus), pool=new RowBodySlots<typeof source>(body.projectile.pool,service,{kind:'fixture.perch'},host.physics,host);
  const first=host.focusedPlayer,peer=host.addPlayer('fixture.peer',{x:10,y:0,z:10});
  first.position.set(100,0,100);
  const rng=new Rng(37);pool.throw(body.projectile.launch,new Vector3(10,2,10),new Vector3(20,2,10),source,rng);
  const shot=pool.bodyAt(0);if(shot===null)throw new Error('Missing real shot');
  peer.position.set(shot.curr.x,shot.curr.y-1,shot.curr.z);
  return {host,service,pool,source,first,peer,rng,shot};
}

test('native slots contact an actual second player once and retain the real source',async()=>{
  const live=await fixture(),before=live.rng.snapshot();
  try{
    const players=[live.first.position,live.peer.position];
    live.pool.updateTargets(0,1,players);live.pool.updateTargets(0,1,players);
    const events=live.pool.takeEvents();expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('contact');expect(events[0]?.source).toBe(live.source);
    expect(events[0]?.target).toBe(live.peer.position);
    expect(live.pool.snapshot([live.source.entityId]).slots[0]?.state).toBe(2);
    expect(live.rng.snapshot()).toEqual(before);expect(live.pool.takeEvents()).toEqual([]);
  }finally{live.pool.dispose();live.service.dispose();live.host.dispose();}
});

test('an empty player set does not invent a contact or change legacy event bytes',async()=>{
  const live=await fixture();
  try{
    const before=live.pool.snapshot([live.source.entityId]);
    live.pool.updateTargets(0,1,[]);expect(live.pool.takeEvents()).toEqual([]);
    expect(live.pool.snapshot([live.source.entityId])).toEqual(before);
    live.pool.update(0,1,live.peer.position);
    expect(live.pool.takeEvents()).toEqual([{kind:'contact',source:live.source,at:{...live.shot.curr},age:0,wet:0}]);
  }finally{live.pool.dispose();live.service.dispose();live.host.dispose();}
});

test('multiple poses advance native slot clocks exactly once like the single-pose owner',async()=>{
  const legacy=await fixture(),opened=await fixture();
  try{
    legacy.peer.position.set(100,0,100);opened.peer.position.set(100,0,100);
    for(let tick=0;tick<10;tick++){
      legacy.pool.update(1/60,1,legacy.first.position);
      opened.pool.updateTargets(1/60,1,[opened.first.position,opened.peer.position]);
    }
    expect(opened.pool.snapshot([opened.source.entityId])).toEqual(legacy.pool.snapshot([legacy.source.entityId]));
    expect(opened.pool.takeEvents()).toEqual([]);expect(legacy.pool.takeEvents()).toEqual([]);
  }finally{legacy.pool.dispose();legacy.service.dispose();legacy.host.dispose();opened.pool.dispose();opened.service.dispose();opened.host.dispose();}
});

test.each(['nonfinite','cap'] as const)('invalid player poses refuse before advancing the native pool: %s',async fault=>{
  const live=await fixture();
  try{
    const before=live.pool.snapshot([live.source.entityId]);
    const poses=fault==='cap'?Array.from({length:33},()=>live.peer.position):[{x:NaN,y:0,z:0}];
    expect(()=>live.pool.updateTargets(1/60,1,poses)).toThrow('Invalid native body-slot player poses');
    expect(live.pool.snapshot([live.source.entityId])).toEqual(before);
    expect(live.pool.takeEvents()).toEqual([]);
    live.pool.update(0,1,live.peer.position);expect(live.pool.takeEvents()).toHaveLength(1);
  }finally{live.pool.dispose();live.service.dispose();live.host.dispose();}
});
