// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the installed native families on shipped Rapier bytes.
import { installNativeHeldAmmunition,NativeHeldAmmunition,nativeHeldAmmunition } from '@wildshard/engine/game/loadout/nativeAmmunition';
import { parseItems } from '@wildshard/format/items';
import { LoadoutSchema } from '@wildshard/format/loadout';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect,test } from 'vitest';
import { restoreHeldOwnership } from '../src/client/game/loadout/held';
import { createSimHost } from '../src/server/engine/sim';
import { createNativeCombatFrame,installNativeItems } from '../src/server/game/plugin/nativeItems';
import { HOST_PROBE } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { loadoutLegacySlot } from '../src/shared/game/loadout/persistence';
import pineRows from './fixtures/engine-lift/loadout.json' with { type: 'json' };
import { pinePin } from './fixtures/engine-lift/pins';

// GR8: called, not read from a scheduler job's output
const itemRows = pinePin.product.section('combat/items').items;

test('existing v1 Pine loadout saves continue with the exact ABI and owned flags', () => {
  const rows = v.parse(LoadoutSchema, pineRows), documents = new Map<string, string>();
  const local = { get length() { return documents.size; }, key: (index: number) => [...documents.keys()][index] ?? null,
    getItem: (key: string) => documents.get(key) ?? null, setItem: (key: string, value: string) => { documents.set(key, value); },
    removeItem: (key: string) => { documents.delete(key); } };
  const store = new SaveStore({ local, session: null });
  const legacy = { pitch: 11, broadhead: 3, rounds: 42, arrows: 7 };
  // Produce the previous definition, then open the same document through a fresh store.
  const old = store.define({ key: 'loadout', scope: 'shard', version: 1,
    schema: v.object({ pitch: v.optional(v.number()), broadhead: v.optional(v.number()), rounds: v.optional(v.number()), arrows: v.optional(v.number()) }), initial: () => ({}) });
  old.write(legacy, 'pine-hollow');
  const resumed = new SaveStore({ local, session: null });
  const slot = loadoutLegacySlot(rows, resumed);
  expect(slot.read('pine-hollow')).toEqual(legacy);
  expect(loadoutLegacySlot(rows, resumed)).toBe(slot);
  slot.write({ ...legacy, pitch: 8, rounds: 39 }, 'pine-hollow');
  expect(slot.read('pine-hollow')).toEqual({ ...legacy, pitch: 8, rounds: 39 });
  expect(restoreHeldOwnership(['warden-longbow'], ['lever-rifle'], rows))
    .toEqual({ bow: true, rifle: true, grants: ['warden-longbow'] });
});

test('harbour native ammunition keeps swaps, caps, fallback and atomic continuation', async () => {
  const rows = { ...pineRows, pouch: { kinds: ['harpoon', 'flare'], fallback: 'harpoon', capacity: 12 },
    firearm: { ...pineRows.firearm, ammo: 'canister' }, bow: { ...pineRows.bow, ammo: 'line' } };
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host = createSimHost({ version: 3, id: 'harbour-ammunition', seed: 7, ground: { size: 20, height: 0 },
    player: { at: { x: 0, y: 1, z: 0 }, yaw: 0, speed: 5 }, weapon: HOST_PROBE, entities: [], quests: [] }, { rapier });
  const frame = createNativeCombatFrame(), items = parseItems(itemRows);
  let crossbowState: { quiver: number; loaded: boolean; reloading: boolean } | undefined;
  for (const item of items.rows) {
    if (item.kind !== 'weapon' || item.ranged === undefined) continue;
    item.ranged.defaultAmmo = 'harpoon';
    item.ranged.ammunition = item.ranged.ammunition.slice(0, 2).map((ammo, index) => Object.assign(ammo, { id: index === 0 ? 'harpoon' : 'flare' }));
    if (item.profile?.family === 'bow') {
      item.profile.quiver = 6;
      const bow = installNativeItems(host, frame, { kind: 'bow', policy: item.ranged, profile: item.profile }); bow.state.arrows = 2;
    } else if (item.profile?.family === 'firearm' && item.profile.action === 'lever') {
      item.profile.magazine = 1; item.profile.reserve = 3;
      installNativeItems(host, frame, { kind: 'cycle', policy: item.ranged, profile: item.profile });
    } else {
      const bolt = installNativeItems(host, frame, { kind: 'bolt', policy: item.ranged, profile: item.profile }); crossbowState = bolt.state;
      bolt.state.quiver = 12;
    }
  }
  if (crossbowState === undefined) throw new Error('Missing native harbour launcher');
  const crossbow = { state: crossbowState };
  const ammunition = installNativeHeldAmmunition(host, rows, items);
  try {
  expect(nativeHeldAmmunition(host)).toBe(ammunition);
  expect(() => installNativeHeldAmmunition(host, rows, items)).toThrow('Duplicate native ammunition owner');
  ammunition.add('flare', 5); ammunition.loadKind('flare'); expect(crossbow.state.quiver).toBe(5);
  expect(crossbow.state.loaded).toBe(true); expect(ammunition.changed).toBe(true);
  const saved = ammunition.snapshot();
  const resumed = new NativeHeldAmmunition(host, rows, items), commit = resumed.prepareRestore(saved);
  expect(nativeHeldAmmunition(host)).toBe(ammunition);
  expect(resumed.selected).toBe('harpoon'); commit(); expect(resumed.snapshot()).toEqual(saved);
  expect(() => resumed.prepareRestore({ ...saved, flare: 4 })).toThrow(); expect(resumed.snapshot()).toEqual(saved);
  expect(() => resumed.prepareRestore({ ...saved, harpoon: 13 })).toThrow(); expect(resumed.snapshot()).toEqual(saved);
  resumed.add('canister', 2); expect(resumed.count('canister')).toBe(6);
  resumed.add('line', 10); expect(resumed.count('line')).toBe(6); expect(resumed.room('line', 1)).toBe(false);
  crossbow.state.quiver = 0; crossbow.state.loaded = false; resumed.update();
  expect(resumed.selected).toBe('harpoon'); expect(crossbow.state.quiver).toBe(12);
  expect(crossbow.state.loaded).toBe(false);
  } finally { host.dispose(); }
  expect(() => nativeHeldAmmunition(host)).toThrow('Missing native ammunition owner');
});
