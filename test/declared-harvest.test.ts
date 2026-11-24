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
import { Rng } from '@wildshard/format/seededRng';
import { createNativeCreatureRoster } from '../src/server/game/shardfile/homeKeeper';
import { fixtureNativeRoster } from './fixtures/native-roster';
import { admitSpeciesBrains, installSpeciesHomes } from '../src/server/game/plugin/brain';
import { BOAR } from '../src/test/game/species/boar';

let rapier: Awaited<ReturnType<typeof loadRapier>>;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });
const drops = parse(HarvestDropsSchema, [{ item: 'moon.trophy', count: 2, variants: ['elite'] }, { item: 'sun.trophy', count: 1 }]);
const owners: (() => void)[] = [];
afterEach(() => { for (const dispose of owners.splice(0)) dispose(); });
function fixture(slots = 2, species: NonNullable<Parameters<typeof installNativeHarvest>[1]> = [], kinds = ['moon.trophy', 'sun.trophy']) {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  const profile = { kinds, slots,
    counts: { min: 1, max: 1000, integer: true, complete: true }, quantity: 'positive-safe-integer', snapshot: 'order', restoreError: 'Bad pack' } satisfies NativeInventoryProfile<string>;
  const pack = new NativeInventory(profile, host, 'pack'); installNativeHarvest(host, species);
  const recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing body recipe');
  const kill = (harvest: typeof drops | null = drops): void => {
    const body = host.spawn({ ...recipe, id: 'custom.carcass', spec: { ...recipe.spec, kind: 'boar', variant: 'elite', hp: 1 }, at: { x: 0, y: 0, z: 0 } });
    body.harvest = harvest === null ? undefined : harvest; body.species = 'own.creature';
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
  expect(inventory.harvest('boar', 'elite')).toEqual([]);
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

test('native attachment and reinstall bind row drops without drawing or changing saved recipes and wire labels', () => {
  const first = fixture(), second = fixture();
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native recipe');
  const setup = (f: ReturnType<typeof fixture>) => {
    const rng = new Rng(31), { services } = fixtureNativeRoster(f.host, rng);
    const spec = { ...sample.spec, kind: 'boar', variant: 'elite', hp: 1 };
    const intake = createNativeCreatureRoster(f.host, { specs: [spec], species: [{ kind: 'boar', harvest: drops, capExempt: true }],
      variants: new Map(), rng, services, hunted: 'every', spawnY: 10 });
    const slot = intake.body('native.carcass', 'boar', 'elite', -1, { x: 0, z: 0 }, 0, [1, 1]);
    return { rng, intake, slot };
  };
  try {
    const a = setup(first), before = a.rng.snapshot(), actor = a.intake.arrive(a.slot);
    expect(a.rng.snapshot()).toEqual(before); expect(actor.harvest).toBe(drops); expect(actor.species).toBe(''); expect(actor.combatActor().capExempt).toBe(true);
    const adapter = first.host.adapters.get('runtime.actor.native.carcass'); if (adapter === undefined) throw new Error('Missing real recipe');
    const recipe = adapter.snapshot(); expect(typeof recipe).toBe('string');
    expect(JSON.stringify(recipe)).not.toContain('harvest');
    const b = setup(second), stream = b.rng.snapshot();
    const restored = b.intake.reinstall(b.slot, { adapters: [{ id: 'runtime.actor.native.carcass', state: recipe }], entities: [] });
    expect(restored.harvest).toBe(drops); expect(restored.species).toBe(''); expect(restored.combatActor().capExempt).toBe(true); expect(b.rng.snapshot()).toEqual(stream);
    expect(second.host.adapters.get('runtime.actor.native.carcass')?.snapshot()).toBe(recipe);
    second.host.combat.hit({ source: 'env', sourceTags: ['cover.checked'], target: restored.combatActor(), amount: 100,
      point: restored.position.clone(), dir: new Vector3() }); second.host.step();
    actRoutes(second.host).claims.get('harvest.native.carcass')?.(leadPlayer(second.host).id);
    expect(second.pack.count('moon.trophy')).toBe(2); expect(second.pack.count('sun.trophy')).toBe(1);
    a.intake.sleep(a.slot); const replacement = a.intake.arrive(a.slot);
    expect(replacement.harvest).toBe(drops); expect(a.rng.snapshot()).toEqual(before);
  } finally { first.host.dispose(); second.host.dispose(); }
});

test('native empty and absent declarations remain distinct through actual roster materialization', () => {
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native recipe');
  for (const harvest of [[], undefined]) {
    const f = fixture();
    try {
      const rng = new Rng(31), { services } = fixtureNativeRoster(f.host, rng);
      const intake = createNativeCreatureRoster(f.host, { specs: [sample.spec], species: [{ kind: sample.spec.kind,
        ...(harvest === undefined ? {} : { harvest }) }], variants: new Map(), rng, services, hunted: 'every', spawnY: 10 });
      const actor = intake.arrive(intake.body('native.empty', sample.spec.kind, sample.spec.variant, -1, { x: 0, z: 0 }, 0, [1, 1]));
      expect(actor.harvest).toBe(harvest); expect(actor.species).toBe('');
      expect(declaredHarvestDrops(actor.harvest ?? [], actor.variant)).toEqual([]);
    } finally { f.host.dispose(); }
  }
});

test('species homes bind admitted harvest before their existing policy and preserve native wire labels', () => {
  const f = fixture(), sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing home recipe');
  const species = [{ ...BOAR, harvest: drops, capExempt: false }];
  try {
    const homes = installSpeciesHomes(f.host, { step: 'fixture.homes', seed: 17,
      homes: [{ id: 'home.body', kind: BOAR.kind, at: [0, 0], yaw: 0, respawn: 0 }],
      specs: new Map([[BOAR.kind, sample.spec]]), attackers: 1, think: { every: 6, dt: .1 },
      species, brains: admitSpeciesBrains(species, []), custom: (_kind, actor) => {
        expect(actor.harvest).toBe(drops); expect(actor.species).toBe(''); expect(actor.combatActor().capExempt).toBe(false);
        return { decide: () => undefined, move: () => undefined, snapshot: () => null, restore: () => undefined };
      } });
    expect(homes.homes()[0]?.actor?.harvest).toBe(drops);
  } finally { f.host.dispose(); }
});

const oldPending = { id: 'old.pending', kind: 'boar', variant: 'elite', x: 0, y: 0, z: 0 };
test('body-free old pending saves resolve admitted variant drops and pay once', () => {
  const f = fixture(2, [{ kind: 'boar', harvest: drops }, { kind: 'boar', harvest: drops }]);
  try {
    expect(f.host.entities.size).toBe(0);
    f.saved.restore([oldPending]);
    expect(f.saved.snapshot()).toEqual([{ ...oldPending, drops: ['moon.trophy', 'moon.trophy', 'sun.trophy'] }]);
    const claim = (): void => { actRoutes(f.host).claims.get('harvest.old.pending')?.(leadPlayer(f.host).id); };
    claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.pack.count('sun.trophy')).toBe(1);
    claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.saved.snapshot()).toEqual([]);
  } finally { f.host.dispose(); }
});
test('saved drops win and admitted empty harvest differs from an absent declaration', () => {
  const empty = fixture(2, [{ kind: 'boar', harvest: [] }]), absent = fixture();
  try {
    empty.saved.restore([{ ...oldPending, drops: ['moon.trophy'] }]);
    expect(empty.saved.snapshot()).toEqual([{ ...oldPending, drops: ['moon.trophy'] }]);
    actRoutes(empty.host).claims.get('harvest.old.pending')?.(leadPlayer(empty.host).id);
    expect(empty.pack.count('moon.trophy')).toBe(1);
    empty.saved.restore([oldPending]); expect(empty.saved.snapshot()).toEqual([{ ...oldPending, drops: [] }]);
    absent.saved.restore([oldPending]); expect(absent.saved.snapshot()).toEqual([oldPending]);
  } finally { empty.host.dispose(); absent.host.dispose(); }
});
test('ambiguous old pending harvest refuses before changing any live pending claims', () => {
  const f = fixture(2, [{ kind: 'boar', harvest: drops }, { kind: 'boar', harvest: [] }]);
  try {
    f.kill(); const before = f.saved.snapshot();
    expect(() => f.saved.restore([oldPending])).toThrow('Ambiguous admitted harvest');
    expect(f.saved.snapshot()).toEqual(before);
    f.claim(); expect(f.pack.count('moon.trophy')).toBe(2); expect(f.pack.count('sun.trophy')).toBe(1);
  } finally { f.host.dispose(); }
});

