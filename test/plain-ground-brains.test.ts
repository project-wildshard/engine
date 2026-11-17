// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';

const tuning = { thinkDivisor: 3, awareRadius: 14, shyRadius: 8, disengageRadius: 24, holdRadius: 3,
  attackRadius: 2, attackDuration: 0.8, attackCooldown: 1.2, alertCooldown: 0.3, fleeSpeed: 5,
  subordinateVariant: 'small', leaderVariant: 'leader', noticeCue: 'notice' };
function fixture(layer: boolean) {
  const base = emptyShardfile({ slug: 'plain-skirmisher', name: 'Plain skirmisher', author: 'Test', revision: 1, seed: 39 });
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], looks: [],
    strikes: [{ id: 'fixture.bite', shape: { kind: 'sphere', radius: 2 }, windup: 0.2, active: 0.1, recover: 0.5,
      cooldown: 1.2, range: 2, damage: 7, tags: ['creature.fixture'], weight: 1, speed: 0 }],
    species: [{ id: 'fixture.creature', kind: 'fixture.label', label: 'Fixture', aggressive: true, lockable: true,
      dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
      variants: [{ id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1], hp: 117,
        mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } }],
      ...(layer ? { temperament: { brain: 'skirmisher', reaction: 'aggressive', leash: 35, assist: 0,
        home: { speed: 2, stop: 1 }, tuning }, senses: { notice: 14 } } : {}) }] });
  const creatures = parse(CreaturesSchema, { brains: layer ? [] : [{ id: 'fixture.brain', kind: 'skirmisher', ...tuning }], groups: [],
    spawns: [{ id: 'fixture.actor', species: 'fixture.creature', variant: 'plain', brain: layer ? null : 'fixture.brain',
      strike: 'fixture.bite', at: [0, 0, 7], seed: 9, scale: 1, yaw: Math.PI }] });
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, rows, creatures };
}

test.each([false, true])('plain skirmisher approaches, attacks and restores its body clock; layer=%s', async layer => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture(layer);
  const original = JSON.stringify(shard), first = createShardfileSim(shard, new Map(), { rapier });
  const restored = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const actor = first.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual fixture actor');
    const player = first.host.nearestPlayer(actor.position);
    const start = actor.position.clone();
    let attacking = false;
    for (let i = 0; i < 600; i++) {
      first.host.step();
      if (actor.attackPhase > 0 && actor.attackPhase < 0.5) { attacking = true; break; }
    }
    expect(attacking).toBe(true); expect(actor.position.distanceTo(start)).toBeGreaterThan(1);
    restored.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 180; i++) { first.host.step(); restored.host.step(); }
    expect(player.health.attributes.health).toBeLessThan(100);
    expect(restored.host.entities.get(actor.entityId)?.snapshot()).toEqual(actor.snapshot());
    expect(restored.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(first.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(restored.host.rng.snapshot()).toEqual(first.host.rng.snapshot());
    expect(restored.host.nearestPlayer(actor.position).health.snapshot()).toEqual(player.health.snapshot());
    expect(JSON.stringify(shard)).toBe(original);
  } finally { restored.host.dispose(); first.host.dispose(); }
});

test('a plain skirmisher waits for its existing attack permission', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(false), new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual fixture actor');
    const player = sim.host.nearestPlayer(actor.position), deny = sim.host.scope.child('fixture.deny-attacks');
    sim.host.events.answer('ai.claim', () => false, deny);
    sim.host.events.answer('ai.mayAttack', () => false, deny);
    for (let i = 0; i < 300; i++) { sim.host.step(); expect(actor.attackPhase).toBeLessThan(0); }
    expect(player.health.attributes.health).toBe(100);
    deny.dispose();
    for (let i = 0; i < 600 && player.health.attributes.health === 100; i++) sim.host.step();
    expect(player.health.attributes.health).toBeLessThan(100);
  } finally { sim.host.dispose(); }
});

