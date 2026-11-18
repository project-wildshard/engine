import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';

// ONE-FORMAT OF38b (J420 (2)): held melee and ranged read each creature's own `attackable` row. No weapon carries a
// target list. The ranged weapon is TE-ENG2's rows-only lever rifle; any other weapon id strikes in reach (melee).
interface LeverFixture { readonly context: Shardfile['items']['contexts'][number]; readonly row: Shardfile['items']['rows'][number] }
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const lever = JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')) as LeverFixture;
const RIFLE = 'weapon.fixture-lever', SWORD = 'weapon.fixture-sword';
const BLOBS: Record<string, object | false | undefined> = {
  plain: undefined,
  ward: false,
  flier: { by: ['ranged'] },
  shy: { unless: [{ field: 'hidden', equals: 1 }] },
};
function blobShard() {
  const base = emptyShardfile({ slug: 'attackable-fixture', name: 'Attackable fixture', author: 'Test', revision: 1, seed: 7 });
  const names = Object.keys(BLOBS);
  const looks = names.map(name => ({ id: `fixture.${name}.look`, species: `fixture.${name}`, recipe: 'fixture.placeholder', material: null, parameters: {},
    animation: { recipe: 'fixture.placeholder', parameters: {} } }));
  const species = names.map(name => ({
    id: `fixture.${name}`, kind: 'blob', label: name, aggressive: false, lockable: true,
    dims: { bodyY: 0.5, bodyHalfLen: 0.5, bodyRadius: 0.5, headRadius: 0.2, legLen: 0.1, feet: [], halfWidth: 0.5 },
    variants: [{ id: 'grey', label: 'Grey', rarity: 'common', weight: 1, scale: [1, 1], hp: 60,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } }],
    body: { size: 'small', scale: 1, look: `fixture.${name}.look` },
    temperament: { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } },
    senses: { notice: 4 },
    ...(BLOBS[name] === undefined ? {} : { attackable: BLOBS[name] }),
  }));
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], strikes: [], looks, species });
  const spawns: ShardCreatures['spawns'] = names.map((name, i) => ({ id: `fixture.${name}:1`, species: `fixture.${name}`, variant: 'grey', brain: null,
    strike: null, at: [4 * (i + 1), 0, 6], seed: i + 1, scale: 1, yaw: 0 }));
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, rows, creatures: { brains: [], groups: [], spawns },
    items: { ...base.items, contexts: [...base.items.contexts, lever.context], rows: [...base.items.rows, lever.row] } };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

/** The player's blow with one weapon on one blob, through the one damage pipeline every held primitive uses. */
function strike(sim: ShardfileSimulation, blob: string, weaponId: string, amount = 10): boolean {
  const player = sim.host.players.values().next().value, body = sim.host.entities.get(`fixture.${blob}:1`);
  if (player === undefined || body === undefined) throw new Error(`Missing ${blob}`);
  const before = body.hp;
  sim.host.combat.hit({ source: player.health, sourceTags: [], target: body.combatActor(), amount, weaponId, moveId: 'move.fixture',
    point: body.position.clone(), dir: new Vector3(0, 0, 1) });
  return body.hp < before;
}

test('OF38b: a weapon kills an attackable blob', () => {
  const sim = createShardfileSim(blobShard(), new Map(), { rapier });
  try {
    expect(strike(sim, 'plain', SWORD)).toBe(true);
    expect(strike(sim, 'plain', RIFLE, 100)).toBe(true);
    expect(sim.host.entities.get('fixture.plain:1')?.alive).toBe(false);
  } finally { sim.dispose(); }
});

test('OF38b: an attackable: false blob takes no hit, and a ranged-only blob takes no melee hit', () => {
  const sim = createShardfileSim(blobShard(), new Map(), { rapier });
  try {
    expect(strike(sim, 'ward', SWORD)).toBe(false);
    expect(strike(sim, 'ward', RIFLE)).toBe(false);
    expect(strike(sim, 'flier', SWORD)).toBe(false);
    expect(strike(sim, 'flier', RIFLE)).toBe(true);
  } finally { sim.dispose(); }
});

test('OF38b: a shielded state takes no hit until it clears', () => {
  const sim = createShardfileSim(blobShard(), new Map(), { rapier });
  try {
    const shy = sim.host.entities.get('fixture.shy:1');
    if (shy === undefined) throw new Error('Missing shy blob');
    shy.mem['hidden'] = 1;
    expect(strike(sim, 'shy', SWORD)).toBe(false);
    expect(strike(sim, 'shy', RIFLE)).toBe(false);
    shy.mem['hidden'] = 0;
    expect(strike(sim, 'shy', SWORD)).toBe(true);
  } finally { sim.dispose(); }
});

test('OF38b: a creature\'s own blow and the world\'s are never refused', () => {
  const sim = createShardfileSim(blobShard(), new Map(), { rapier });
  try {
    const ward = sim.host.entities.get('fixture.ward:1'), plain = sim.host.entities.get('fixture.plain:1');
    if (ward === undefined || plain === undefined) throw new Error('Missing blobs');
    const hp = ward.hp;
    sim.host.combat.hit({ source: plain.combatActor(), sourceTags: [], target: ward.combatActor(), amount: 5, point: ward.position.clone(), dir: new Vector3(0, 0, 1) });
    sim.host.combat.hit({ source: 'env', sourceTags: [], target: ward.combatActor(), amount: 5, point: ward.position.clone(), dir: new Vector3(0, 0, 1) });
    expect(ward.hp).toBe(hp - 10);
  } finally { sim.dispose(); }
});
