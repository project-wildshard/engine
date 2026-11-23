import { Scope } from '../../../src/shared/engine/app/scope';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../../../src/shared/game/shardfile/serverSkinRigs';
import { runCells } from '../../../src/server/host/dedicated/cellHost';
import { loopLag } from '../../../src/server/host/dedicated/loopLag';
import type { WorkerNews } from '../../../src/server/host/dedicated/cellProtocol';
import type { DedicatedRoom } from '../../../src/server/host/dedicated/dedicatedRoom';
import type { RoadRoom } from '../../../src/server/host/dedicated/roadRoom';
import { bakedGridCollision } from '../gridCollision';
import type { GridCollisionStrip } from '../../../src/shared/game/grid/gridCollision';
import { memoryPlayerSaves } from '../../../src/server/host/dedicated/playerSaves';
import { World, type WorkerLink, type WorldOptions } from '../../../src/server/host/dedicated/world';
import { declaredCells } from '../../../src/server/host/dedicated/workerTable';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';
import type { HeadlessRuntimeInput } from '../../../src/server/host/headlessRuntime';
import { builtFolder } from '../../../src/test/game/builtFolder';

export async function serverInput(slug: string): Promise<HeadlessRuntimeInput> {
  return folderInput(builtFolder(slug));
}
/** A room's input from a product folder: a built one (`serverInput`) or a frozen slice such as the gameplay slice. */
export async function folderInput(directory: string): Promise<HeadlessRuntimeInput> {
  const product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${directory} output`);
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
/** The real door on a real localhost port, with its workers on this thread over real ports, the same code a worker runs. */
export interface RoomBench { readonly url: string; readonly world: World; /** The door's HTTP server: a test may answer requests on it, as `/health` does. */ readonly server: Server; readonly room: (slug: string) => DedicatedRoom | undefined; /** GC15: each worker's road, by its name (`roadName`), with `crossing`. */ readonly road: (name: string) => RoadRoom | undefined; readonly lines: Record<string, unknown>[]; readonly crashes: unknown[]; restarts: number; close: () => Promise<void> }
 export async function roomBench(options: Partial<WorldOptions> & { readonly holdMs?: number; readonly emptyMs?: number; readonly newsDelayMs?: number; readonly roomNow?: () => number; /** SC1: each worker's reading period instead of 10 s. */ readonly readingMs?: number; /** J353: an always-on road, on the baked grid's strips. */ readonly crossing?: boolean; /** GC28: the strips the road reads instead (a book with no grid pack reads none). */ readonly strips?: () => Promise<readonly GridCollisionStrip[]>; /** SA47: how a room reads its shard, as a worker's pack reader does; built products by default. */ readonly load?: (slug: string) => Promise<HeadlessRuntimeInput>; /** QA 11-15 row 8: `WORLD_BOOST=off` when false. */ readonly developerBoost?: boolean } = {}): Promise<RoomBench> {
  const { holdMs, emptyMs, newsDelayMs = 0, roomNow, readingMs, crossing, strips, load = serverInput, developerBoost, ...door } = options, roads = new Map<string, RoadRoom>(), delivery = new Scope('room bench IPC'), rooms = new Map<string, DedicatedRoom>(), lines: Record<string, unknown>[] = [], crashes: unknown[] = [], stops: (() => void)[] = [], bench: { restarts: number } = { restarts: 0 };
  const boot = (slugs: readonly string[]): WorkerLink => {
    const { port1, port2 } = new MessageChannel();
    const held = runCells(port2 as never, { slugs, build: 'bench', ...(developerBoost === undefined ? {} : { developerBoost }), bootId: () => 'bench', load, memory: () => process.memoryUsage(), lag: loopLag(), booted: (slug, room) => { rooms.set(slug, room); }, roaded: road => { roads.set(road.name, road); }, ...(crossing === true ? { road: strips ?? bakedGridCollision } : {}), ...(holdMs === undefined ? {} : { holdMs }), ...(emptyMs === undefined ? {} : { emptyMs }), ...(roomNow === undefined ? {} : { roomNow }), ...(readingMs === undefined ? {} : { readingMs }),...(door.playtest===undefined?{}:{playtest:true}), ...(door.sessions === undefined ? {} : { metricEvents: true }) });
    const stop = (): void => { held.dispose(); port1.close(); };
    stops.push(stop);
    return { send: (order, transfer = []) => { port1.postMessage(order, transfer as Transferable[]); },
      listen: (news, _ended) => { port1.onmessage = (event: MessageEvent<WorkerNews>): void => { if (newsDelayMs === 0) news(event.data); else delivery.timeout(newsDelayMs, () => { news(event.data); }); }; }, stop };
  };
  // ONE-FORMAT OF31h4: as the box does (main.ts), each cell's own pinned shard header declares its awake cost and shared worker
  const declared = await declaredCells(options.cells ?? ['driftwood-isle'], cell => Promise.resolve().then(() => JSON.parse(readFileSync(`out/${cell}/shard.json`, 'utf8')) as unknown));
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle'], declared, workers: 4, seats: 32, secret: 'bench', boot, saves: memoryPlayerSaves(), log: line => { lines.push(line); }, crashed: error => { crashes.push(error); }, restart: () => { bench.restarts++; }, ...(crossing === true ? { roads: true } : {}), ...door });
  const server: Server = createServer();
  server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address() as AddressInfo;
  return { world, server, room: slug => rooms.get(slug), road: name => roads.get(name), lines, crashes, get restarts() { return bench.restarts; }, url: `ws://127.0.0.1:${String(port)}/`,
    close: async () => { world.dispose(); delivery.dispose(); for (const stop of stops) stop(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); } };
}
