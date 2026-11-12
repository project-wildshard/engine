import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { SaveStore } from '../src/shared/engine/saves/store';
import { resolveLevelBounds, type ShardPlayHooks } from '../src/shared/game/shard/runtime';
import { installBounds, playBounds, type BoundsHost } from '../src/client/engine/world/bounds';
import { installClientPlayerEnter } from '../src/client/game/shardfile/clientPlayerEnter';
import { installClientRuntimeHooks } from '../src/client/game/shardfile/clientRuntimeHooks';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import type { FallFloor } from '../src/server/host/standalone/fallFloor';
import { LiveGridSession, type LiveGridPage } from '../src/client/game/grid/liveSession';
import { declaredPlayArea } from '../src/shared/game/shardfile/playArea';
import { installShards } from '../src/client/game/shard/list';
import { serverInput } from './fixtures/dedicated/roomBench';

// SERVER-PARITY SS6 (meta docs/plans/SERVER-PARITY-PLAN.md): one fall floor. The page reads its play area from the manifest's
// bounds and then the `client/plan` rows that override them: Sky Reach's `player.enter` lowers its floor to −8 and widens it to
// ±250, Nine Dragon's `world.runtime-hooks` drops its floor to −20 past 200 m out. The room read only the manifest's floor (12,
// 25), so a player the page let fall was snapped back. Each case drops a player and steps both the page's own recovery
// (`installBounds` over the real feature installs) and a lone room's `FallFloor`: they reset on the same tick, or neither does.
const SKY = 'far-reach', NINE = 'nine-dragon-stack';
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); });

interface Drop { readonly x: number; readonly y: number; readonly z: number; /** metres per tick, down */ readonly fall: number }
const TICKS = 600;

/** The tick the page's own recovery puts the dropped player back, or null. */
async function pageResetTick(slug: string, drop: Drop): Promise<number | null> {
  const input = await serverInput(slug), product = input.product;
  if (product === undefined) throw new Error(`${slug} has no product`);
  const scope = new Scope(`ss6 page ${slug}`); closers.push(() => { scope.dispose(); });
  const position = { x: drop.x, y: drop.y, z: drop.z };
  const runtime = { hooks: {} as ShardPlayHooks, overhead: [] as unknown[], world: { player: { position } } };
  const ctx = { game: { runtime }, scope } as never;
  // in the page's phase order: `player.enter` (world) before `world.runtime-hooks` (world-bindings)
  const features = product.section('client/plan').features;
  for (const row of features) if (row.kind === 'player.enter') installClientPlayerEnter(ctx, row);
  for (const row of features) if (row.kind === 'world.runtime-hooks') installClientRuntimeHooks(ctx, row);
  const bounds = playBounds(resolveLevelBounds(input.shard.manifest?.bounds, runtime.hooks), false);
  let reset = false;
  const host: BoundsHost = { suspended: () => false, floorAt: () => undefined, toSpawn: () => { reset = true; },
    player: { position, yaw: 0, onGround: false, hover: false, spawn: () => { reset = true; } } };
  const systems: { run: (dt: number) => void }[] = [];
  installBounds({ addSystem: system => { systems.push(system as never); } }, scope, bounds, host);
  for (let tick = 0; tick < TICKS; tick++) {
    for (const system of systems) system.run(1 / 60);
    if (reset) return tick;
    position.y -= drop.fall;
  }
  return null;
}

/** SS6b: the tick a grid page puts the player back in a cell, or null. As the home, the page hands the live grid its floor as
 *  play.ts does; as an entered runtime region (a neighbour, or the home re-entered), the region's resident carries its product.
 *  The grid's `fallFloor()` reads the floor at the player's feet, in the cell's own x/z. */
async function gridPageResetTick(slug: string, drop: Drop, as: 'home' | 'region'): Promise<number | null> {
  const input = await serverInput(slug), product = input.product;
  if (product === undefined) throw new Error(`${slug} has no product`);
  const scope = new Scope(`ss6b grid page ${slug}`); closers.push(() => { scope.dispose(); });
  // play.ts's hand-off (on main before SS6b: `homeFallFloor: resolveLevelBounds(...).floor`, read once at the spawn: 25 for Nine Dragon)
  const area = declaredPlayArea(input.shard.manifest?.bounds, product);
  const page: Pick<LiveGridPage, 'homeFloorAt'> = area === undefined ? {} : { homeFloorAt: area.floorAt };
  installShards(input.shard.manifest === undefined ? [] : [input.shard.manifest as never]); // the grid looks its cells' shards up
  closers.push(() => { Reflect.deleteProperty(globalThis, Symbol.for('game.shards')); });
  const position = { x: drop.x, y: drop.y, z: drop.z };
  // the home cell sits away from the world origin, so its floor must be read in the cell's own x/z
  const origin = { x: 1500, z: -3000 }, cell = { instance: slug, slug, origin };
  const live: unknown = Object.create(LiveGridSession.prototype);
  if (!(live instanceof LiveGridSession)) throw new Error('Missing live session prototype');
  const region = { resident: { product, runtime: { hooks: {} } } };
  Object.assign(live, { page: as === 'home' ? page : {}, runtimeRegions: new Map(as === 'home' ? [] : [[slug, region]]),
    hybrid: { state: () => ({ instance: slug, ready: true }) },
    ports: { home: { instance: as === 'home' ? slug : 'elsewhere', origin }, assembly: { at: () => cell } },
    live: { worldFeet: () => ({ x: origin.x + position.x, y: position.y, z: origin.z + position.z }) } });
  let reset = false;
  const host: BoundsHost = { suspended: () => false, floorAt: () => undefined, toSpawn: () => { reset = true; }, grid: () => true,
    fallFloor: () => live.fallFloor(), player: { position, yaw: 0, onGround: false, hover: false, spawn: () => { reset = true; } } };
  const systems: { run: (dt: number) => void }[] = [];
  installBounds({ addSystem: system => { systems.push(system as never); } }, scope, playBounds(undefined, true), host);
  for (let tick = 0; tick < TICKS; tick++) {
    for (const system of systems) system.run(1 / 60);
    if (reset) return tick;
    position.y -= drop.fall;
  }
  return null;
}

