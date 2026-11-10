// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../../src/shared/engine/saves/store';
import { GridAssembly, type GridPoint } from '../../src/shared/game/grid/assembly';
import { outputDescriptor, serverReadsFile } from '../../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../../src/client/host/standalone/shell';
import { builtProduct } from './builtProduct';
import { bakedGridCollision } from './gridCollision';

// P1-E3.9, E5.2b: the grid in the server's half, over real MessagePorts on the server's own clock. Shared by
// standalone-grid.test.ts and standalone-grid-lone.test.ts (split by case, VITEST-BENCH VB5). Only a server's bytes are read.

export class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

async function serverInput(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
export const assembly = new GridAssembly({ developer: false, devserver: false });
export const HOME = 'sunscar-dunes', NEIGHBOUR = 'driftwood-isle';
export const cell = (slug: string): number => assembly.cells.findIndex(row => row.slug === slug) + 1;
export const until = async (ready: () => boolean, timeout = 30_000): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout, interval: 5 }); };

let current: StandaloneGrid | undefined;
/** The grid the last `start` booted. */
export const running = (): StandaloneGrid | undefined => current;
export function start(storage: SaveStorage, arrival?: GridPoint, home = HOME, lone?: true): { shell: StandaloneShell; stop: () => void } {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => serverInput(slug), strips: bakedGridCollision, proof: { ...(arrival === undefined ? {} : { arrival }), booted: grid => { current = grid; } } });
  const shell = connectStandalone({ slug: home, base: `/shards/${home}/`, build: 'test', savePrefix: 'wildshard.', storage, ...(lone === undefined ? {} : { lone }) }, control.port2, game.port2, () => { server.dispose(); });
  return { shell, stop: () => { shell.dispose(); } };
}
/** Keep walking on a heading until `done`. Yaw π/2 is -x. */
export async function walk(shell: StandaloneShell, yaw: number, done: () => boolean): Promise<void> {
  const timer = setInterval(() => { shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 }); shell.client.flush(); }, 16);
  try { await until(done); } finally { clearInterval(timer); }
}
export const ownerX = (shell: StandaloneShell): number => { const { client } = shell, frame = client.latest; return frame === null ? Number.NaN : Number(client.owner(frame)['px']); };
