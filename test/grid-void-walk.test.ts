// SA34 (meta SHARD-AUTHORING-PLAN, J314, grill Q9): the in-page server's road carries a player off the outer road onto the void
// floor of an empty ring-3 cell and back, at road level. The page predicts its own player and puts the server's state back on any
// difference, so a server that can't walk there stops the page there too. The floor was once one 2875 m cuboid per band: a capsule
// walked a metre onto it, sank 0.17 m into its top and stuck (z ≈ 1441, y ≈ -0.17); it is a tiled trimesh now (`voidFloor.ts`).
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { onTestFinished, expect, test } from 'vitest';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { gridRail } from '../src/shared/game/grid/roadLayout';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';
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
  const directory = builtProduct(slug), loaded = await loadHeadlessProduct(directory);
  return { shard: loaded.shardfile, assets: runtimeAssets(loaded, directory), rapier, product: loaded };
}
const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

test('the server walks the player off the outer road onto the void floor of an empty ring-3 cell, and back', { timeout: 60_000 }, async () => {
  const strips = await bakedGridCollision(), control = new MessageChannel(), game = new MessageChannel();
  let running: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => product(slug), strips: () => Promise.resolve(strips),
    onSaveRefused: error => { throw error; }, proof: { arrival: ARRIVAL, booted: grid => { running = grid; } } });
  const shell: StandaloneShell = connectStandalone({ slug: SLUG, base: `/shards/${SLUG}/`, build: 'test', savePrefix: 'wildshard.', storage: new PageStorage() },
    control.port2, game.port2, () => { server.dispose(); });
  onTestFinished(() => { shell.dispose(); });
  await shell.booted;
  shell.ready(); shell.pause(); await turn(); await turn();
  const grid = (): StandaloneGrid => { if (running === undefined) throw new Error('No booted server'); return running; };
  for (let tick = 0; tick < 32 && shell.client.latest === null; tick++) { grid().tick(); await turn(); }
  const at = (): { site: string | null; x: number; y: number; z: number } => {
    const player = grid().host.players.get(PLAYER);
    if (player === undefined) throw new Error('No session player');
    return { site: grid().grid.current(), x: player.position.x, y: player.position.y, z: player.position.z };
  };
  // the page's yaw: π faces +z (north), 0 faces -z (south)
  const walk = async (yaw: number, done: (here: ReturnType<typeof at>) => boolean): Promise<ReturnType<typeof at>> => {
    for (let tick = 0; tick < 60 * 240; tick++) {
      const here = at();
      if (done(here)) return here;
      shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 }); shell.client.flush();
      await turn(); grid().tick(); await turn();
    }
    return at();
  };
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
