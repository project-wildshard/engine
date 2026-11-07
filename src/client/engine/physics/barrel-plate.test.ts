// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native collision implementation.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Bodies } from '../../../shared/engine/physics/bodies';
import { Physics } from '../../../shared/engine/physics/Physics';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { BARREL_BODY, BARREL_HALF, BARREL_R, BarrelWatch, plateOverlap } from '../../../shared/engine/world/interact/barrel';
import { Live, plateDown } from '../world/interact/Interactables';
import { Flags } from '../../../shared/engine/world/interact/flags';

test('page and native plates feel an upright or fallen barrel, respect filters and release when it leaves', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const physics = new Physics(rapier), bodies = new Bodies(physics);
  const at = { x: 3, y: 0, z: -2 }, plate = { position: at, yaw: Math.PI / 3 };
  const owner = new Live({ kind: 'barrel', id: 'puzzle-barrel', at: { poi: 'world', x: at.x, z: at.z }, leash: 20 }, new Flags('barrel-plate', false));
  try {
    const barrel = bodies.spawn({ ...BARREL_BODY, owner }, { ...at, y: BARREL_HALF + 0.01 });
    barrel.rb.setGravityScale(0, true);
    physics.step();
    expect(plateOverlap(physics, at, plate.yaw, 2, { inset: 0.1, depth: 0.1 })).toBe(true);
    expect(plateDown(physics, plate, 2, 'any')).toBe(true);
    expect(plateDown(physics, plate, 2, 'barrel')).toBe(true);
    expect(plateDown(physics, plate, 2, 'player')).toBe(false);
    expect(plateOverlap(physics, at, plate.yaw, 2, { accepts: candidate => candidate !== owner })).toBe(false);
    expect(plateOverlap(physics, at, plate.yaw, 2, { accepts: candidate => candidate === owner })).toBe(true);
    const halfTurn = Math.PI / 4;
    barrel.teleport({ ...at, y: BARREL_R + 0.01 }, { x: 0, y: 0, z: Math.sin(halfTurn), w: Math.cos(halfTurn) });
    physics.step();
    expect(plateOverlap(physics, at, plate.yaw, 2)).toBe(true);
    expect(plateDown(physics, plate, 2, 'any')).toBe(true);
    expect(plateDown(physics, plate, 2, 'barrel')).toBe(true);
    barrel.teleport({ ...at, x: at.x + 4, y: BARREL_HALF + 0.01 });
    physics.step();
    expect(plateOverlap(physics, at, plate.yaw, 2)).toBe(false);
    expect(plateDown(physics, plate, 2, 'any')).toBe(false);
    expect(plateDown(physics, plate, 2, 'barrel')).toBe(false);
  } finally { bodies.dispose(); physics.dispose(); }
});

test('the barrel watch continuation already owns an independent copy of its push window', () => {
  const watch = new BarrelWatch({ x: 0, y: 0, z: 0 }, 20);
  watch.restore({ lost: 1, wedge: 2, from: { x: 3, y: 4, z: 5 } });
  const saved = watch.state();
  saved.from.x = 100;
  watch.clear();
  expect(saved).toEqual({ lost: 1, wedge: 2, from: { x: 100, y: 4, z: 5 } });
  expect(watch.state()).toEqual({ lost: 0, wedge: 0, from: { x: 3, y: 4, z: 5 } });
});
