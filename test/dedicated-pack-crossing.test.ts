// oxlint-disable-next-line import/no-nodejs-modules -- The grid bake and the origin are written by their own Node processes, as the rig runs them.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A throwaway origin on disk, laid out as a release's.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A throwaway origin on disk, laid out as a release's.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';
import type { GridCollisionStrip } from '../src/shared/game/grid/gridCollision';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { readPackFolder, readPackGrid, type PackReaderOptions, type PackReads } from '../src/server/host/dedicated/packReader';
import { builtFolder } from '../src/test/game/builtFolder';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// SHARD-COMPAT C2 (J28, J91): the worker runs its shards and a road crossing from server packs alone. The origin is a release's, written
// by the cook's own writers (`src/scripts/server-origin.mjs`: each shard's server pack and the catalogue's grid pack, from the bake's strips).
// Every room reads its shard through the pack reader and the road reads its strips from the grid pack, so no built product, `public/` or
// in-tree grid file is read while the world runs. Staging's 2-worker table, as GC15 (3): a walker leaves Driftwood on its road, is held
// at Nalati's gate (ZONE-ENTRY ZE6), and walks back.
const HOME = 'driftwood-isle', EAST = 'nalati-grasslands', CELLS = [HOME, 'far-reach', 'sunscar-dunes', EAST], BUILD = 'c2';
const EAST_EDGE = 562.5 - CHUNK_HALF, EAST_GATE = EAST_EDGE + BUFFER_DEPTH, ROOT = resolve(import.meta.dirname, '..');
let work = '', options: PackReaderOptions | undefined, bench: RoomBench | undefined;
const bots: RoomBot[] = [];
const fresh = (): PackReads => ({ fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 });
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
beforeAll(() => {
  work = mkdtempSync(join(ROOT, 'tmp', 'c2-packs-'));
  const grid = join(work, 'grid'), origin = join(work, 'origin');
  const baked = spawnSync(process.execPath, ['--import', './src/scripts/bake-loader.mjs', 'src/scripts/bake-grid-seams.mjs', grid, '--collision-only'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  expect(baked.status, baked.stderr).toBe(0);
  const made = spawnSync(process.execPath, ['src/scripts/server-origin.mjs', origin, BUILD, ...CELLS.map(slug => `${slug}=${builtFolder(slug)}`), `--grid=${grid}`, '--fast-encode'], { cwd: ROOT, encoding: 'utf8' });
  expect(made.status, made.stderr).toBe(0);
  expect(JSON.parse(made.stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({ shards: CELLS, grid: true });
  // q1 parts (`--fast-encode`): the readers decode any Brotli, and a CI test job has no q11 encode cache (123.9 s hosted, run 45129449633).
  // The built products and the bake's folder go before the world opens: only the origin is left to read.
  rmSync(grid, { recursive: true, force: true });
  options = { origin: pathToFileURL(`${origin}/`).href, cache: join(work, 'cache') };
}, 300_000);
afterAll(() => { if (work !== '') rmSync(work, { recursive: true, force: true }); });

test('C2: a world whose rooms and road read only server packs holds a walker at Nalati\'s gate and walks him back, on one socket', { timeout: 240_000 }, async () => {
  if (options === undefined) throw new Error('The origin is written');
  const origin = options, rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), reads = fresh(), loaded: string[] = [];
  let strips: readonly GridCollisionStrip[] = [];
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true,
    strips: async () => (strips = await readPackGrid(BUILD, origin, reads)),
    load: async slug => { const input = await readPackFolder(slug, BUILD, rapier, origin, reads); loaded.push(slug); return input; } });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), east = bench.room(EAST), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || east === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Nalati and Driftwood\'s road boot');
  expect(new Set(loaded), 'every room opened from its pack').toEqual(new Set(CELLS));
  expect(strips.length, 'the road\'s strips came from the grid pack').toBeGreaterThan(0);
  expect(reads.fetched + reads.cached, 'parts read by their hash').toBeGreaterThan(0);
  expect(reads.refused).toBe(0);
  let closes = 0;
  a.transport.onClose(() => { closes++; });
  body.resetPose({ x: CHUNK_HALF - 5, y: 1, z: 0 }, -Math.PI / 2);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 50 });
  // The open road between the two cells is plain strip ground: the walker is set down 15 m short of Nalati's edge on it, so the
  // file walks only what it proves (the gate held on the pack's strips, both hand-offs) and fits its 60 s CI file budget (J193).
  const walker = road.bodyOf('device:a');
  if (walker === undefined) throw new Error('A stands on the road');
  walker.resetPose({ x: EAST_EDGE - 15, y: walker.position.y + 2, z: 0 }, -Math.PI / 2);
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.x ?? 0, 'into Nalati\'s buffer, on the pack\'s strips').toBeGreaterThan(EAST_EDGE + 2); }, { timeout: 30_000, interval: 50 });
  let deepest = -Infinity;
  for (const ends = Date.now() + 3000; Date.now() < ends;) { await new Promise(resolve => { setTimeout(resolve, 50); }); deepest = Math.max(deepest, road.bodyOf('device:a')?.position.x ?? -Infinity); }
  expect(deepest, 'held at Nalati\'s gate').toBeLessThan(EAST_GATE);
  expect(east.holds('device:a'), 'never handed into Nalati').toBe(false);
  a.thumb = () => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: Math.PI / 2, pitch: 0, buttons: NET_BUTTONS.sprint });
  // Back along the road to 15 m off Driftwood's edge, then walked home across it.
  const held = road.bodyOf('device:a');
  if (held === undefined) throw new Error('A is still on the road');
  held.resetPose({ x: CHUNK_HALF + 15, y: held.position.y + 2, z: 0 }, Math.PI / 2);
  await vi.waitFor(() => { expect(home.holds('device:a'), 'back in Driftwood').toBe(true); }, { timeout: 40_000, interval: 50 });
  expect(closes, 'never redialled').toBe(0);
  expect([bench.restarts, bench.crashes]).toEqual([0, []]);
});