/** The tick a lone room's fall floor puts the dropped player back, or null. */
async function serverResetTick(slug: string, drop: Drop): Promise<number | null> {
  const world = await openCellWorld({ instance: slug }, await serverInput(slug), undefined, { saves: new SaveStore({ local: null, session: null }), lone: true, wholeSolids: true, pageless: true });
  closers.push(() => { world.dispose(); });
  const fall: FallFloor = world.fallFloor(), position = { x: drop.x, y: drop.y, z: drop.z };
  let reset = false;
  const body = { yaw: 0, led: false, position, fall: { grounded: false }, board: { on: false }, resetPose: () => { reset = true; } };
  for (let tick = 0; tick < TICKS; tick++) {
    fall.step(body as never, () => { reset = true; });
    if (reset) return tick;
    position.y -= drop.fall;
  }
  return null;
}

const CASES: readonly { readonly name: string; readonly slug: string; readonly drop: Drop; readonly page: number | null }[] = [
  // the row's drops: Sky Reach at y 5 (page floor −8, the manifest's 12), Nine Dragon at y 20 (25 at its spawn on both)
  { name: 'Sky Reach dropped at y 5 by its spawn', slug: SKY, drop: { x: 0, y: 5, z: -5.5, fall: 0.25 }, page: 53 },
  { name: 'Nine Dragon dropped at y 20 by its spawn', slug: NINE, drop: { x: 0.95, y: 20, z: 7.5, fall: 0.25 }, page: 0 },
  // past the hooks' 200 m the page's floor is −20, not the manifest's 25
  { name: 'Nine Dragon dropped at y 20 220 m out', slug: NINE, drop: { x: 220, y: 20, z: 7.5, fall: 0.25 }, page: 161 },
  // Sky Reach's page area is ±250, wider than its manifest's x ±120: standing 200 m east is no fall on either side
  { name: 'Sky Reach standing 200 m east, inside the page area', slug: SKY, drop: { x: 200, y: 40, z: 0, fall: 0 }, page: null },
];

for (const { name, slug, drop, page } of CASES) test(`SS6: ${name}: page and server reset on the same tick`, { timeout: 120_000 }, async () => {
  const onPage = await pageResetTick(slug, drop);
  expect(onPage, `${name}: the page's reset tick`).toBe(page);
  expect(await serverResetTick(slug, drop), `${name}: the server's reset tick`).toBe(onPage);
});

// SS6b: in the grid the page read its home floor once, at the spawn, so Nine Dragon's page said 25 everywhere while its room
// let a player 220 m out fall to −20. Both now read the floor at the player's x/z through `declaredPlayArea`.
const GRID_CASES: readonly { readonly name: string; readonly slug: string; readonly drop: Drop; readonly page: number | null }[] = [
  { name: 'Nine Dragon dropped at y 20 220 m out', slug: NINE, drop: { x: 220, y: 20, z: 7.5, fall: 0.25 }, page: 161 },
  // inside 200 m the floor is still 25: a floor read in the world's x/z, not the cell's, would say −20 here
  { name: 'Nine Dragon dropped at y 30 150 m out', slug: NINE, drop: { x: 150, y: 30, z: 7.5, fall: 0.25 }, page: 21 },
  { name: 'Sky Reach dropped at y 5 by its spawn', slug: SKY, drop: { x: 0, y: 5, z: -5.5, fall: 0.25 }, page: 53 },
];
for (const as of ['home', 'region'] as const) for (const { name, slug, drop, page } of GRID_CASES) {
  test(`SS6b grid ${as}: ${name}: page and server reset on the same tick`, { timeout: 120_000 }, async () => {
    const room = await serverResetTick(slug, drop);
    expect(room, `${name}: the room's reset tick`).toBe(page);
    expect(await gridPageResetTick(slug, drop, as), `${name}: the grid page's reset tick`).toBe(room);
  });
}
