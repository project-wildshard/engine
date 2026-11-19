// NET-LAG NL14b1 (meta docs/plans/NET-LAG-PLAN.md): Nalati's 180 ms rig corrected 25 to 28 sprints a minute at (3.35, -7.28, 142),
// a terrain bank beside a boulder. Pressed in there the feet chattered, offline too: three steps of 0.7 cm along a 41-degree
// face, then one of 1.85 to 3 cm back off a 34-degree one, every 3 or 4 ticks, because the bank `slideOffBank` measured was the
// nearest face's normal and the nearest face flipped between the two. The page and the room chatter out of step. A sprint pressed
// into that pocket, and the climb out along the boulder after it, must move smoothly: no step back against the press.
// oxlint-disable-next-line import/no-nodejs-modules -- reads the pinned shard's bake and the shipped Rapier
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';

interface Bin { readonly file: string; readonly byteOffset: number; readonly byteLength: number }
interface Solid { readonly at: readonly number[]; readonly rot: readonly number[]; readonly shape: number; readonly half?: readonly number[]; readonly vertices?: Bin; readonly friction: number; readonly groups: number }
const root = 'out/nalati-grasslands';
const read = (file: string): unknown => JSON.parse(readFileSync(`${root}/${file}`, 'utf8'));
const shard = read('shard.json') as { files: { name: string; path: string }[]; admission: { server: { name: string; path: string }[] } };
const files = new Map(shard.files.map(row => [row.name, row.path]));
// The physics bake by its name in the admitted server set, not by a hash: a new Nalati pin (rev 3, fcfaf6469) moves the hash.
const physics = shard.admission.server.find(row => row.name === 'server/physics.json');
if (physics === undefined) throw new Error('The pinned Nalati product admits no server/physics.json');
const bake = read(physics.path) as {
  ground: { rows: number; cols: number; heights: { file: string }; scale: { x: number; y: number; z: number }; at: { x: number; y: number; z: number }; friction: number; groups: number };
  solids: Solid[] };
const bytes = (name: string): ArrayBuffer => Uint8Array.from(readFileSync(`${root}/${files.get(name) ?? name}`)).buffer;
const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

/** Nalati's terrain and the solids within 12 m of the pocket. */
function pocket(): Physics {
  const physics = new Physics(R), { ground } = bake;
  tagCollider(physics.world.createCollider(R.ColliderDesc.heightfield(ground.rows, ground.cols, new Float32Array(bytes(ground.heights.file)), ground.scale)
    .setTranslation(ground.at.x, ground.at.y, ground.at.z).setFriction(ground.friction).setCollisionGroups(ground.groups)), 'ground');
  for (const solid of bake.solids) {
    if (Math.hypot((solid.at[0] ?? 0) - 3.3, (solid.at[2] ?? 0) - 142) > 12) continue;
    const v = solid.vertices, desc = solid.shape === 9 && v !== undefined ? R.ColliderDesc.convexHull(new Float32Array(bytes(v.file), v.byteOffset, v.byteLength / 4))
      : solid.shape === 1 && solid.half !== undefined ? R.ColliderDesc.cuboid(solid.half[0] ?? 0, solid.half[1] ?? 0, solid.half[2] ?? 0) : null;
    if (desc === null) continue;
    physics.world.createCollider(desc.setTranslation(solid.at[0] ?? 0, solid.at[1] ?? 0, solid.at[2] ?? 0)
      .setRotation({ x: solid.rot[0] ?? 0, y: solid.rot[1] ?? 0, z: solid.rot[2] ?? 0, w: solid.rot[3] ?? 1 }).setFriction(solid.friction).setCollisionGroups(solid.groups));
  }
  physics.step();
  return physics;
}

test('nalati-grasslands: a sprint pressed into the bank by the boulder, and the climb out, never steps back', () => {
  const physics = pocket(), motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  try {
    const feet = { x: 3.3193, y: -7.2789, z: 141.993 };
    motor.resetAt(feet);
    motor.result.grounded = true;
    const backAt: string[] = [];
    let back = 0, worst = 0, jumps = 0, lastX = 0, lastZ = 0;
    // four seconds north into the pocket at a sprint, then two north-east, as the rig's sprint side-steps
    for (let tick = 0; tick < 360; tick++) {
      const was = feet.x, wasZ = feet.z, east = tick >= 240 ? 4.3 / 60 * Math.SQRT1_2 : 0, north = tick >= 240 ? 4.3 / 60 * Math.SQRT1_2 : 4.3 / 60;
      motor.move(feet, { x: east, y: -22 / 3600, z: -north });
      if (tick % 240 > 10 && feet.x < was - 0.005) { back++; worst = Math.max(worst, was - feet.x); backAt.push(`${String(tick)} at ${feet.x.toFixed(3)},${feet.y.toFixed(3)},${feet.z.toFixed(3)}`); }
      const stepX = feet.x - was, stepZ = feet.z - wasZ;
      // a chatter: the same press moving the feet a different way from one tick to the next (a phase's first ticks may turn; rounding the boulder changes contact a few times)
      if (tick % 240 > 10 && Math.hypot(stepX - lastX, stepZ - lastZ) > 0.01) jumps++;
      lastX = stepX; lastZ = stepZ;
    }
    expect(jumps, `the same press moved the feet a different way ${String(jumps)} times`).toBeLessThanOrEqual(10);
    expect(back, `the feet stepped back west ${String(back)} times, up to ${(worst * 100).toFixed(2)} cm: ${backAt.join('; ')}`).toBe(0);
  } finally { motor.dispose(); physics.dispose(); }
});
