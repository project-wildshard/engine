import { Vector3 } from 'three';
import { expect,test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture lends the shipped physics runtime, not generated shard products.
import { installWakeBoss } from '@wildshard/engine/game/boss/nativeWake';
import { grantNativeInventory,NativeInventory } from '@wildshard/engine/game/inventoryLaw';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost,type SimHost } from '@wildshard/engine/sim';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import { snapshotSimHost } from '@wildshard/engine/sim/snapshot';
import { readFileSync } from 'node:fs';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const marshRows = {
  id: 'reed-titan', level: 'salt-marsh', name: 'The Reed Titan', step: 'marsh.titan', kind: 'boar',
  arena: { radius: 9 }, wakeFlag: 'opened:shell', deadFlag: 'fallen:titan',
  phases: [{ at: 1 }, { at: .5 }],
  fields: { awake: 'summoned', rise: 'emerged', phase: 'stage', poolX: 'home-x', poolZ: 'home-z', arena: 'boundary' },
  presentation: { riseAbove: .2, cuts: [.5] }, events: { restore: 'titan.restore', wake: 'titan.wake' },
};
test('invented native encounter adopts its real body and resumes without spawn or duplicate outcomes', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost(SIM_LEVEL, { rapier });
  const bind = (owner: SimHost) => installWakeBoss(owner, marshRows, { pool: { x: 0, z: 0 }, arena: 9 });
  const shell = bind(host);
  let fork: SimHost | undefined;
  try {
    const actor = host.entities.get('boar:1'); if (actor === undefined) throw new Error('Missing fixture actor');
    actor.mem['emerged'] = 1; actor.mem['stage'] = 2; actor.hp = actor.maxHp * .45;
    host.flags.set('opened:shell'); shell.publish('titan.restore'); host.step();
    expect(shell.encounter.state).toBe('fight'); expect(shell.encounter.phase).toBe(1);
    const size = host.entities.size;
    let restored: ReturnType<typeof installWakeBoss> | undefined;
    fork = restoreSimHost(SIM_LEVEL, { rapier }, snapshotSimHost(host), native => { restored = bind(native); });
    if (restored === undefined) throw new Error('Missing restored shell');
    expect(fork.entities.size).toBe(size); expect(restored.encounter.encounterSnapshot()).toEqual(shell.encounter.encounterSnapshot());
    for (let i = 0; i < 40; i++) { host.step(); fork.step(); }
    expect(restored.encounter.encounterSnapshot()).toEqual(shell.encounter.encounterSnapshot()); expect(fork.entities.get('boar:1')?.hp).toBe(actor.hp);
    const outcomes: string[] = [];
    fork.events.on('boss.attempt', event => { outcomes.push(event.outcome); }, fork.scope);
    fork.flags.set('fallen:titan'); fork.step(); fork.step();
    expect(outcomes).toEqual(['won']); expect(fork.entities.size).toBe(size);
    expect(() => restored?.publish('captain.wake')).toThrow('Unknown boss event');
  } finally { fork?.dispose(); host.dispose(); }
});

test('reward rows resolve only registered native inventories and use their own admission law', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), host = createSimHost(SIM_LEVEL, { rapier });
  try {
    const pack = new NativeInventory({ kinds: ['reed-token', 'shell-token'], slots: 1, counts: { min: 0, max: 99, integer: true, complete: false }, quantity: 'positive-safe-integer', snapshot: 'order', restoreError: 'Bad marsh pack' }, host, 'marsh.pack');
    grantNativeInventory(host, 'marsh.pack', [{ item: 'reed-token', count: 3 }]); expect(pack.count('reed-token')).toBe(3);
    expect(() => grantNativeInventory(host, 'absent.pack', [{ item: 'reed-token', count: 3 }])).toThrow('Missing native inventory');
    expect(() => grantNativeInventory(host, 'marsh.pack', [{ item: 'other-token', count: 1 }])).toThrow(); expect(pack.count('reed-token')).toBe(3);
    expect(() => grantNativeInventory(host, 'absent.pack', [])).toThrow('Missing native inventory');
    grantNativeInventory(host, 'marsh.pack', []); expect(pack.count('reed-token')).toBe(3);
    expect(() => grantNativeInventory(host, 'marsh.pack', [{ item: 'shell-token', count: 1 }])).toThrow('Boss reward rejected');
    expect(pack.snapshot().order).toEqual(['reed-token']);
    expect(() => grantNativeInventory(host, 'marsh.pack', [{ item: 'reed-token', count: 2 }, { item: 'other-token', count: 1 }])).toThrow();
    expect(pack.count('reed-token')).toBe(5);
  } finally { host.dispose(); }
});

test('J104, J107: a wake fight scales for those there when it wakes and outlives a fall while anyone stands in the arena', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), host = createSimHost(SIM_LEVEL, { rapier });
  const lead = [...host.players.values()][0], bot = host.addPlayer('bot:1', { x: 2, y: 0, z: 0 }), step = (): void => { host.step(new Map([...host.players.keys()].map(id => [id, { moveX: 0, moveZ: 0, yaw: 0 }]))); };
  const shell = installWakeBoss(host, marshRows, { pool: { x: 0, z: 0 }, arena: 9 }), actor = host.entities.get('boar:1');
  if (lead === undefined || actor === undefined) throw new Error('Missing fixture');
  const fall = (target: typeof lead): void => { host.combat.hit({ source: 'env', sourceTags: ['creature.boar'], target: target.health, amount: 100000, point: target.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } }); };
  try {
    actor.mem['emerged'] = 1; actor.mem['stage'] = 2;
    host.flags.set('opened:shell'); shell.publish('titan.restore'); step(); step();
    expect(shell.encounter.state).toBe('fight');
    const before = actor.hp;
    host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: actor.combatActor(), amount: 35, point: actor.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    expect(before - actor.hp).toBeCloseTo(35 / 1.75, 0);
    fall(bot); step();
    expect(shell.encounter.state).toBe('fight');
    bot.position.set(30, 0, 30); bot.motor.resetAt(bot.position);
    fall(lead); step();
    expect(shell.encounter.state).toBe('dormant');
  } finally { host.dispose(); }
});
