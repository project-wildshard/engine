import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { parseRows, type ShardRows } from '@wildshard/format/rows';
import { CreaturesSchema, type ShardCreatures } from '@wildshard/format/creatures';
import { CREATURE_SKELETONS } from '@wildshard/format/creatureSkeletons';
import { speciesResolver } from '../plugin/brain';
import { prepareCreaturePolicies, resolveCreatureLayers } from './creatureLayers';

function fixture(layered = true): ShardRows {
  return parseRows({ weather: [], days: [], compendiums: [], loot: [],
    strikes: [{ id: 'fixture.bite', shape: { kind: 'sphere', radius: 1 }, windup: 0.2, active: 0.1, recover: 0.3,
      cooldown: 1, range: 2, damage: 12, tags: ['creature.fixture'], weight: 1, speed: 0 }],
    species: [{ id: 'fixture.creature', kind: 'fixture.label', label: 'Fixture', aggressive: true, lockable: true,
      dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
      variants: [{ id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1], hp: 117,
        mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } }],
      ...(layered ? { body: { skeleton: 'quadruped', size: 'medium', scale: 1, look: 'fixture.look' },
        temperament: { brain: 'pursue', reaction: 'neutral', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
          tuning: { speed: 1.2, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 3, wanderEveryTicks: 420 } },
        senses: { notice: 18 }, presentation: { blood: true, sounds: {} },
        abilities: [{ use: 'fixture.bite', range: [0, 2], cooldown: 2, weight: 3, damage: 17 }],
      } : {}),
    }],
    looks: [{ id: 'fixture.look', species: 'fixture.creature', recipe: 'platform.skin', material: null,
      parameters: {}, animation: { recipe: 'platform.clips', parameters: {} } }],
  });
}

test('species construction preflights named layers and kind labels never choose mechanics', () => {
  const rows = fixture(), before = JSON.stringify(rows), layers = resolveCreatureLayers(rows).get('fixture.creature');
  expect(layers?.skeleton).toBe(CREATURE_SKELETONS.quadruped);
  expect(layers?.brain).toMatchObject({ kind: 'declared', referenced: false, declaration: {
    kind: 'pursue', awareRadius: 18, leashRadius: 35, returnSpeed: 2, stopDistance: 1, speed: 1.2,
  } });
  expect(layers?.abilities[0]?.strike.damage).toBe(12);
  expect(layers?.abilities[0]?.ability.damage).toBe(17);
  expect(JSON.stringify(rows)).toBe(before);
  expect(speciesResolver(rows)('fixture.creature', 'plain')).toMatchObject({ hp: 117, aggressive: false, kind: 'fixture.label' });
  const row = rows.species[0]; if (row === undefined) throw new Error('Missing fixture species');
  row.kind = 'entirely.different';
  expect(resolveCreatureLayers(rows).get(row.id)).toEqual(layers);
  expect(speciesResolver(rows)(row.id, 'plain').kind).toBe('entirely.different');
});

test('declared policy references keep every original parameter and generated ids avoid collisions', () => {
  const rows = fixture(), row = rows.species[0]; if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
  const brains: ShardCreatures['brains'] = [{ id: 'owned-policy', kind: 'pursue', awareRadius: 23, leashRadius: 47,
    speed: 2.7, returnSpeed: 3, stopDistance: 1.5, turnRate: 6, thinkDivisor: 3, attackCooldownTicks: 90, wanderRadius: 2, wanderEveryTicks: 500 }];
  row.temperament.brain = 'owned-policy'; delete row.temperament.tuning;
  const resolved = resolveCreatureLayers(rows, brains).get(row.id);
  expect(resolved?.brain).toEqual({ kind: 'declared', declaration: brains[0], referenced: true });
  row.temperament.tuning = { speed: 7 };
  expect(() => speciesResolver(rows, brains)).toThrow('species `fixture.creature`: brain reference owned-policy keeps its declared tuning');
  const original = brains[0]; if (original?.kind !== 'pursue') throw new Error('Missing pursuit fixture');
  const collision = { ...original, id: 'layers.0' };
  const generated = resolveCreatureLayers(fixture(), [collision]).get(row.id)?.brain;
  expect(generated).toMatchObject({ kind: 'declared', referenced: false, declaration: { id: 'layers.0x' } });
});

test('invalid brain numbers, names, skeletons and ability references refuse before actor lookup', () => {
  for (const mutation of ['numbers', 'brain', 'skeleton', 'ability', 'temperament'] as const) {
    const rows = fixture(), row = rows.species[0]; if (row === undefined) throw new Error('Missing fixture species');
    if (mutation === 'numbers') Reflect.set(row.temperament?.tuning ?? {}, 'speed', 'fast');
    if (mutation === 'brain') Reflect.set(row.temperament ?? {}, 'brain', 'unknown-policy');
    if (mutation === 'skeleton') Reflect.set(row.body ?? {}, 'skeleton', 'invented');
    if (mutation === 'ability') Reflect.set(row.abilities?.[0] ?? {}, 'use', 'missing.strike');
    if (mutation === 'temperament') delete row.temperament;
    expect(() => speciesResolver(rows), mutation).toThrow('species `fixture.creature`');
  }
});