test('a missed plain skirmisher contact cannot deal delayed damage', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(false), new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual fixture actor');
    const player = sim.host.nearestPlayer(actor.position);
    let found = false;
    for (let i = 0; i < 600; i++) {
      sim.host.step();
      if (actor.attackPhase >= 0 && actor.attackPhase < 0.2) { found = true; break; }
    }
    expect(found).toBe(true);
    player.position.set(50, 0, 50); player.motor?.resetAt(player.position);
    for (let i = 0; i < 24; i++) sim.host.step();
    expect(actor.mem['hit']).toBe(1); expect(player.health.attributes.health).toBe(100);
    player.position.copy(actor.position); player.motor?.resetAt(player.position);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(player.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test('a plain skirmisher refuses missing contact authority before stepping', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture(false);
  const spawn = shard.creatures.spawns[0];
  if (spawn === undefined) throw new Error('Missing fixture spawn');
  spawn.strike = null;
  expect(() => createShardfileSim(shard, new Map(), { rapier })).toThrow('Missing declared data-host skirmisher strike');
});

test('a contact outside its native body attack clock refuses before stepping', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture(false);
  const strike = shard.rows.strikes[0];
  if (strike === undefined) throw new Error('Missing fixture strike');
  strike.windup = tuning.attackDuration;
  expect(() => createShardfileSim(shard, new Map(), { rapier })).toThrow('Skirmisher contact must fit its body attack clock');
});

test('a plain skirmisher uses its admitted strike once on the existing body clock', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(false), new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual fixture actor');
    const player = sim.host.nearestPlayer(actor.position);
    const hits: { source: unknown; move: string | undefined; amount: number }[] = [];
    sim.host.events.on('damage.dealt', ({ req }) => {
      if (req.target === player.health) hits.push({ source: req.source, move: req.moveId, amount: req.amount });
    }, sim.host.scope);
    for (let i = 0; i < 600 && player.health.attributes.health === 100; i++) sim.host.step();
    expect(player.health.attributes.health).toBe(93);
    expect(hits).toEqual([{ source: actor.combatActor(), move: 'fixture.bite', amount: 7 }]);
    expect(actor.mem['hit']).toBe(1);
    expect(sim.host.strikes.get(actor.entityId)?.busy).toBe(false);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(player.health.attributes.health).toBe(93); expect(hits).toHaveLength(1);
  } finally { sim.host.dispose(); }
});

test('the original stalker alias runs through the same plain host', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture(false);
  const brain = shard.creatures.brains[0];
  if (brain === undefined) throw new Error('Missing original brain');
  shard.creatures = parse(CreaturesSchema, { ...shard.creatures, brains: [{ ...brain, kind: 'stalker', pattern: 'skirmish' }] });
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual fixture actor');
    const player = sim.host.nearestPlayer(actor.position);
    for (let i = 0; i < 600 && player.health.attributes.health === 100; i++) sim.host.step();
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test.each([false, true])('only an authored group leader death scatters a subordinate; sameGroup=%s', async sameGroup => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture(false);
  const row = shard.rows.species[0], spawn = shard.creatures.spawns[0], brain = shard.creatures.brains[0];
  if (row === undefined || spawn === undefined || brain?.kind !== 'skirmisher' || row.variants[0] === undefined)
    throw new Error('Missing actual skirmisher fixture');
  row.variants.push({ ...row.variants[0], id: 'leader', label: 'Leader' });
  brain.subordinateVariant = 'plain'; brain.leaderVariant = 'leader';
  spawn.group = 'fixture.crew'; shard.spawn.z = 30;
  shard.creatures = parse(CreaturesSchema, { ...shard.creatures, spawns: [spawn,
    { ...spawn, id: 'fixture.leader', variant: 'leader', brain: null, strike: null,
      group: sameGroup ? 'fixture.crew' : 'fixture.other', at: [1, 0, 8] }] });
  shard.rows = parseRows(shard.rows);
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'), leader = sim.host.entities.get('fixture.leader');
    if (actor === undefined || leader === undefined) throw new Error('Missing actual group actors');
    sim.host.combat.hit({ source: 'env', sourceTags: [], target: leader.combatActor(), amount: leader.maxHp + 1,
      point: leader.position.clone(), dir: leader.position.clone().set(0, 0, 0) });
    expect(leader.alive).toBe(false);
    for (let i = 0; i < 6; i++) sim.host.step();
    expect(actor.mem['scat']).toBe(sameGroup ? 1 : 0);
    if (sameGroup) expect(actor.state).toBe('flee'); else expect(actor.state).not.toBe('flee');
    expect(sim.host.nearestPlayer(actor.position).health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});
