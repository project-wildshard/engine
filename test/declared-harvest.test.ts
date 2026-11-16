// oxlint-disable-next-line import/no-nodejs-modules -- Real native physics, not a harvest mock.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { parse } from 'valibot';
import { HarvestDropsSchema } from '@wildshard/format/harvestRows';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { NativeInventory, type NativeInventoryProfile } from '../src/shared/game/inventoryLaw';
import { declaredHarvestDrops } from '../src/shared/game/harvest';
import { installNativeHarvest } from '../src/server/game/loot/harvest';
import { Inventory } from '../src/client/game/Inventory';
import { registerItemRow } from '../src/shared/game/bag/itemCatalog';
import { installShards } from '../src/client/game/shard/list';
import { installTitleManifests } from '../src/client/game/shard/titleList';
import { SIM_LEVEL } from './fixtures/sim-level/level';

let rapier: Awaited<ReturnType<typeof loadRapier>>;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });
const drops = parse(HarvestDropsSchema, [{ item: 'moon.trophy', count: 2, variants: ['elite'] }, { item: 'sun.trophy', count: 1 }]);
const owners: (() => void)[] = [];
afterEach(() => { for (const dispose of owners.splice(0)) dispose(); });
function fixture(slots = 2) {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  const profile = { kinds: ['moon.trophy', 'sun.trophy'], slots,
    counts: { min: 1, max: 1000, integer: true, complete: true }, quantity: 'positive-safe-integer', snapshot: 'order', restoreError: 'Bad pack' } satisfies NativeInventoryProfile<string>;
  const pack = new NativeInventory(profile, host, 'pack'); installNativeHarvest(host);
  const recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing body recipe');
  const kill = (): void => {
    const body = host.spawn({ ...recipe, id: 'custom.carcass', spec: { ...recipe.spec, kind: 'boar', variant: 'elite', hp: 1 }, at: { x: 0, y: 0, z: 0 } });
    body.harvest = drops; body.species = 'own.creature';
    host.combat.hit({ source: 'env', sourceTags: ['cover.checked'], target: body.combatActor(), amount: 100, point: body.position.clone(), dir: new Vector3() });
    host.step();
    body.harvest = [];
  };
  const saved = host.adapters.get('owned.harvest'); if (saved === undefined) throw new Error('Missing real harvest continuation');
  const claim = (): void => { actRoutes(host).claims.get('harvest.custom.carcass')?.(leadPlayer(host).id); };
  return { host, pack, kill, claim, saved };
}
test('declared units and selectors cross the actual page inventory without a kind fallback', () => {
  installShards([]); installTitleManifests([]);
  for (const id of ['moon.trophy', 'sun.trophy', 'boar-meat']) owners.push(registerItemRow({ id, label: id, icon: 'star' }));
  const inventory = new Inventory('custom-harvest');
  expect(declaredHarvestDrops(drops, 'plain')).toEqual(['sun.trophy']);
  const result = inventory.harvest('boar', 'elite', drops);
  expect(result).toEqual(['moon.trophy', 'moon.trophy', 'sun.trophy']);
  for (const item of result) expect(inventory.add(item)).toBe(true);
  expect(new Inventory('custom-harvest').items.map(row => [row.id, row.count])).toEqual([['moon.trophy', 2], ['sun.trophy', 1]]);
  expect(inventory.harvest('boar', 'elite', [])).toEqual([]);
  expect(inventory.harvest('boar', 'elite')).toContain('boar-meat');
});
test('the real server pays declared trophies once, only within the existing reach', () => {
  const f = fixture();
  try {
    f.kill(); expect(f.saved.snapshot()).toMatchObject([{ drops: ['moon.trophy', 'moon.trophy', 'sun.trophy'] }]);
    leadPlayer(f.host).position.set(10, 0, 0); f.claim(); expect(f.pack.count('moon.trophy')).toBe(0);
    leadPlayer(f.host).position.set(0, 0, 0); f.claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.pack.count('sun.trophy')).toBe(1);
    f.claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.saved.snapshot()).toEqual([]);
  } finally { f.host.dispose(); }
});
test('pending and claimed carcass saves retain resolved drops and cannot double-pay after restore', () => {
  const first = fixture(), second = fixture(), third = fixture();
  try {
    first.kill(); second.saved.restore(first.saved.snapshot()); second.claim();
    expect(second.pack.snapshot()).toEqual({ counts: { 'moon.trophy': 2, 'sun.trophy': 1 }, order: ['moon.trophy', 'sun.trophy'] });
    third.pack.restore(second.pack.snapshot()); third.saved.restore(second.saved.snapshot()); third.claim();
    expect(third.pack.snapshot()).toEqual(second.pack.snapshot()); expect(actRoutes(third.host).claims.has('harvest.custom.carcass')).toBe(false);
  } finally { first.host.dispose(); second.host.dispose(); third.host.dispose(); }
});
test('full packs retain original partial grant/consumption policy and malformed pending drops refuse atomically', () => {
  const f = fixture(1);
  try {
    f.kill(); const before = f.saved.snapshot();
    if (!Array.isArray(before) || before[0] === undefined) throw new Error('Missing pending corpse');
    const pending: unknown = before[0];
    if (typeof pending !== 'object' || pending === null || Array.isArray(pending)) throw new Error('Malformed pending corpse');
    expect(() => f.saved.restore([{ ...pending, drops: Array.from({ length: 65 }, () => 'moon.trophy') }])).toThrow();
    expect(f.saved.snapshot()).toEqual(before);
    f.claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.pack.count('sun.trophy')).toBe(0); expect(f.saved.snapshot()).toEqual([]);
    f.claim(); expect(f.pack.count('moon.trophy')).toBe(2);
  } finally { f.host.dispose(); }
});