test('a custom GLB omits a kit skeleton, while flat declarations retain their explicit physics', () => {
  const rows = fixture(), row = rows.species[0]; if (row?.body === undefined || row.temperament === undefined) throw new Error('Missing fixture layers');
  delete row.body.skeleton; row.temperament.brain = 'none'; delete row.temperament.tuning;
  const resolved = resolveCreatureLayers(rows).get(row.id);
  expect(resolved?.brain).toEqual({ kind: 'none' });
  expect(resolved?.skeleton).toBeUndefined();
  expect(resolveCreatureLayers(fixture(false)).size).toBe(0);
  expect(speciesResolver(fixture(false))(row.id, 'plain')).toMatchObject({ hp: 117, aggressive: true, dims: row.dims });
});

test('hunting requires complete authored numbers and never selects a preset from the label', () => {
  const rows = fixture(), row = rows.species[0]; if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
  row.temperament.brain = 'hunt';
  row.temperament.tuning = { hp: 117, sightRange: 18, sightRangeGraze: 12, sightCone: 1, hearStill: 2, hearCrouch: 4, hearWalk: 8, hearSprint: 16,
    noticeRate: 0.5, forgetRate: 0.2, alertAt: 0.3, boltAt: 1, freezeMin: 1, freezeMax: 2, relaxAfter: 3, panicDist: 5,
    runSpeed: 4, trotSpeed: 2, fleeMinTime: 1, fleeUntil: 20, fleeUntilMax: 30, fleeMaxTime: 8, lookBack: 2,
    waryTime: 10, waryBoost: 1.2, herdAlertRadius: 8, herdBoltDelayMin: 0.2, herdBoltDelayMax: 0.5, impactSpook: 6, impactAlert: 12 };
  expect(resolveCreatureLayers(rows).get(row.id)?.brain).toEqual({ kind: 'hunt', tuning: row.temperament.tuning });
  Reflect.deleteProperty(row.temperament.tuning, 'hp');
  expect(() => speciesResolver(rows)).toThrow('species `fixture.creature`');
});

function spawn(): ShardCreatures['spawns'][number] {
  return { id: 'fixture.actor', species: 'fixture.creature', variant: 'plain', brain: null, strike: null,
    at: [6, 0, 6], seed: 9, scale: 1, yaw: 0 };
}

test('policy preparation preserves admitted rows and refuses competing ownership', () => {
  const rows = fixture(), creatures: ShardCreatures = { brains: [], groups: [], spawns: [spawn()] };
  const before = JSON.stringify({ rows, creatures }), ready = prepareCreaturePolicies(rows, creatures);
  expect(ready.spawns[0]?.brain).toBe('layers.0');
  expect(ready.brains[0]).toMatchObject({ id: 'layers.0', kind: 'pursue', speed: 1.2 });
  expect(JSON.stringify({ rows, creatures })).toBe(before);
  creatures.spawns[0] = { ...spawn(), brain: 'different' };
  expect(() => prepareCreaturePolicies(rows, creatures)).toThrow('species `fixture.creature`: spawn and temperament name different brains');
  const declared = ready.brains[0], row = rows.species[0];
  if (declared === undefined || row?.temperament === undefined) throw new Error('Missing fixture layers');
  row.temperament.brain = declared.id; delete row.temperament.tuning;
  creatures.brains = [declared]; creatures.spawns = [{ ...spawn(), brain: declared.id }];
  expect(prepareCreaturePolicies(rows, creatures).brains).toEqual([declared]);
  expect(prepareCreaturePolicies(fixture(false), creatures).spawns[0]).toBe(creatures.spawns[0]);
});

test('a group retains its controller and refuses a second layer policy', () => {
  const rows = fixture(), row = rows.species[0];
  if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
  const creatures = parse(CreaturesSchema, { brains: [], spawns: [{ ...spawn(), brain: 'fixture.herd' }], groups: [{
    id: 'fixture.herd', kind: 'herd', members: ['fixture.actor'], thinkDivisor: 6,
    walkSpeed: 1, trotSpeed: 3, gallopSpeed: 7, chargeSpeed: 6, sightRadius: 30, grazingSightRadius: 12,
    coneAngle: 1, hearing: [1, 2, 4, 8], alertThreshold: 0.4, flightMinDistance: 20, flightMaxDistance: 35,
    stallionVariant: 'buck', foalPrefix: 'kid', snortCue: 'bleat', neighCue: 'bleat', squealCue: 'bleat',
  }] });
  expect(() => prepareCreaturePolicies(rows, creatures)).toThrow('species `fixture.creature`: group and temperament both own the brain');
  row.temperament.brain = 'none'; delete row.temperament.tuning;
  expect(prepareCreaturePolicies(rows, creatures).spawns[0]).toBe(creatures.spawns[0]);
});
