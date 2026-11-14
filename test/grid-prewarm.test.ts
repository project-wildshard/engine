// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real regional physics and traveller transfer.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimHost, type SimLevel } from '@wildshard/engine/sim';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { LiveGridHost } from '../src/client/game/grid/live';
import { PageResidency } from '../src/client/game/grid/pageResidency';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { TraversalReadiness } from '@wildshard/engine/sim/readiness';
import type { ReadinessWalls } from '@wildshard/engine/physics/readinessWalls';

// GC5 (QA-FEEDBACK 11-13 row 39): a boost crosses the 50 m road in under 3 s, and the world built on the road took 4 to 7.6 s,
// so every boost held at the neighbour's loading wall. The page now builds the neighbour's world from inside the source, at
// the distance its build time covers at the traveller's speed, and keeps it while the traveller stays near.
const level: SimLevel = { version: 3, id: 'platform', seed: 1, ground: { size: 500, height: 0 },
  player: { at: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 30 }, entities: [], quests: [],
  weapon: { id: 'none', shape: { kind: 'point', radius: 0 }, windup: 0, active: 0, recover: 0, cooldown: 0, range: 0, damage: 0, tags: [] } };
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 5); });

async function rig(options: { isolated?: boolean; bytes?: number; optional?: (cell: string) => Promise<void>; walls?: (readiness: TraversalReadiness) => void; lastCell?: boolean } = {}) {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const assembly = new GridAssembly({ developer: false, devserver: false });
  const home = assembly.cell('driftwood-isle');
  const east = assembly.cells.find(cell => cell.origin.x === assembly.pitch && cell.origin.z === 0);
  const north = assembly.cells.find(cell => cell.origin.x === 0 && cell.origin.z === assembly.pitch);
  if (east === undefined || north === undefined) throw new Error('Missing cardinal neighbours');
  const page = createSimHost(level, { rapier }), residency = new PageResidency();
  const player = { position: leadPlayer(page).position, yaw: 0, health: leadPlayer(page).health, owner: leadPlayer(page), motor: leadPlayer(page).releaseMotor() };
  const created: string[] = [], admits: string[] = [];
  const live = new LiveGridHost(assembly, {
    home: { mode: 'owned', instance: home.instance, bytes: 1000, residency: residency.admitHome(home.instance, 1000) },
    player, allocator: residency.allocator, bindFrame: () => undefined, gameplayReady: () => true, buildAhead: true,
    // the page's own policy (liveSession.ts): the cell just left stays 30 s on the road
    ...(options.lastCell === true ? { lastCell: { windowMs: 30_000, playingBytes: 2_000_000_000, schedule: (expire: () => void, ms: number) => { const timer = setTimeout(expire, ms); return () => { clearTimeout(timer); }; } } } : {}),
    highway: { bytes: 1000, create: () => ({ physics: page.physics, dispose: () => undefined,
      ...(options.walls === undefined ? {} : { walls: { sync: options.walls } as unknown as ReadinessWalls }) }) },
    prefetchable: () => true,
    readiness: { link: { speed: 30, linkBitsPerSecond: 5_000_000, requestLatencySeconds: 0.25, maxStallSeconds: 3 },
      bundle: () => ({ criticalWireBytes: 1000, hybridWireBytes: 1000, decodeSeconds: 0, runtimeParseSeconds: 0 }) },
    admit: async (cell, required) => { admits.push(`${cell.instance}:${required ? 'required' : 'optional'}`);
      if (!required && options.optional !== undefined && cell.instance !== home.instance) await options.optional(cell.instance);
      return {bytes: cell.instance === home.instance ? 1000 : options.bytes ?? 1000, exclusiveRuntime: true,
      ...options.isolated === false ? {} : { isolatedPreparation: true }, prepareRuntime: () => Promise.resolve(),
      create: () => {
        created.push(cell.instance);
        const host = createSimHost(level, { rapier, playerBody: false, ground: false });
        return Promise.resolve({ host, dispose: () => { host.dispose(); } });
      } }; },
  });
  (await live.prepare(null, home.instance)).commit();
  /** One fixed step's move at `speed` m/s along x (sign +1 east, -1 west), then the host's fixed step. */
  const step = async (speed: number, sign = 1, axis: 'x' | 'z' = 'x'): Promise<void> => {
    player.position[axis] += sign * speed / 60; live.beforeFixed(); await settle();
  };
  /** the east neighbour's square, in metres from the feet */
  const toEast = (): number => assembly.pitch - CHUNK_HALF - player.position.x;
  const dispose = (): void => { live.dispose(); player.motor.dispose(); page.dispose(); residency.dispose(); };
  return { live, home, east, north, player, created, admits, step, toEast, dispose, residency };
}

