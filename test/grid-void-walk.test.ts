// SA34 (meta SHARD-AUTHORING-PLAN, J314, grill Q9): the in-page server's road carries a player off the outer road onto the void
// floor of an empty ring-3 cell and back, at road level. The page predicts its own player and puts the server's state back on any
// difference, so a server that can't walk there stops the page there too. The floor was once one 2875 m cuboid per band: a capsule
// walked a metre onto it, sank 0.17 m into its top and stuck (z ≈ 1441, y ≈ -0.17); it is a tiled trimesh now (`voidFloor.ts`).
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { onTestFinished, expect, test } from 'vitest';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { PLATFORM_COLLIDER_OWNER } from '../src/shared/engine/physics/stripColliders';
import { tagOf } from '../src/shared/engine/physics/surface';
import { gridRail } from '../src/shared/game/grid/roadLayout';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';
import { bakedGridCollision } from './fixtures/gridCollision';

const PLAYER = 'actor.player', SLUG = 'sunscar-dunes', P = CONTENT_CAPS.pitch;
/** The outer road north of ring 2's [0, 2], heading north into ring 3's empty [0, 3]. */
const ARRIVAL = { x: 0, y: 0, z: 2 * P + P / 2 + 20 };
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
let rapier: Rapier | undefined;
async function product(slug: string): Promise<HeadlessRuntimeInput> {
  rapier ??= await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const directory = builtFolder(slug), loaded = await loadHeadlessFolder(directory);
  return { shard: loaded.shardfile, assets: runtimeAssets(loaded, directory), rapier, product: loaded };
}
const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
interface Standing { readonly site: string | null; readonly x: number; readonly y: number; readonly z: number }
interface Page { readonly shell: StandaloneShell; readonly grid: () => StandaloneGrid; readonly at: () => Standing;
  /** Walk facing `yaw` (the page's: π faces +z, north; 0 faces -z) until `done`. */
  readonly walk: (yaw: number, done: (here: Standing) => boolean) => Promise<Standing>;
  /** The road world's void colliders: its floor (platform trimeshes that are no strip's) and its rim. */
  readonly voidColliders: () => number }
/** A page and its worker on `storage`, booted, with its clock paused: the test ticks it. */
async function page(storage: PageStorage, arrival?: typeof ARRIVAL): Promise<Page> {
  const strips = await bakedGridCollision(), control = new MessageChannel(), game = new MessageChannel();
  let running: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => product(slug), strips: () => Promise.resolve(strips),
    onSaveRefused: error => { throw error; }, proof: { ...(arrival === undefined ? {} : { arrival }), booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug: SLUG, base: `/shards/${SLUG}/`, build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); });
  onTestFinished(() => { shell.dispose(); });
  await shell.booted;
  shell.ready(); shell.pause(); await turn(); await turn();
  const grid = (): StandaloneGrid => { if (running === undefined) throw new Error('No booted server'); return running; };
  for (let tick = 0; tick < 32 && shell.client.latest === null; tick++) { grid().tick(); await turn(); }
  const at = (): Standing => {
    const player = grid().host.players.get(PLAYER);
    if (player === undefined) throw new Error('No session player');
    return { site: grid().grid.current(), x: player.position.x, y: player.position.y, z: player.position.z };
  };
  const walk = async (yaw: number, done: (here: Standing) => boolean): Promise<Standing> => {
    for (let tick = 0; tick < 60 * 240; tick++) {
      const here = at();
      if (done(here)) return here;
      shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 }); shell.client.flush();
      await turn(); grid().tick(); await turn();
    }
    return at();
  };
  // the strips are held near the player and are no tile: a void tile's collider sits at road level on a box's centre
  const voidColliders = (): number => {
    let count = 0;
    grid().host.physics.world.forEachCollider(collider => { if (tagOf(collider)?.owner === PLATFORM_COLLIDER_OWNER && !strips.some(strip => strip.mesh.origin.x === collider.translation().x && strip.mesh.origin.z === collider.translation().z)) count++; });
    return count;
  };
  return { shell, grid, at, walk, voidColliders };
}
test('the server walks the player off the outer road onto the void floor of an empty ring-3 cell, and back', { timeout: 60_000 }, async () => {
  const { at, walk } = await page(new PageStorage(), ARRIVAL);
  const start = at();
  expect(start.site).toBeNull();
  expect(start.z).toBeCloseTo(ARRIVAL.z, 0);
  let lowest = Infinity;
  const middle = await walk(Math.PI, here => { lowest = Math.min(lowest, here.y); return here.z >= 3 * P; });
  expect(middle.site).toBeNull();
  expect(middle.z).toBeGreaterThanOrEqual(3 * P);
  expect(Math.abs(middle.y - 0.02)).toBeLessThan(0.05);
  // on to the rail: the rim holds the player on the floor, inside the 7 × 7
  const rail = gridRail(P);
  let last = middle.z, still = 0;
  const held = await walk(Math.PI, here => { lowest = Math.min(lowest, here.y); still = Math.abs(here.z - last) < 1e-3 ? still + 1 : 0; last = here.z; return still > 30; });
  expect(held.z).toBeLessThan(rail.maxZ);
  expect(held.z).toBeGreaterThan(rail.maxZ - 2);
  expect(Math.abs(held.y - 0.02)).toBeLessThan(0.05);
  const back = await walk(0, here => { lowest = Math.min(lowest, here.y); return here.z <= ARRIVAL.z; });
  expect(back.z).toBeLessThanOrEqual(ARRIVAL.z);
  expect(Math.abs(back.y - 0.02)).toBeLessThan(0.05);
  expect(lowest).toBeGreaterThan(-0.02);
});

test('a restored road holds one void floor, and feet the old slab had sunk stand back on it', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = await page(storage, ARRIVAL), fresh = first.voidColliders();
  expect(fresh).toBeGreaterThan(4);
  // the one-slab floor's stuck player: over the void in [0, 3], 0.17 m below road level
  first.grid().place({ x: 0, y: -0.17, z: 3 * P, yaw: Math.PI });
  expect(await first.shell.save()).toMatchObject({ ok: true });
  first.shell.dispose();
  for (let boot = 0; boot < 2; boot++) {
    const next = await page(storage);
    expect(next.at().site).toBeNull();
    expect(next.voidColliders()).toBe(fresh);
    expect(next.at().y).toBeCloseTo(0.02, 2);
    const walked = await next.walk(Math.PI, here => here.z >= 3 * P + 20);
    expect(Math.abs(walked.y - 0.02)).toBeLessThan(0.05);
    expect(await next.shell.save()).toMatchObject({ ok: true });
    next.shell.dispose();
  }
});
