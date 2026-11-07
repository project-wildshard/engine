import type { PrepareHeadlessRuntime } from '../../../src/server/host/headlessRuntime';
import type { SimLevel } from '@wildshard/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Actual native actors and gameplay adapter; imported inside the SDK's ordinary watchdog worker. */
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = ({ shard }) => {
  if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('Trusted fixture requires plain Node');
  const level: SimLevel = {
    version: 3, id: shard.identity.slug, seed: shard.identity.seed,
    ground: { size: 32, height: 0 }, player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 3 },
    weapon: { id: 'fixture.strike', shape: { kind: 'arc', radius: 2.2, halfAngle: Math.PI / 2 }, windup: 0.07, active: 0.165, recover: 0.115, cooldown: 0.08, range: 2.2, damage: 28, tags: [] },
    entities: [{ id: 'fixture.actor', seed: 7, scale: 1, at: { x: 0, y: 0, z: 1.6 }, yaw: 0,
      spec: { kind: 'fixture', label: 'Native actor', variant: 'default', rarity: 'common', hp: 100, aggressive: false,
        dims: { bodyY: 0.6, bodyHalfLen: 0.55, bodyRadius: 0.35, headRadius: 0.2, legLen: 0.55, feet: [], halfWidth: 0.35 },
        mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } } }], quests: [],
  };
  return { level, install: (host, context) => {
    let counter = 0;
    host.onStep('fixture.controller', () => {
      counter++;
      host.slots.questState['numeric'] = context.commands().filter(command => command.kind === 'script').map(command => command.value);
      if (counter === 20) context.emit({ kind: 'coins', amount: 7, actorId: leadPlayer(host).id });
    }, { snapshot: () => counter, restore: value => { if (typeof value !== 'number') throw new Error('Invalid controller state'); counter = value; } });
  } };
};
