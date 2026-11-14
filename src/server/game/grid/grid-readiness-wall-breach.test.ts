// oxlint-disable-next-line import/no-nodejs-modules -- Test the shipped Rapier WASM against the registered grid collider data.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { Physics } from '@wildshard/engine/physics/Physics';
import { CharacterMotor, PLAYER_BODY } from '@wildshard/engine/physics/CharacterMotor';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';
import { installStripCollider } from '@wildshard/engine/physics/stripColliders';
import { generatePlatform } from '@wildshard/engine/sim/strips';
import { TraversalReadiness, readinessModel } from '@wildshard/engine/sim/readiness';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { neighbourEdges } from '../../../shared/game/grid/readinessEdges';

// GRID-CROSSING GC7 (GC2's wall cases, Jake 11-12: "i think i jumped over the invisible wall"): the page's readiness wall in front of a
// neighbour that is not ready holds every way a player meets it: a walk, a boost at 18 m/s, a jump into it, a fall into it from 40 m
// and a slide along it, each from the road on all four sides. Once the neighbour is ready the same push goes through. A breach here would
// be the page's own physics; the server's road wall has the same cases in `test/grid-wall-breach.test.ts`.
const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cell('driftwood-isle');
const empty = assembly.emptyNeighbour.edge;
const strips = generatePlatform([{ ...cell, edges: { north: empty, east: empty, south: empty, west: empty },
  observations: { north: { entryWidth: 8 }, east: { entryWidth: 8 }, south: { entryWidth: 8 }, west: { entryWidth: 8 } } }], empty);
const estimate = readinessModel({ criticalWireBytes: 0, hybridWireBytes: 0, decodeSeconds: 0, runtimeParseSeconds: 0 },
  { speed: 30, linkBitsPerSecond: 1_000_000, requestLatencySeconds: 0.1, maxStallSeconds: 0 });
const sides = [{ name: 'north', x: 0, z: 1 }, { name: 'east', x: 1, z: 0 }, { name: 'south', x: 0, z: -1 }, { name: 'west', x: -1, z: 0 }] as const;
const GRAVITY = 30, DT = 1 / 60;
/** A case: where the feet start above the road, the push per tick inward and along the edge, and the jump speed when standing. */
const CASES = [
  { name: 'walk into it', y: 0.02, inward: 4.3, along: 0, jump: 0 },
  { name: 'boost into it at 18 m/s', y: 0.02, inward: 18, along: 0, jump: 0 },
  { name: 'jump into it', y: 0.02, inward: 8, along: 0, jump: 9 },
  { name: 'fall into it from 40 m', y: 40, inward: 8, along: 0, jump: 0 },
  { name: 'slide along it, jumping', y: 0.02, inward: 4, along: 8, jump: 9 },
] as const;

for (const side of sides) test(`${side.name}: a closed readiness wall holds every case, and an open one lets the same push through`, async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const scope = new Scope('test.road'), road = new Physics(rapier, undefined, scope);
  const options = { radius: 0.38, height: 1.7, step: 0.35, maxClimbDeg: 40, snap: 0.3, ...PLAYER_BODY };
  const motor = new CharacterMotor(road, options);
  try {
    for (const strip of strips) installStripCollider(road, strip.mesh, scope);
    const readiness = new TraversalReadiness(), walls = new ReadinessWalls(road, neighbourEdges(cell, cell), scope);
    /** Run one case for 4 s; returns the feet's nearest approach to the cell (metres past its edge on the road side) and the lowest feet. */
    const run = (c: typeof CASES[number]) => {
      const feet = { x: side.x * (CHUNK_HALF + 14), y: c.y, z: side.z * (CHUNK_HALF + 14) };
      let vy = 0, nearest = Infinity, lowest = Infinity;
      for (let at = 0; at < 240; at++) {
        walls.sync(readiness); road.step();
        if (motor.result.grounded && c.jump > 0 && vy <= 0) vy = c.jump;
        vy = motor.result.grounded && vy <= 0 ? -1 : vy - GRAVITY * DT;
        const inward = c.inward * DT, along = c.along * DT;
        motor.move(feet, { x: -side.x * inward + side.z * along, y: vy * DT, z: -side.z * inward + side.x * along }, false);
        nearest = Math.min(nearest, Math.max(Math.abs(feet.x), Math.abs(feet.z)) - CHUNK_HALF); lowest = Math.min(lowest, feet.y);
      }
      return { nearest, lowest };
    };
    for (const c of CASES) {
      const held = run(c);
      expect(held.nearest, `${c.name}: held on the road side of the closed wall`).toBeGreaterThan(4);
      expect(held.lowest, `${c.name}: never under the road`).toBeGreaterThan(-0.5);
    }
    const ticket = readiness.request(cell.instance, 0, estimate, true);
    if (ticket === null) throw new Error('Missing readiness ticket');
    readiness.complete(ticket, 'colliders'); readiness.complete(ticket, 'sim'); readiness.complete(ticket, 'runtime');
    expect(run(CASES[0]).nearest, 'the open wall lets a walk reach the edge').toBeLessThan(1);
  } finally { motor.dispose(); scope.dispose(); road.dispose(); }
});
