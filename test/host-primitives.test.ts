// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary; the native plan is a fixture file.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { primitivesOf, productPrimitives } from '../src/server/game/shardfile/hostPrimitives';

// ONE-FORMAT OF17b1: the server works its primitive list out from the product's sections; no host list ships.
const base = () => emptyShardfile({ slug: 'primitives-fixture', name: 'Primitives fixture', author: 'Test', revision: 1, seed: 5 });
const look = { id: 'fixture.horse.look', species: 'fixture.horse', recipe: 'fixture.placeholder', material: null, parameters: {}, animation: { recipe: 'fixture.placeholder', parameters: {} } };
function withHorse(mount: boolean) {
  const shard = base();
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], strikes: [], looks: [look], species: [{
    id: 'fixture.horse', kind: 'horse', label: 'Horse', aggressive: false, lockable: true,
    dims: { bodyY: 1.4, bodyHalfLen: 1, bodyRadius: 0.4, headRadius: 0.25, legLen: 0.9, feet: [], halfWidth: 0.4 },
    variants: [{ id: 'bay', label: 'Bay', rarity: 'common', weight: 1, scale: [1, 1], hp: 60,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } }],
    body: { size: 'large', scale: 1, look: 'fixture.horse.look' }, senses: { notice: 4 },
    temperament: { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1.2, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } },
    ...(mount ? { mount: { gaits: { walk: 2, gallop: 10 } } } : {}),
  }] });
  return { ...shard, rows };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('OF17b1: a declared product runs the families its sections switch on', () => {
  expect(productPrimitives(base())).toEqual(['collision', 'plumbing']);
  const sim = createShardfileSim(base(), new Map(), { rapier });
  try { expect(primitivesOf(sim.host)).toEqual(['collision', 'plumbing']); } finally { sim.dispose(); }
});

test('OF17b1: a mount row adds riding, and taking it out removes it', () => {
  const ridden = createShardfileSim(withHorse(true), new Map(), { rapier }), plain = createShardfileSim(withHorse(false), new Map(), { rapier });
  try {
    expect(primitivesOf(ridden.host)).toContain('riding');
    expect(primitivesOf(plain.host)).not.toContain('riding');
  } finally { ridden.dispose(); plain.dispose(); }
});

test('OF17b1: a native-assembly product names the families its native features join', () => {
  const plan = JSON.parse(readFileSync('test/fixtures/host-ruler/native-driftwood-isle/server/native-assembly.json', 'utf8')) as { features: { host: string }[] };
  expect(productPrimitives(base(), plan.features.map(row => row.host))).toEqual(['collision', 'plumbing', 'population', 'held.melee', 'sky', 'water.sea']);
  expect(productPrimitives(base(), ['no.such.host'])).toEqual(['collision', 'plumbing']);
});
