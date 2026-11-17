import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { emptyShardfile } from '../../src/shared/host/author';

export const skirmisherTuning = { thinkDivisor: 3, awareRadius: 14, shyRadius: 8, disengageRadius: 24, holdRadius: 3,
  attackRadius: 2, attackDuration: 0.8, attackCooldown: 1.2, alertCooldown: 0.3, fleeSpeed: 5,
  subordinateVariant: 'small', leaderVariant: 'leader', noticeCue: 'notice' };
export function groundFixture(layer = false) {
  const base = emptyShardfile({ slug: 'plain-skirmisher', name: 'Plain skirmisher', author: 'Test', revision: 1, seed: 39 });
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], looks: [],
    strikes: [{ id: 'fixture.bite', shape: { kind: 'sphere', radius: 2 }, windup: 0.2, active: 0.1, recover: 0.5,
      cooldown: 1.2, range: 2, damage: 7, tags: ['creature.fixture'], weight: 1, speed: 0 }],
    species: [{ id: 'fixture.creature', kind: 'fixture.label', label: 'Fixture', aggressive: true, lockable: true,
      dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
      variants: [{ id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1], hp: 117,
        mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } }],
      ...(layer ? { temperament: { brain: 'skirmisher', reaction: 'aggressive', leash: 35, assist: 0,
        home: { speed: 2, stop: 1 }, tuning: skirmisherTuning }, senses: { notice: 14 } } : {}) }] });
  const creatures = parse(CreaturesSchema, { brains: layer ? [] : [{ id: 'fixture.brain', kind: 'skirmisher', ...skirmisherTuning }], groups: [],
    spawns: [{ id: 'fixture.actor', species: 'fixture.creature', variant: 'plain', brain: layer ? null : 'fixture.brain',
      strike: 'fixture.bite', at: [0, 0, 7], seed: 9, scale: 1, yaw: Math.PI }] });
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, rows, creatures };
}

