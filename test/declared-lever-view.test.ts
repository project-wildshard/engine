// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Group } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import { ItemRuntime } from '../src/shared/engine/combat/items';
import type { EquipmentRow } from '../src/shared/engine/combat/Equipment';
import type { WeaponWire } from '../src/shared/engine/combat/Weapon';
import { declaredKitItemFamilies, declaredLever } from '../src/client/game/plugin/weaponFamily';

// TE-ENG2, the page's half: the held lever is hidden and refuses presses until taken, fills the HUD's ammo strip from its tube,
// sends each pull and R to the server, flashes at its muzzle, and takes the server's count when the two differ at rest.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const { row } = JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')) as { row: Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }> };

test('the held lever: locked, a tube on the HUD, presses on the wire, the server\'s count at rest', () => {
  const family = declaredKitItemFamilies().get('kit.lever');
  if (family?.kind !== 'weapon') throw new Error('kit.lever is a weapon family');
  expect(family.locked).toBe(true);
  expect(family.profiles).toContain('firearm');
  const scope = new Scope('lever'), aim = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const actor = { id: 'actor.player', alive: true };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The view runtime's actor and ports are never stepped here.
  const runtime = new ItemRuntime(row, { actor, combat: { hit: () => null }, targets: () => [], hook: null, effect: () => undefined } as unknown as ConstructorParameters<typeof ItemRuntime>[1]);
  const equipment: EquipmentRow = { id: row.id, legacySlot: row.id as NonNullable<EquipmentRow['legacySlot']>, ui: { name: row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], swapIcon: '', touch: 'melee', lockOn: true, melee: true, tracers: false }, meta: { name: row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], blurb: '', category: 'weapon' } };
  const weapon = family.create(equipment, row, { scope, runtime, input: { bind: () => undefined, held: () => false }, aim: () => aim, view: row.view, profile: row.profile });
  const lever = declaredLever(weapon);
  if (lever === null) throw new Error('kit.lever builds a DeclaredLever');
  expect(lever.row.ui.ammo).toEqual({ label: 'Rounds', segments: 6, magazine: true });
  expect(lever.row.ui.melee).toBe(false);
  const sent: string[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the calls a lever makes are recorded.
  lever.wire = { press: () => { sent.push('press'); }, reload: () => { sent.push('reload'); }, steps: () => 1 } as unknown as WeaponWire;

  // On its rack: hidden, no ammo strip, every press refused.
  lever.update(1 / 60, 0);
  expect(lever.model.visible).toBe(false);
  expect(lever.state.ammo).toBeUndefined();
  lever.tryFire(); lever.reload();
  expect(sent).toEqual([]);

  // The server says it is taken: six in the gun, the reserve beside them.
  lever.mirror(6, 12, false, true); lever.update(1 / 60, 0);
  expect(lever.taken).toBe(true);
  expect(lever.model.visible).toBe(true);
  expect(lever.state.ammo).toBe(6);
  expect(lever.state.reserve).toBe(12);

  // A pull: the hammer falls here at once, the flash shows at the muzzle, and the press goes to the server.
  lever.tryFire(); lever.update(1 / 60, 0);
  expect(sent).toEqual(['press']);
  expect(lever.state.ammo).toBe(5);
  const model = lever.model;
  if (!(model instanceof Group)) throw new Error('A lever holds a model group');
  expect(model.getObjectByName('muzzle')?.children.some(child => child.visible)).toBe(true);
  for (let i = 0; i < 60; i++) lever.update(1 / 60, 0); // the lever cycles the next round in
  expect(lever.state.ammo).toBe(5);

  // R tops the tube up: one reload asked of the server.
  lever.reload();
  expect(sent).toEqual(['press', 'reload']);
  expect(lever.state.reloading).toBe(false); // the page's own state reads at its next update
  lever.update(1 / 60, 0);
  expect(lever.state.reloading).toBe(true);
  for (let i = 0; i < 60; i++) lever.update(1 / 60, 0);
  expect(lever.state.ammo).toBe(6);

  // At rest the server's count stands when the two differ for a beat (a round the page predicted that the server refused).
  for (let i = 0; i < 20; i++) { lever.mirror(4, 9, false, true); lever.update(1 / 60, 0); }
  expect(lever.state.ammo).toBe(4);
  expect(lever.state.reserve).toBe(9);
  scope.dispose();
});
