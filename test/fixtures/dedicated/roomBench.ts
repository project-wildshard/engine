import { Scope } from '../../../src/shared/engine/app/scope';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../../../src/shared/game/shardfile/outputDescriptor';
import { runCells } from '../../../src/server/host/dedicated/cellHost';
import type { WorkerNews } from '../../../src/server/host/dedicated/cellProtocol';
import type { DedicatedRoom } from '../../../src/server/host/dedicated/dedicatedRoom';
import { memoryPlayerSaves } from '../../../src/server/host/dedicated/playerSaves';
import { World, type WorkerLink, type WorldOptions } from '../../../src/server/host/dedicated/world';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../../../src/server/host/headlessRuntime';
import { builtProduct } from '../builtProduct';

export async function serverInput(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
/** The real door on a real localhost port, with its workers on this thread over real ports, the same code a worker runs. */
export interface RoomBench { readonly url: string; readonly world: World; readonly room: (slug: string) => DedicatedRoom | undefined; readonly lines: Record<string, unknown>[]; readonly crashes: unknown[]; restarts: number; close: () => Promise<void> }
export async function roomBench(options: Partial<WorldOptions> & { readonly holdMs?: number; readonly emptyMs?: number; readonly newsDelayMs?: number } = {}): Promise<RoomBench> {
  const { holdMs, emptyMs, newsDelayMs = 0, ...door } = options, delivery = new Scope('room bench IPC'), rooms = new Map<string, DedicatedRoom>(), lines: Record<string, unknown>[] = [], crashes: unknown[] = [], stops: (() => void)[] = [], bench: { restarts: number } = { restarts: 0 };
  const boot = (slugs: readonly string[]): WorkerLink => {
    const { port1, port2 } = new MessageChannel();
    const held = runCells(port2 as never, { slugs, build: 'bench', bootId: () => 'bench', load: serverInput, memory: () => process.memoryUsage(), booted: (slug, room) => { rooms.set(slug, room); }, ...(holdMs === undefined ? {} : { holdMs }), ...(emptyMs === undefined ? {} : { emptyMs }),...(door.playtest===undefined?{}:{playtest:true}) });
    const stop = (): void => { held.dispose(); port1.close(); };
    stops.push(stop);
    return { send: (order, transfer = []) => { port1.postMessage(order, transfer as Transferable[]); },
      listen: (news, _ended) => { port1.onmessage = (event: MessageEvent<WorkerNews>): void => { if (newsDelayMs === 0) news(event.data); else delivery.timeout(newsDelayMs, () => { news(event.data); }); }; }, stop };
  };
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle'], workers: 4, seats: 32, secret: 'bench', boot, saves: memoryPlayerSaves(), log: line => { lines.push(line); }, crashed: error => { crashes.push(error); }, restart: () => { bench.restarts++; }, ...door });
  const server: Server = createServer();
  server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as AddressInfo;
  return { world, room: slug => rooms.get(slug), lines, crashes, get restarts() { return bench.restarts; }, url: `ws://127.0.0.1:${String(port)}/`,
    close: async () => { world.dispose(); delivery.dispose(); for (const stop of stops) stop(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); } };
}
