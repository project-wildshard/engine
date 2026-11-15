// oxlint-disable-next-line import/no-nodejs-modules -- Test the shipped Rapier WASM against the registered grid collider data.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { Physics } from '@wildshard/engine/physics/Physics';
import { CharacterMotor, PLAYER_BODY } from '@wildshard/engine/physics/CharacterMotor';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';
import { installStripCollider } from '@wildshard/engine/physics/stripColliders';
import { generatePlatform } from '@wildshard/engine/sim/strips';
import { TraversalReadiness } from '@wildshard/engine/sim/readiness';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { BUFFER_DEPTH, walledCells, zoneWallEdges } from '../../../shared/game/grid/zoneWalls';

// ZONE-ENTRY ZE5 (J352): the page's wall round a cell that is not the home, as GC7's cases met the old readiness wall: a walk,
// an 18 m/s boost, the road board's 120 m/s boost (J354), a jump, a 40 m fall and a slide along it, from the road on all four sides. Off the entryway every case stays
// on the road side of the cell's edge; into the entryway every case reaches the buffer and none passes the gate, 10 m in.
const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cell('driftwood-isle');
const empty = assembly.emptyNeighbour.edge;
const strips = generatePlatform([{ ...cell, edges: { north: empty, east: empty, south: empty, west: empty },
  observations: { north: { entryWidth: 8 }, east: { entryWidth: 8 }, south: { entryWidth: 8 }, west: { entryWidth: 8 } } }], empty);
const sides = [{ name: 'north', x: 0, z: 1 }, { name: 'east', x: 1, z: 0 }, { name: 'south', x: 0, z: -1 }, { name: 'west', x: -1, z: 0 }] as const;
const GRAVITY = 30, DT = 1 / 60;
const CASES = [
  { name: 'walk into it', y: 0.02, inward: 4.3, along: 0, jump: 0 },
  { name: 'boost into it at 18 m/s', y: 0.02, inward: 18, along: 0, jump: 0 },
  { name: 'board boost into it at 120 m/s (J354)', y: 0.02, inward: 120, along: 0, jump: 0 },
  { name: 'jump into it', y: 0.02, inward: 8, along: 0, jump: 9 },
  { name: 'fall into it from 40 m, at the wall still 19 m up', y: 40, inward: 12, along: 0, jump: 0 },
  { name: 'high jump into it, 2.4 m apex', y: 0.02, inward: 8, along: 0, jump: 12 },
  { name: 'slide along it, jumping', y: 0.02, inward: 4, along: 8, jump: 9 },
] as const;

test('every cell but the home is walled, and the home has no wall', () => {
  const home = assembly.cell('sunscar-dunes'), walled = walledCells(assembly, home);
  expect(walled).toHaveLength(assembly.cells.length - 1);
  expect(walled.some(row => row.instance === home.instance)).toBe(false);
  // per side: two edge runs, two buffer sides, one gate
  expect(zoneWallEdges(cell, cell).map(edge => edge.part).sort()).toEqual([...Array.from({ length: 8 }, () => 'edge'), ...Array.from({ length: 4 }, () => 'gate'), ...Array.from({ length: 8 }, () => 'side')]);
});

for (const side of sides) test(`${side.name}: the wall holds every case off the entryway, and the gate holds every case in the buffer`, async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const scope = new Scope('test.road'), road = new Physics(rapier, undefined, scope);
  const options = { radius: 0.38, height: 1.7, step: 0.35, maxClimbDeg: 40, snap: 0.3, ...PLAYER_BODY };
  const motor = new CharacterMotor(road, options);
  try {
    for (const strip of strips) installStripCollider(road, strip.mesh, scope);
    installEntrySockets(road, scope, [cell.origin]);
    const readiness = new TraversalReadiness(), walls = new ReadinessWalls(road, zoneWallEdges(cell, cell), scope);
    /** One case for 8 s from 14 m out at `lateral` along the side; the deepest the feet get (metres past the edge, negative
     *  inside the cell), the furthest they stray along the side and the lowest feet. */
    const run = (c: typeof CASES[number], lateral: number) => {
      const feet = { x: side.x * (CHUNK_HALF + 14) + side.z * lateral, y: c.y, z: side.z * (CHUNK_HALF + 14) + side.x * lateral };
      let vy = 0, deepest = Infinity, lowest = Infinity;
      for (let at = 0; at < 480; at++) {
        walls.sync(readiness); road.step();
        if (motor.result.grounded && c.jump > 0 && vy <= 0) vy = c.jump;
        vy = motor.result.grounded && vy <= 0 ? -1 : vy - GRAVITY * DT;
        const inward = c.inward * DT, along = c.along * DT;
        motor.move(feet, { x: -side.x * inward + side.z * along, y: vy * DT, z: -side.z * inward + side.x * along }, false);
        deepest = Math.min(deepest, side.x * feet.x + side.z * feet.z - CHUNK_HALF); lowest = Math.min(lowest, feet.y);
      }
      return { deepest, lowest };
    };
    for (const c of CASES) {
      const held = run(c, 60);
      expect(held.deepest, `${c.name}, 60 m off the entryway: held outside the cell`).toBeGreaterThan(0);
      expect(held.lowest, `${c.name}: never under the road`).toBeGreaterThan(-0.5);
    }
    for (const c of CASES.filter(row => row.along === 0)) {
      const buffer = run(c, 0);
      expect(buffer.deepest, `${c.name}, at the entryway: never past the gate`).toBeGreaterThan(-BUFFER_DEPTH);
      if (c.y < 1) expect(buffer.deepest, `${c.name}, at the entryway: into the buffer`).toBeLessThan(-BUFFER_DEPTH + 1);
    }
  } finally { motor.dispose(); scope.dispose(); road.dispose(); }
});
