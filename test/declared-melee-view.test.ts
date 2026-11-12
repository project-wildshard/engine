// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Group } from 'three';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import { ItemRuntime } from '../src/shared/engine/combat/items';
import type { EquipmentRow } from '../src/shared/engine/combat/Equipment';
import type { Weapon, WeaponWire } from '../src/shared/engine/combat/Weapon';
import { declaredKitItemFamilies } from '../src/client/game/plugin/weaponFamily';

// TE-ENG4, the page's half: a `kit.melee` row's held model swings on each strike (opus-mh7: Mossgate's iron sword stood still).
// A light strike sweeps across, a heavy one chops down; both leave the rest pose and come back to it. On the wire the press
// (or a charged hold's release) starts the swing; off it, the runtime's own `fire` phase does.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is Mossgate's sword row, typed as the format reads it.
const { row } = JSON.parse(readFileSync('test/fixtures/declared-melee/rows.json', 'utf8')) as { row: Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }> };

const FRAME = 1 / 60;
type Pose = readonly [number, number, number, number, number, number];
function pose(weapon: Weapon): Pose {
  const model = weapon.model;
  if (!(model instanceof Group)) throw new Error('A held sword is a model group');
  const { position: p, rotation: r } = model;
  return [p.x, p.y, p.z, r.x, r.y, r.z];
}
/** The largest turn about x (a chop) and about z (a sweep) off rest over the next `seconds`, and the pose at their end. */
function watch(weapon: Weapon, rest: Pose, seconds: number): { chop: number; sweep: number; moved: number; end: Pose } {
  let chop = 0, sweep = 0, moved = 0;
  for (let t = 0; t < seconds; t += FRAME) {
    weapon.update(FRAME, 0);
    const now = pose(weapon);
    chop = Math.max(chop, Math.abs(now[3] - rest[3])); sweep = Math.max(sweep, Math.abs(now[5] - rest[5]));
    moved = Math.max(moved, Math.hypot(now[0] - rest[0], now[1] - rest[1], now[2] - rest[2]));
  }
  return { chop, sweep, moved, end: pose(weapon) };
}
function expectRest(now: Pose, rest: Pose): void { for (let i = 0; i < 6; i++) expect(now[i]).toBeCloseTo(rest[i] ?? 0, 4); }

test('the held kit.melee sword swings on each strike, light across and heavy down, and comes back to rest', () => {
  const family = declaredKitItemFamilies().get('kit.melee');
  if (family?.kind !== 'weapon') throw new Error('kit.melee is a weapon family');
  const scope = new Scope('melee'), aim = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const actor = { id: 'actor.player', alive: true };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The view runtime strikes at nothing here.
  const runtime = new ItemRuntime(row, { actor, combat: { hit: () => null }, targets: () => [], hook: null, effect: () => undefined } as unknown as ConstructorParameters<typeof ItemRuntime>[1]);
  const handlers = new Map<string, () => void>();
  const equipment: EquipmentRow = { id: row.id, legacySlot: row.id as NonNullable<EquipmentRow['legacySlot']>, ui: { name: row.ui.name, icon: 'sword' as EquipmentRow['ui']['icon'], swapIcon: '', touch: 'melee', lockOn: true, melee: true, tracers: false }, meta: { name: row.ui.name, icon: 'sword' as EquipmentRow['ui']['icon'], blurb: '', category: 'weapon' } };
  const weapon = family.create(equipment, row, { scope, runtime, input: { bind: (action: string, run: () => void) => { handlers.set(action, run); }, held: () => false }, aim: () => aim, view: row.view, profile: row.profile });
  weapon.install({ scope: new Scope('melee.equip') });
  const sent: string[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the calls a melee view makes are recorded.
  weapon.wire = { press: (_started: boolean, heavy?: boolean) => { sent.push(heavy === true ? 'heavy' : 'light'); }, hold: () => undefined } as unknown as WeaponWire;

  weapon.update(FRAME, 0);
  const rest = pose(weapon);
  // Standing still: no strike, no motion.
  expect(watch(weapon, rest, 0.5).moved).toBe(0);

  // A light strike on the wire: the blade sweeps across and the hand travels, then it settles back.
  weapon.tryFire();
  expect(sent).toEqual(['light']);
  const light = watch(weapon, rest, 0.2);
  expect(light.sweep).toBeGreaterThan(0.8);
  expect(light.moved).toBeGreaterThan(0.08);
  expectRest(watch(weapon, rest, 1).end, rest);

  // A heavy strike: a chop, a bigger turn about x than the light one's, and less sweep.
  handlers.get('heavy')?.();
  expect(sent).toEqual(['light', 'heavy']);
  const heavy = watch(weapon, rest, 0.4);
  expect(heavy.chop).toBeGreaterThan(1);
  expect(heavy.chop).toBeGreaterThan(light.chop);
  expect(heavy.sweep).toBeLessThan(light.sweep);
  expectRest(watch(weapon, rest, 1).end, rest);

  // A charged hold let go on the wire: the server strikes heavy on its release, so the page chops too.
  weapon.adsHeld = true; watch(weapon, rest, row.charge + 0.05); weapon.adsHeld = false;
  expect(watch(weapon, rest, 0.4).chop).toBeGreaterThan(1);
  expectRest(watch(weapon, rest, 1).end, rest);
  // A tap of the hold, short of the charge, is no strike.
  weapon.adsHeld = true; watch(weapon, rest, 0.1); weapon.adsHeld = false;
  expect(watch(weapon, rest, 0.4).moved).toBe(0);

  // Off the wire the page's runtime strikes, and its `fire` phase swings the model.
  weapon.wire = null;
  weapon.tryFire();
  expect(watch(weapon, rest, 0.2).moved).toBe(0); // queued, not struck yet
  runtime.step(1, FRAME);
  expect(watch(weapon, rest, 0.2).sweep).toBeGreaterThan(0.8);
  expectRest(watch(weapon, rest, 1).end, rest);
  scope.dispose();
});
