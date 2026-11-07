// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native physics owner.
import { installCombatMotion } from '@wildshard/engine/game/shardfile/nativeRuntimeLoans';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { parseItems } from '@wildshard/format/items';
import { readFileSync } from 'node:fs';
import { beforeAll,expect,test } from 'vitest';
import { createSimHost,type SimPlayerMotionSample } from '../src/server/engine/sim';
import { createNativeCombatFrame,installNativeItems,otherCombatFrame } from '../src/server/game/plugin/nativeItems';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { pinePin } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// GR8: called, not read from a scheduler job's output
const items = pinePin.product.section('combat/items').items;

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
function plan() {
  return { level: SIM_LEVEL, install: (host: Parameters<typeof installCombatMotion>[0], context: Parameters<typeof installCombatMotion>[1]): void => {
    installCombatMotion(host, context, 7.2);
  } };
}

test('the concrete frame receives the original motion factor before gameplay and adds no saved owner', () => {
  const prepared = plan(), host = createSimHost(prepared.level, { rapier }), frame = createNativeCombatFrame();
  const context = { combat: frame, restoring: false, commands: () => [], emit: () => undefined };
  const sample = { velocityX: 3, velocityZ: 4, grounded: true, swimming: false, hover: false };
  try {
    const saved = snapshotSimHost(host);
    prepared.install(host, context);
    expect(snapshotSimHost(host)).toEqual(saved);
    leadPlayer(host).useDriver({ input: () => true, step: () => undefined, motionSample: () => sample });
    const observed: (number | null)[] = [];
    host.onStep('motion.read', () => { observed.push(frame.speedFactor); });
    const states: SimPlayerMotionSample[] = [sample,
      { ...sample, hover: true }, { ...sample, grounded: false }, { ...sample, grounded: false, swimming: true }];
    for (const value of states) { Object.assign(sample, value); host.step(); }
    expect(observed).toEqual([5 / 7.2, 0, 0, 5 / 7.2]);
    expect(() => prepared.install(host, context)).toThrow('one owned active host');
  } finally { host.dispose(); }
  expect(() => prepared.install(host, context)).toThrow('owner has ended');
});

test('missing combat refuses before registering; delegated motion without a sample still refuses firing', () => {
  const prepared = plan(), host = createSimHost(SIM_LEVEL, { rapier }), frame = createNativeCombatFrame();
  try {
    const saved = snapshotSimHost(host);
    expect(() => prepared.install(host, {})).toThrow('requires its combat frame');
    expect(snapshotSimHost(host)).toEqual(saved);
    prepared.install(host, { combat: frame });
    leadPlayer(host).useDriver({ input: () => true, step: () => undefined });
    host.step(); expect(frame.speedFactor).toBeNull();
    const weapon = parseItems(items).rows.find(row => row.id === 'weapon.lever');
    if (weapon?.kind !== 'weapon' || weapon.ranged === undefined || weapon.profile === undefined) throw new Error('Missing fixture lever');
    installNativeItems(host, frame, { kind: 'cycle', policy: weapon.ranged, profile: weapon.profile });
    const hp = host.entities.get('boar:1')?.hp;
    frame.live.add(weapon.ranged.slot); frame.armed.add(weapon.ranged.slot); frame.attacks.push('boar:1');
    expect(() => host.step()).toThrow('authoritative player sample');
    expect(host.entities.get('boar:1')?.hp).toBe(hp);
  } finally { host.dispose(); }
});

test('a bot moves its own combat frame, not the lead\'s', () => {
  const prepared = plan(), host = createSimHost(prepared.level, { rapier }), frame = createNativeCombatFrame();
  try {
    prepared.install(host, { combat: frame });
    const bot = host.addPlayer('bot:1', { x: 4, y: 0, z: 0 }), own = otherCombatFrame(frame, bot.id);
    const sample = { velocityX: 3, velocityZ: 4, grounded: true, swimming: false, hover: false };
    bot.useDriver({ input: () => true, step: () => undefined, motionSample: () => sample });
    host.step();
    expect(own.speedFactor).toBeCloseTo(5 / 7.2, 5);
    expect(frame.speedFactor).toBe(0);
  } finally { host.dispose(); }
});
