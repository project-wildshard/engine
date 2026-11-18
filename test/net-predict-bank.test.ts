// NET-LAG NL14b2 (meta docs/plans/NET-LAG-PLAN.md): sprints that reached Driftwood's ramp (-5, 6.3, -105) corrected the owner
// 5.6 to 11.3 times a minute on staging. Under the cove cliff the feet stand on a terrain bank just past the 40-degree climb,
// against a crag's box wall, and the controller meets bank and wall inside its skin at time 0: it slides off whichever its
// query tree visits first. The page's world and the room's never build that tree alike, so with the same commands from the same state
// they alternated 3 to 5 cm out of step every tick. A press into that corner must give the same feet in any collider order.
// oxlint-disable-next-line import/no-nodejs-modules -- reads the shipped Rapier
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadCookedFolder } from '../src/server/host/headlessFolder';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { createNativeProofResident, prepareFolderPlan } from '../src/test/game/headlessNative';
import { builtFolder } from './fixtures/engine-lift/folder';

type Make = (into: Physics) => void;

/** The room's static solids within 12 m of the ramp, and its terrain, as builders for another world. */
async function rampSolids(R: Rapier): Promise<{ terrain: Make[]; rest: Make[] }> {
  const resident = await createNativeProofResident(await loadCookedFolder(builtFolder('driftwood-isle'), R), prepareFolderPlan);
  const terrain: Make[] = [], rest: Make[] = [], from = resident.host.physics;
  try {
    from.world.forEachCollider(c => {
      if (!c.isEnabled() || c.isSensor() || c.parent() !== null) return;
      const t = c.translation(), q = c.rotation(), type = c.shapeType(), groups = c.collisionGroups(), friction = c.friction(), tag = from.colliderTag(c);
      if (type !== 7 && Math.hypot(t.x + 5, t.z + 106) > 12) return;
      let desc: (r: Rapier) => ReturnType<Rapier['ColliderDesc']['cuboid']> | null;
      if (type === 1) {
        const h = c.halfExtents();
        if (h === null) throw new Error('A box with no half extents');
        desc = r => r.ColliderDesc.cuboid(h.x, h.y, h.z);
      }
      else if (type === 2) { const radius = c.radius(), half = c.halfHeight(); desc = r => r.ColliderDesc.capsule(half, radius); }
      else if (type === 7) {
        const h = Float32Array.from(c.heightfieldHeights()), s = c.heightfieldScale(), n = c.heightfieldNRows();
        if (s === null) throw new Error('A heightfield with no scale');
        desc = r => r.ColliderDesc.heightfield(n, n, h, s);
      }
      else throw new Error(`Unexpected shape ${String(type)} at the ramp`);
      (type === 7 ? terrain : rest).push(into => {
        const made = desc(into.R);
        if (made === null) throw new Error('Unbuildable ramp collider');
        const collider = into.world.createCollider(made.setTranslation(t.x, t.y, t.z).setRotation(q).setCollisionGroups(groups).setFriction(friction));
        if (tag !== undefined) tagCollider(collider, tag.material, tag.owner);
      });
    });
  } finally { resident.dispose(); }
  return { terrain, rest };
}

/** A sprint pressed north-west into the corner for a second, from where staging's corrected sprints stood, in a world built in `order`. */
function press(R: Rapier, order: readonly Make[], othersFirst: boolean): number[] {
  const physics = new Physics(R), others = (): void => { for (let i = 0; i < 3; i++) physics.world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(400 + i * 5, 0, 0)); };
  if (othersFirst) others();
  const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  for (const make of order) make(physics);
  if (!othersFirst) others();
  const feet = { x: -5.990556368920807, y: 6.080401223919216, z: -107.38263137807007 }, path: number[] = [];
  motor.resetAt(feet);
  try {
    physics.step();
    motor.move(feet, { x: 0, y: -22 / 3600, z: 0 });
    for (let tick = 0; tick < 60; tick++) {
      physics.step();
      motor.move(feet, { x: -0.08328925934374225, y: -22 / 3600, z: -0.08550045917810506 });
      path.push(feet.x, feet.y, feet.z);
    }
  } finally { motor.dispose(); physics.dispose(); }
  return path;
}

test('driftwood: a sprint pressed into the ramp\'s bank and the cove cliff is the same in any collider order', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const { terrain, rest } = await rampSolids(R);
  expect(terrain).toHaveLength(1);
  expect(rest.length).toBeGreaterThan(10);
  const authored = [...terrain, ...rest], base = press(R, authored, true);
  for (const [name, order] of [['terrain last', [...rest, ...terrain]], ['reversed', [...authored].reverse()], ['solids reversed', [...terrain, ...[...rest].reverse()]]] as const) {
    for (const othersFirst of [true, false]) {
      const other = press(R, order, othersFirst), worst = base.reduce((most, value, i) => Math.max(most, Math.abs(value - (other[i] ?? Number.NaN))), 0);
      expect(worst, `${name}, others ${othersFirst ? 'first' : 'last'}: the press parts by ${worst.toExponential(2)} m`).toBe(0);
    }
  }
  // the bank is steeper than the climb: pressing into it does not climb it
  expect(base.at(-2) ?? Number.NaN).toBeLessThan(6.080401223919216 + 0.05);
});