test('a kind-only death leaves no pending claim even when the pack would keep the old items', () => {
  const f = fixture(3, [], ['boar-meat', 'boar-hide', 'boar-tusk']);
  try {
    f.kill(null);
    expect(f.saved.snapshot()).toEqual([]);
    expect(actRoutes(f.host).claims.has('harvest.custom.carcass')).toBe(false);
  } finally { f.host.dispose(); }
});
test('a released pending payout with recorded drops survives mixed same-kind owners', () => {
  const legacy = ['boar-meat', 'boar-hide', 'boar-tusk'];
  const f = fixture(3, [{ kind: 'boar' }, { kind: 'boar', harvest: drops }], legacy);
  try {
    f.saved.restore([{ ...oldPending, drops: legacy }]);
    const claim = (): void => { actRoutes(f.host).claims.get('harvest.old.pending')?.(leadPlayer(f.host).id); };
    claim();
    expect(f.pack.snapshot()).toEqual({ counts: { 'boar-meat': 1, 'boar-hide': 1, 'boar-tusk': 1 }, order: legacy });
    claim();
    expect(f.pack.count('boar-meat')).toBe(1);
  } finally { f.host.dispose(); }
});
test('old dropless saves refuse a mix of absent and declared owners before clearing claims', () => {
  const mixed = [{ kind: 'boar' }, { kind: 'boar', harvest: drops }];
  for (const species of [mixed, [...mixed].reverse()]) {
    const f = fixture(2, species);
    try {
      f.kill(); const before = f.saved.snapshot();
      expect(() => f.saved.restore([oldPending])).toThrow('Ambiguous admitted harvest');
      expect(f.saved.snapshot()).toEqual(before); f.claim();
      expect(f.pack.count('moon.trophy')).toBe(2); expect(f.pack.count('sun.trophy')).toBe(1);
    } finally { f.host.dispose(); }
  }
});