test('boost: the neighbour\'s world is built from inside the source, at its speed\'s lead, and the entry finds it', async () => {
  const r = await rig();
  try {
    // 14 s default build (a product read and a world: Pine's are 6 to 8 s each) × 1.25 + 8 m, capped at 200 m at a boost
    // (the road is 50 m: 2.8 s at 18 m/s)
    const lead = Math.min(200, 8 + 18 * 14 * 1.25);
    r.player.position.x = r.east.origin.x - CHUNK_HALF - lead - 40;
    r.live.beforeFixed();
    while (r.toEast() > lead + 2) await r.step(18);
    expect(r.created).toEqual([r.home.instance]); // not yet: further than its lead
    while (r.toEast() > lead - 6) await r.step(18);
    await expect.poll(() => r.live.ready(r.east.instance), { timeout: 5000, interval: 10 }).toBe(true);
    expect(r.live.current()).toBe(r.home.instance); // still inside the source
    expect(r.player.position.x).toBeLessThan(CHUNK_HALF - 50);
    expect(r.live.state().ahead).toEqual({ instance: r.east.instance, warms: 1, refused: null });
    // on to the line, out onto the road and into the neighbour: the world built ahead is the one entered
    while (r.player.position.x < CHUNK_HALF + 10.5) await r.step(18);
    (await r.live.prepare(r.home.instance, null)).commit();
    while (r.toEast() > 5) await r.step(18);
    expect(r.live.ready(r.east.instance)).toBe(true);
    (await r.live.prepare(null, r.east.instance)).commit();
    expect(r.created).toEqual([r.home.instance, r.east.instance]);
    expect(r.live.state().issues).toEqual({});
  } finally { r.dispose(); }
  expect(r.residency.allocator.entries()).toEqual([]);
});

test('walk: the lead (83 m at 4.3 m/s) starts the world inside the source, not before, and the road keeps it', async () => {
  const r = await rig();
  try {
    const lead = 8 + 4.3 * 14 * 1.25;
    r.player.position.x = r.east.origin.x - CHUNK_HALF - lead - 30; r.live.beforeFixed();
    while (r.toEast() > lead + 1) await r.step(4.3);
    expect(r.created).toEqual([r.home.instance]); expect(r.live.state().ahead?.warms).toBe(0);
    while (r.toEast() > lead - 3) await r.step(4.3);
    await expect.poll(() => r.live.ready(r.east.instance), { timeout: 5000, interval: 10 }).toBe(true);
    expect(r.live.current()).toBe(r.home.instance); expect(r.live.state().ahead?.warms).toBe(1);
    while (r.player.position.x < CHUNK_HALF + 10.5) await r.step(4.3);
    (await r.live.prepare(r.home.instance, null)).commit();
    await r.step(4.3); await r.step(4.3);
    expect(r.live.ready(r.east.instance)).toBe(true);
    expect(r.created).toEqual([r.home.instance, r.east.instance]);
  } finally { r.dispose(); }
});

test('a pre-warmed world goes when the traveller turns back deep into the source or heads for another neighbour', async () => {
  const r = await rig();
  try {
    r.player.position.x = r.east.origin.x - CHUNK_HALF - 150; r.live.beforeFixed();
    while (r.toEast() > 100) await r.step(18);
    await expect.poll(() => r.live.ready(r.east.instance), { timeout: 5000, interval: 10 }).toBe(true);
    // a stop near the border keeps it
    for (let tick = 0; tick < 10; tick++) { r.live.beforeFixed(); await settle(); }
    expect(r.live.state().residents).toEqual([r.east.instance, r.home.instance].sort());
    // back west past the keep distance: it retires, and is built again on the next approach
    while (r.toEast() < 250) await r.step(18, -1);
    for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
    await expect.poll(() => r.live.state().residents, { timeout: 5000, interval: 10 }).toEqual([r.home.instance]);
    // measured now: a build of ~0 s leads by the 2 s floor (53 m at a boost)
    while (r.toEast() > 50) await r.step(18);
    await expect.poll(() => r.live.ready(r.east.instance), { timeout: 5000, interval: 10 }).toBe(true);
    // turned north into Pine's mouth: the east world goes and the north one is pre-warmed in its turn
    r.player.position.x = 0; r.player.position.z = CHUNK_HALF - 150; r.live.beforeFixed(); await settle();
    while (r.north.origin.z - CHUNK_HALF - r.player.position.z > 130) await r.step(18, 1, 'z');
    await expect.poll(() => r.live.ready(r.north.instance), { timeout: 5000, interval: 10 }).toBe(true);
    await expect.poll(() => r.live.state().residents, { timeout: 5000, interval: 10 }).toEqual([r.home.instance, r.north.instance].sort());
    expect(r.created.filter(instance => instance === r.east.instance)).toHaveLength(2);
    expect(r.live.state().issues).toEqual({});
  } finally { r.dispose(); }
});

