// MMO-PLAN MP1C.4 (J214, J190's resume rule): a page that dies mid-crossing comes back at the last save it made, never at the
// home's spawn and never in a half-entered cell. The solo server runs in the page's own worker, so a crash here is the shell
// going away with nothing said: no save on the way out, and any write still in flight is lost with it.
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { onTestFinished, expect, test } from 'vitest';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';
import { bakedGridCollision } from './fixtures/gridCollision';

const PLAYER = 'actor.player', SLUG = 'sunscar-dunes';
/** On the road east of a cell: walking west (yaw -90°) crosses its seam, as `net-fuzz`'s crossing does. */
const ARRIVAL = { x: -259, y: 0, z: 0 };
/** A page's storage. `dieAfter(n)` lets n more writes land and drops every one after: the tab died with a save half written. */
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  private left = Infinity;
  get length(): number { return this.items.size; }
  get dead(): boolean { return this.left <= 0; }
  dieAfter(writes: number): void { this.left = writes; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.left <= 0) return; this.left--; this.items.set(key, value); }
  removeItem(key: string): void { if (this.left <= 0) return; this.left--; this.items.delete(key); }
  /** Whether a site document (`continuation.ts`) says the session stands in `site`. */
  says(site: string): boolean { return [...this.items].some(([key, value]) => key.includes('standalonesite') && value.includes(JSON.stringify(site))); }
}
let rapier: Rapier | undefined;
const products = new Map<string, Promise<HeadlessRuntimeInput>>();
function product(slug: string): Promise<HeadlessRuntimeInput> {
  const held = products.get(slug);
  if (held !== undefined) return held;
  const loading = (async () => {
    rapier ??= await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    const directory = builtProduct(slug), loaded = await loadHeadlessProduct(directory);
    return { shard: loaded.shardfile, assets: runtimeAssets(loaded, directory), rapier, product: loaded };
  })();
  products.set(slug, loading);
  return loading;
}
interface Page { readonly shell: StandaloneShell; readonly grid: () => StandaloneGrid; readonly travels: NetTravel[]; readonly crash: () => void }
/** A page and its worker on `storage`. `crash` ends both with nothing said, as a killed tab does. */
async function page(storage: PageStorage, arrival?: typeof ARRIVAL): Promise<Page> {
  const strips = await bakedGridCollision(), control = new MessageChannel(), game = new MessageChannel();
  let running: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => product(slug), strips: () => Promise.resolve(strips),
    onSaveRefused: error => { throw error; }, proof: { ...(arrival === undefined ? {} : { arrival }), booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug: SLUG, base: `/shards/${SLUG}/`, build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); });
  let gone = false;
  const crash = (): void => { if (!gone) { gone = true; shell.dispose(); } };
  onTestFinished(crash);
  const travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  return { shell, travels, crash, grid: () => { if (running === undefined) throw new Error('No booted server'); return running; } };
}
const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
const walkWest = (shell: StandaloneShell): void => {
  shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: 0 }); shell.client.flush();
};
/** Walk the tape west until `done`, by a wall-clock deadline: a cell's world loads on its own time, and the player waits at its wall. */
async function walk(first: Page, done: () => boolean): Promise<void> {
  const grid = first.grid(), deadline = Date.now() + 30_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('The walk never got there');
    walkWest(first.shell); await turn(); grid.tick(); await turn();
  }
}
const standing = (grid: StandaloneGrid): { readonly site: string | null; readonly x: number; readonly y: number; readonly z: number } => {
  const player = grid.host.players.get(PLAYER);
  if (player === undefined) throw new Error('No session player');
  return { site: grid.grid.current(), x: player.position.x, y: player.position.y, z: player.position.z };
};
/** The page's own tape owns the clock, so no progress save runs: the last save is the one the test asked for. */
async function taped(storage: PageStorage): Promise<Page> {
  const first = await page(storage, ARRIVAL);
  await first.shell.booted;
  first.shell.ready(); first.shell.pause(); await turn(); await turn();
  for (let tick = 0; tick < 32 && first.shell.client.latest === null; tick++) { first.grid().tick(); await turn(); }
  expect(first.shell.client.latest).not.toBeNull();
  return first;
}
/** Walk a little way down the road and save there: the place every crash before the crossing's own save comes back to. */
async function savedOnRoad(first: Page): Promise<ReturnType<typeof standing>> {
  const grid = first.grid();
  for (let tick = 0; tick < 20; tick++) { walkWest(first.shell); await turn(); grid.tick(); await turn(); }
  expect(await first.shell.save()).toMatchObject({ ok: true });
  const saved = standing(grid);
  expect(saved.site).toBeNull();
  return saved;
}
/** Boot a fresh page on what the dead one left, and say where it stands. */
async function reboot(storage: PageStorage): Promise<ReturnType<typeof standing>> {
  const next = await page(storage);
  expect(await next.shell.booted).toMatchObject({ restored: true });
  return standing(next.grid());
}

test('a page killed while its crossing waits on the cell comes back on the road where it last saved', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = await taped(storage), grid = first.grid(), saved = await savedOnRoad(first);
  // Within 6 m of the seam the crossing is asked for; until the cell's world is in, the player stands on the road.
  await walk(first, () => grid.grid.target(grid.grid.worldFeet()) !== null);
  expect(first.travels).toHaveLength(0);
  const pending = standing(grid);
  expect(pending.site).toBeNull();
  expect(Math.abs(pending.x - saved.x)).toBeGreaterThan(1);
  first.crash();
  const back = await reboot(storage);
  expect(back.site).toBeNull();
  expect(back.x).toBeCloseTo(saved.x, 1); expect(back.z).toBeCloseTo(saved.z, 1);
});

test('a page killed half way through the crossing\'s own save comes back on the road where it last saved', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = await taped(storage), saved = await savedOnRoad(first);
  await walk(first, () => first.travels.length > 0);
  expect(standing(first.grid()).site).not.toBeNull();
  // The crossing is progress (TE-ENG8): with the page's clock running again the server saves it, the cell's document
  // first and then the site that names it. The tab dies between the two.
  const site = standing(first.grid()).site ?? '';
  const held = new Set(storage.items.keys());
  storage.dieAfter(1);
  first.shell.resume();
  await expect.poll(() => storage.dead, { timeout: 10_000, interval: 5 }).toBe(true);
  first.crash();
  // The cell's own document (its shard's save) landed; the site that would name it never did.
  expect([...storage.items.keys()].filter(key => !held.has(key))).toEqual([`wildshard.${site}`]);
  expect(storage.says(site)).toBe(false);
  const back = await reboot(storage);
  expect(back.site).toBeNull();
  expect(back.x).toBeCloseTo(saved.x, 1); expect(back.z).toBeCloseTo(saved.z, 1);
});

test('a page killed once its crossing saved comes back inside the cell it crossed into', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = await taped(storage), grid = first.grid();
  await walk(first, () => first.travels.length > 0);
  const { site } = standing(grid);
  if (site === null) throw new Error('The crossing landed on the road');
  expect(storage.says(site)).toBe(false);
  first.shell.resume();
  await expect.poll(() => storage.says(site), { timeout: 10_000, interval: 5 }).toBe(true);
  first.shell.pause(); await turn();
  const last = standing(grid);
  first.crash();
  const back = await reboot(storage);
  expect(back.site).toBe(site);
  expect(Math.hypot(back.x - last.x, back.z - last.z)).toBeLessThan(2);
});
