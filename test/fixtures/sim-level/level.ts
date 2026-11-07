import { SIM_CREATURE_RECIPE } from '../../../src/test/game/creatureRecipe';
import { IRON_SWORD } from '@wildshard/engine/game/weapons/starterMeleeProfile';
import type { SimCommand, SimLevel } from '@wildshard/engine/sim';

/** A real shared species and iron sword on plain flat ground, with no shard runtime or renderer. */
export const SIM_LEVEL: SimLevel = {
  version: 3, id: 'sim-fixture', seed: 435,
  ground: { size: 32, height: 0 }, player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 3 },
  weapon: { id: IRON_SWORD.id, shape: { kind: 'arc', radius: 2.2, halfAngle: Math.PI / 2 },
    windup: 0.07, active: 0.165, recover: 0.115, cooldown: 0.08, range: 2.2, damage: 28, tags: ['weapon.sword-iron', 'dmg.melee'] },
  entities: [SIM_CREATURE_RECIPE],
  quests: [{ id: 'clear-arena', title: 'Clear arena', steps: [{ id: 'boar', objective: 'Defeat the boar', done: { all: ['dead:boar:1'] } }], completeFlag: 'quest:arena' }],
};
/** Recorded fixture fight: spaced attacks include pending windup, contact and recovery windows. */
export function fightCommand(tick: number): SimCommand {
  return { moveX: 0, moveZ: 0, yaw: 0, ...(tick % 90 === 0 ? { attack: { targetId: 'boar:1' } } : {}) };
}