test('no pre-warm beside an opaque runtime, or when both worlds would not fit: the road builds it as before', async () => {
  for (const options of [{ isolated: false }, { bytes: 2_000_000_000 }]) {
    const r = await rig(options);
    try {
      r.player.position.x = r.east.origin.x - CHUNK_HALF - 150; r.live.beforeFixed();
      while (r.player.position.x < CHUNK_HALF - 1) await r.step(18);
      for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
      expect(r.created).toEqual([r.home.instance]);
      expect(r.live.state().ahead?.warms).toBe(0);
    } finally { r.dispose(); }
  }
});

test('QA 11-13 row 43: a traveller standing at a neighbour\'s wall on the road has that world built, with no heading', async () => {
  const r = await rig();
  try {
    // out onto the road, then stood still 2 m short of the east cell's edge (inside its wall reach): no travel, no heading
    r.player.position.x = CHUNK_HALF - 0.5; (await r.live.prepare(r.home.instance, null)).commit();
    r.player.position.x = r.east.origin.x - CHUNK_HALF - 2;
    for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
    await expect.poll(() => r.live.ready(r.east.instance), { timeout: 5000, interval: 10 }).toBe(true);
    expect(r.live.state().ahead?.instance).toBe(r.east.instance);
    // mid-road between cells, clear of every wall: nothing more is built
    r.player.position.x = r.east.origin.x - CHUNK_HALF - 30; r.player.position.z = 0;
    for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
    expect(r.created.filter(instance => instance !== r.home.instance && instance !== r.east.instance)).toEqual([]);
  } finally { r.dispose(); }
});

test('GC9: a radial read the budget holds pending is raised to demand once, so the near neighbour is read inside the source', async () => {
  // Pine's radial read stood pending and was declined again and again inside Driftwood; the demand read never started, so
  // Pine's world was built only on the road (9 to 13 s) and the walk held at its wall
  let decline = (): void => undefined;
  const declined = new Promise<void>(resolve => { decline = resolve; });
  const r = await rig({ optional: async () => { await declined; throw new Error('Product residency admission deferred'); } });
  try {
    r.player.position.x = r.east.origin.x - CHUNK_HALF - 70;
    for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
    expect(r.admits.filter(row => row.startsWith(r.east.instance))).toEqual([`${r.east.instance}:optional`]);
    decline();
    await expect.poll(() => r.admits.includes(`${r.east.instance}:required`), { timeout: 5000, interval: 10 }).toBe(true);
    await expect.poll(() => r.live.state().pending.includes(r.east.instance), { timeout: 5000, interval: 10 }).toBe(false);
    expect(r.live.state().issues).toEqual({});
    // one raise, not one per tick
    expect(r.admits.filter(row => row === `${r.east.instance}:required`)).toHaveLength(1);
  } finally { r.dispose(); }
});

test('ROAD-PRELOAD RP4b: the road never closes a readiness wall on the home cell\'s own edge while the home is resident', async () => {
  // J320 / Jake ~10:20: "never a wall between the player's own cell and the road". The road's walls close at a cell's edge
  // while that cell is not ready; the home kept as the last cell (liveSession's 30 s policy) stays ready on the road beside
  // it, a boost along its edge and back. (Heading into another cell's mouth retires it for that cell's world: a home left
  // that way is a loading cell on return, the wall GC36 allows.)
  let syncs = 0, closed = 0, home = '';
  const r = await rig({ lastCell: true, walls: readiness => { syncs++; if (!readiness.isReady(home)) closed++; } });
  home = r.home.instance;
  try {
    // committed onto the road's strip beside the cell's east edge (a committed placement is no heading)
    r.player.position.x = CHUNK_HALF + 8; (await r.live.prepare(r.home.instance, null)).commit();
    expect(r.live.current()).toBeNull();
    expect(r.live.retainDeparted(r.home.instance)).toBe(true); // as liveSession does on every leave
    // a boost north along the edge and back, a walk south, back to the edge
    for (let tick = 0; tick < 5; tick++) { r.live.beforeFixed(); await settle(); }
    while (r.player.position.z < CHUNK_HALF - 40) await r.step(18, 1, 'z');
    while (r.player.position.z > -100) await r.step(18, -1, 'z');
    while (r.player.position.z < 0) await r.step(4.3, 1, 'z');
    while (r.player.position.x > CHUNK_HALF + 1) await r.step(4.3, -1);
    expect(r.live.state().residents).toContain(r.home.instance);
    expect(syncs).toBeGreaterThan(100);
    expect(closed, 'a readiness wall closed on the home cell\'s own edge').toBe(0);
  } finally { r.dispose(); }
});
