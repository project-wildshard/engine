import {BOAR} from '../../client/game/systems/species/boar';
import type {SimLevel} from '@wildshard/engine/sim';

/** The shared real creature recipe used by level scenarios and game units. */
export const SIM_CREATURE_RECIPE: SimLevel['entities'][number] = { id: 'boar:1', seed: 7, scale: 1, at: { x: 0, y: 0, z: 1.6 }, yaw: Math.PI,
    spec: { kind: BOAR.kind, label: BOAR.label, variant: 'boar', rarity: 'common', hp: BOAR.tuning?.hp ?? 100,
      aggressive: BOAR.aggressive ?? false, lockable: BOAR.lockable ?? false,
      dims: { bodyY: 0.6, bodyHalfLen: 0.55, bodyRadius: 0.35, headRadius: 0.2, legLen: 0.55, feet: [], halfWidth: 0.35 },
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: BOAR.chargeDamage ?? 25, relentless: false } },
    strike: { id: 'boar.charge', shape: { kind: 'point', radius: 2 }, windup: BOAR.chargeWindup ?? 0.55,
      active: 0.15, recover: 0.8, cooldown: 1, range: 2, damage: BOAR.chargeDamage ?? 25, tags: ['creature.boar'] } };
