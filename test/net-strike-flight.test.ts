import { readFileSync } from 'node:fs';
import { Mesh, Scene, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { buildTerrain } from '@wildshard/format/terrainField';
import { NetClient } from '../src/client/engine/net/client';
import { StrikeFlights } from '../src/client/game/shardfile/strikeFlight';
import { configureLevel } from '../src/shared/engine/level/selection';
import type { LevelSpec } from '../src/shared/engine/level/spec';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { flightPoint, projectileFlightStep } from '../src/shared/engine/combat/projectileFlight';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { authoredStrikeFixture } from './fixtures/authored-strike';

// ONE-FORMAT CC18c: a creature's strike launches a projectile the server sweeps; the wire's `flight` event (1.5) says where
// from, which way, how fast and how it falls, and every page flies it by the server's law. Two pages on one room draw the
// same flight within 0.2 m of each other and of the server's own ball, tick for tick.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
configureLevel({ id: 'cc18c', ground: { terrain: buildTerrain(78, { landscape: () => 0, trails: [], cabinSites: [] }) } } as unknown as LevelSpec);

test('the closed form stands where the server\'s steps put the ball', () => {
  const pos = new Vector3(1, 2, 3), vel = new Vector3(0.6, 0.2, -0.77).normalize().multiplyScalar(14), dir = vel.clone().normalize();
  const at = pos.clone(), out = new Vector3();
  for (let step = 1; step <= 90; step++) {
    projectileFlightStep(pos, vel, 1 / 60, { gravity: 9.8, drag: 0, windCoupling: 0 });
    expect(flightPoint(at, dir, 14, 9.8, 1 / 60, step, out).distanceTo(pos)).toBeLessThan(1e-9);
  }
});

test('two pages on one room draw one creature flight within 0.2 m of each other and of the server', async () => {
  const fixture = authoredStrikeFixture('fixture.bolt', 12, { projectile: { speed: 10, gravity: 2, radius: 0.1 } });
  const sim = createShardfileSim(fixture, new Map(), { rapier: await rapier });
  const room = new NetRoom({ world: new SimNetWorld(sim.host), step: () => { sim.host.step(); } });
  const pages = [directLoopback(), directLoopback()].map((link) => {
    const scene = new Scene(), client = new NetClient(link.client), flights = new StrikeFlights(scene);
    let heard = 0;
    client.onFlight((flight) => { heard++; flights.add(flight); });
    client.onCombat((event) => { if (event.kind === 'hit') flights.struck(event.at, event.tick); });
    return { link, client, scene, flights, heard: () => heard };
  });
  const balls = (scene: Scene): Vector3[] => scene.children.filter((child) => child instanceof Mesh && child.visible).map((child) => child.position.clone());
  try {
    for (const { link, client } of pages) { room.join(link.server); client.hello(); link.pump(); }
    room.open(); for (const { link } of pages) link.pump();
    const flight = sim.host.adapters.get('creatures.strike-flight');
    let compared = 0, flown = 0;
    for (let tick = 0; tick < 600; tick++) {
      room.tick(); for (const { link } of pages) link.pump();
      const server = ((flight?.snapshot() ?? []) as ({ at: [number, number, number] } | null)[]).filter((row) => row !== null);
      if (server.length === 0) { if (flown > 0) break; continue; } // one flight, to its end
      flown++;
      const now = sim.host.state.tick, shown = pages.map(({ flights, scene }) => { flights.show(now); return balls(scene); });
      if (shown.some((drawn) => drawn.length === 0)) continue; // a page hears of a flight with its next frame
      const [one, two] = shown, [truth] = server;
      expect(one).toHaveLength(server.length); expect(two).toHaveLength(server.length);
      if (one?.[0] === undefined || two?.[0] === undefined || truth === undefined) throw new Error('Missing flight');
      expect(one[0].distanceTo(two[0])).toBeLessThan(0.2);
      expect(one[0].distanceTo(new Vector3(...truth.at))).toBeLessThan(0.02); // the launch point's 16-bit metres, no step off
      compared++;
    }
    expect(flown).toBeGreaterThan(20);
    expect(compared).toBeGreaterThan(20);
    expect(pages.map((page) => page.heard())).toEqual([1, 1]);
  } finally { room.dispose(); sim.dispose(); }
});
