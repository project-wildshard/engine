// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import { ItemRuntime } from '../src/shared/engine/combat/items';
import type { EquipmentRow } from '../src/shared/engine/combat/Equipment';
import type { WeaponWire } from '../src/shared/engine/combat/Weapon';
import { DECLARED_LEVER_CUES, declaredKitItemFamilies, declaredLever } from '../src/client/game/plugin/weaponFamily';
import { sharedCombatCues } from '../src/client/game/plugin/audio';

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
  const equipment: EquipmentRow = { id: row.id, ui: { name: row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], swapIcon: '', touch: 'melee', lockOn: true, melee: true, tracers: false }, meta: { name: row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], blurb: '', category: 'weapon' } };
  const weapon = family.create(equipment, row, { scope, runtime, input: { bind: () => undefined, held: () => false }, aim: () => aim, view: row.view, profile: row.profile });
  const lever = declaredLever(weapon);
  if (lever === null) throw new Error('kit.lever builds a DeclaredLever');
  expect(lever.row.ui.ammo).toEqual({ label: 'Rounds', segments: 6, magazine: true });
  expect(lever.row.ui.melee).toBe(false);
  // QA 11-19 row 41: a row with no cues of its own still sounds its shot, reload, dry click and impact.
  expect(lever.row.cues).toEqual(DECLARED_LEVER_CUES);
  const played: string[] = [], voice = (name: string) => () => { played.push(name); };
  const map = sharedCombatCues({ rifleFire: voice('rifleFire'), crossbowFire: voice('crossbowFire'), swordSwing: voice('swordSwing'), swordHeavy: voice('swordHeavy'),
    swordHit: voice('swordHit'), boltImpact: voice('boltImpact'), dryFire: voice('dryFire'), rifleReload: voice('rifleReload'), reload: voice('reload'), weaponSwap: voice('weaponSwap') }, false);
  for (const id of [DECLARED_LEVER_CUES.fire, DECLARED_LEVER_CUES.reload, DECLARED_LEVER_CUES.dry ?? 'cue.none', DECLARED_LEVER_CUES.impact]) expect(map(id, {})).toBe(true);
  expect(played).toEqual(['rifleFire', 'rifleReload', 'dryFire', 'boltImpact']);
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

test.each([
  ['lever-action', 6, 120],
  ['scattergun', 4, 25],
  ['long rifle', 5, 200],
] as const)('%s aims the viewmodel, narrows the lens and slows look', (name, magazine, range) => {
  const family = declaredKitItemFamilies().get('kit.lever');
  if (family?.kind !== 'weapon' || row.profile?.family !== 'firearm') throw new Error('Expected a declared firearm');
  const scope = new Scope('lever-sights'), camera = new PerspectiveCamera(90, .46), player = { zoomLook: 1, sprinting: false };
  const equipment: EquipmentRow = { id: row.id, ui: { name, icon: 'lever' as EquipmentRow['ui']['icon'], swapIcon: '', touch: 'ranged', lockOn: false, melee: false, tracers: false }, meta: { name, icon: 'lever' as EquipmentRow['ui']['icon'], blurb: '', category: 'weapon' } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The aim view uses no item runtime.
  const runtime = new ItemRuntime(row, {} as ConstructorParameters<typeof ItemRuntime>[1]);
  let held = false;
  const lever = declaredLever(family.create(equipment, row, { scope, runtime, input: { bind: () => undefined, held: () => held },
    aim: () => ({ origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } }), view: row.view, profile: { ...row.profile, magazine, range } }));
  if (lever === null || !(lever.model instanceof Group)) throw new Error('Expected a lever view');
  const model = lever.model;
  const advance = (): void => { for (let frame = 0; frame < 30; frame++) lever.update(1 / 60, 0); };
  lever.take(); lever.setActive(true); lever.bindAimView(camera, player, () => undefined);
  advance();
  const hip = model.position.clone();
  for (const touch of [true, false]) {
    lever.adsHeld = touch; held = !touch; advance();
    expect(lever.state.ads).toBe(true);
    expect(camera.fov).toBeLessThan(90);
    expect(model.position.x).toBeCloseTo(0);
    expect(model.position.y).toBeGreaterThan(hip.y);
    expect(player.zoomLook).toBeLessThan(1);
    lever.adsHeld = false; held = false; advance();
    expect(camera.fov).toBeCloseTo(90);
    expect(model.position.toArray()).toEqual(hip.toArray());
  }
  held = true; advance(); lever.setActive(false);
  expect(camera.fov).toBe(90);
  expect(player.zoomLook).toBe(1);
  scope.dispose();
});
