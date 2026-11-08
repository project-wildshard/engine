import {expect,test,vi} from 'vitest';
import {roomBench} from './fixtures/dedicated/roomBench';
import {RoomBot} from './fixtures/dedicated/roomBot';
import {ownedWeaponAttribute} from '../src/server/game/loadout/ownedEffects';

// Explicit CI/manual proof, outside the hook suite. Real socket seats and
// admitted Driftwood effects must retain their separate owned documents.
test('two real seats keep heart and weapon effects separate across book reuse', {timeout:9000}, async()=>{
  const bench=await roomBench({holdMs:50}),a=new RoomBot(bench.url,'bench','device:effect-a','A'),b=new RoomBot(bench.url,'bench','device:effect-b','B');
  let returned:RoomBot|undefined;
  try{
    expect(await a.arrived()).toBe(true);expect(await b.arrived()).toBe(true);
    const room=bench.room('driftwood-isle'),first=room?.bodyOf('device:effect-a'),second=room?.bodyOf('device:effect-b');
    if(room===undefined||first===undefined||second===undefined)throw new Error('Missing real seats');
    const own=room.cell.owned.of(first.id),other=room.cell.owned.of(second.id);
    const baseline=first.health.attributes.maxHealth;
    expect(second.health.attributes.maxHealth).toBe(baseline);
    own.owned.grant('heart-1');own.owned.grant('whetstone-1');
    expect(first.health.attributes.maxHealth).toBe(baseline+20);
    expect(second.health.attributes.maxHealth).toBe(baseline);
    expect(ownedWeaponAttribute(room.host,first,'sword','damage',12)).toBe(15);
    expect(ownedWeaponAttribute(room.host,second,'sword','damage',12)).toBe(12);
    other.owned.grant('heart-1');other.owned.grant('heart-2');
    expect(second.health.attributes.maxHealth).toBe(baseline+40);
    a.drop();
    await vi.waitFor(()=>{expect(room.bodyOf('device:effect-a')).toBeUndefined();},{timeout:2500,interval:10});
    returned=new RoomBot(bench.url,'bench','device:effect-a','A');
    expect(await returned.arrived()).toBe(true);
    const resumed=room.bodyOf('device:effect-a');
    if(resumed===undefined)throw new Error('Missing restored seat');
    expect(resumed.health.attributes.maxHealth).toBe(baseline+20);
    expect(ownedWeaponAttribute(room.host,resumed,'sword','damage',12)).toBe(15);
    expect(second.health.attributes.maxHealth).toBe(baseline+40);
    expect(ownedWeaponAttribute(room.host,second,'sword','damage',12)).toBe(12);
  }finally{returned?.drop();a.drop();b.drop();await bench.close();}
});
