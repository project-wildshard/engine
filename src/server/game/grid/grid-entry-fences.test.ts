// oxlint-disable-next-line import/no-nodejs-modules -- Test the shipped Rapier WASM against the registered grid collider data.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { Physics } from '@wildshard/engine/physics/Physics';
import { CharacterMotor, PLAYER_BODY } from '@wildshard/engine/physics/CharacterMotor';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';
import { TransferWalls } from '@wildshard/engine/physics/transferWalls';
import { installStripCollider } from '@wildshard/engine/physics/stripColliders';
import { installEntrySockets } from '@wildshard/engine/physics/entrySockets';
import { generatePlatform } from '@wildshard/engine/sim/strips';
import { TraversalReadiness, readinessModel } from '@wildshard/engine/sim/readiness';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { neighbourEdges } from '../../../shared/game/grid/readinessEdges';

const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cell('driftwood-isle');
const empty = assembly.emptyNeighbour.edge;
const strips = generatePlatform([{ ...cell, edges: { north: empty, east: empty, south: empty, west: empty },
  observations: { north: { entryWidth: 8 }, east: { entryWidth: 8 }, south: { entryWidth: 8 }, west: { entryWidth: 8 } } }], empty);
const estimate = readinessModel({ criticalWireBytes: 0, hybridWireBytes: 0, decodeSeconds: 0, runtimeParseSeconds: 0 },
  { speed: 30, linkBitsPerSecond: 1_000_000, requestLatencySeconds: 0.1, maxStallSeconds: 0 });
const sides = [{ name: 'north', x: 0, z: 1 }, { name: 'east', x: 1, z: 0 },
  { name: 'south', x: 0, z: -1 }, { name: 'west', x: -1, z: 0 }] as const;

for (const side of sides) for (const hover of [false, true]) test(`${side.name}: ${hover ? 'hover' : 'walk'} reaches admission while closed and enters only after reframe`, async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const roadScope = new Scope('test.road'), regionScope = new Scope('test.region');
  const road = new Physics(rapier, undefined, roadScope), region = new Physics(rapier, undefined, regionScope);
  const options = { radius: 0.38, height: 1.7, step: 0.35, maxClimbDeg: 40, snap: 0.3, ...PLAYER_BODY };
  const motor = new CharacterMotor(road, options);
  let incoming: CharacterMotor | undefined;
  try {
    for (const [physics, scope] of [[road, roadScope], [region, regionScope]] as const) {
      for (const strip of strips) installStripCollider(physics, strip.mesh, scope);
      installEntrySockets(physics, scope, [cell.origin]);
    }
    const readiness = new TraversalReadiness(), walls = new ReadinessWalls(road, neighbourEdges(cell, cell), roadScope);
    const hold = new TransferWalls(() => road, [cell.origin], options.radius, 'entry', roadScope);
    const destinationHold = new TransferWalls(() => region, [cell.origin], options.radius, 'exit', regionScope);
    const feet = { x: side.x * (CHUNK_HALF + 8), y: hover ? 0.45 : 0.02, z: side.z * (CHUNK_HALF + 8) };
    const stride = hover ? 0.25 : 0.08, want = { x: -side.x * stride, y: hover ? 0 : -0.02, z: -side.z * stride };
    for (let at = 0; at < 180; at++) { walls.sync(readiness); hold.sync(); road.step(); motor.move(feet, want, hover); }
    const distance = Math.max(Math.abs(feet.x), Math.abs(feet.z)) - CHUNK_HALF;
    expect(distance).toBeLessThanOrEqual(6);
    expect(distance).toBeGreaterThan(0); // An unadmitted traveller still cannot enter the authored cell.
    const ticket = readiness.request(cell.instance, 0, estimate, true);
    if (ticket === null) throw new Error('Missing readiness ticket');
    readiness.complete(ticket, 'colliders'); readiness.complete(ticket, 'sim'); readiness.complete(ticket, 'runtime');
    walls.sync(readiness);
    for (let at = 0; at < 10; at++) { hold.sync(); road.step(); motor.move(feet, want, hover); }
    expect(Math.max(Math.abs(feet.x), Math.abs(feet.z))).toBeGreaterThan(CHUNK_HALF);
    incoming = motor.transferTo(region, feet);
    for (let at = 0; at < 180 && Math.max(Math.abs(feet.x), Math.abs(feet.z)) > CHUNK_HALF - 1; at++) {
      destinationHold.sync(); region.step(); incoming.move(feet, want, hover);
    }
    expect(assembly.at(feet.x, feet.z)?.instance).toBe(cell.instance);
    expect(Math.max(Math.abs(feet.x), Math.abs(feet.z))).toBeLessThanOrEqual(CHUNK_HALF - 1);
    expect(feet.y).toBeGreaterThan(-0.05);
  } finally { incoming?.dispose(); motor.dispose(); regionScope.dispose(); roadScope.dispose(); region.dispose(); road.dispose(); }
});
