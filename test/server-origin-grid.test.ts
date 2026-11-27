// GC15 (GRID-CROSSING): the rig's origin (`src/scripts/server-origin.mjs`) carries the build's grid pack, so a local world with
// `WORLD_CROSSING=worker` builds its road's strips the way staging's release origin does. Without it the road has no ground.
// oxlint-disable-next-line import/no-nodejs-modules -- The origin is written by its own Node process, as the rig runs it.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- A throwaway origin on disk.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A throwaway origin on disk.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, vi } from 'vitest';
import { writeGridCollision } from '../src/cook/game/gridCollision';
import { readPackGrid } from '../src/server/host/dedicated/packReader';
import { COOKED_ORIGIN } from '../src/shared/game/shardfile/cookedPackPaths';
import { serverPackBookPath } from '../src/shared/game/shardfile/serverPack';

const ROOT = resolve(import.meta.dirname, '..');

test('the rig origin holds the grid pack the bake left, and a dedicated room reads its strips back', async () => {
  const work = mkdtempSync(join(ROOT, 'tmp', 'server-origin-grid-'));
  try {
    const baked = join(work, 'baked'), origin = join(work, 'origin'), positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices = new Uint32Array([0, 1, 2]);
    writeGridCollision(baked, 'test', [{ id: 'strip-a', mesh: { origin: { x: 281.25, z: 0 }, positions, indices, colours: new Float32Array(9) }, duplicates: [], features: [] }]);
    const made = spawnSync(process.execPath, ['src/scripts/server-origin.mjs', origin, 'gc15c', `--grid=${baked}`], { cwd: ROOT, encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const strips = await readPackGrid('gc15c', { origin: pathToFileURL(`${origin}/`).href, cache: join(work, 'cache') }, { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 });
    expect(strips.map(strip => [strip.id, strip.mesh.origin.x, [...strip.mesh.indices]])).toEqual([['strip-a', 281.25, [0, 1, 2]]]);
  } finally { rmSync(work, { recursive: true, force: true }); }
}, 60_000);

test('a versioned room reads the build road from the cooked origin', async () => {
  const work = mkdtempSync(join(ROOT, 'tmp', 'server-origin-grid-'));
  const build = 'c'.repeat(40), paths: string[] = [];
  try {
    const baked = join(work, 'baked'), origin = join(work, 'origin');
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices = new Uint32Array([0, 1, 2]);
    writeGridCollision(baked, 'test', [{ id: 'strip-b', mesh: { origin: { x: 0, z: 281.25 }, positions, indices, colours: new Float32Array(9) }, duplicates: [], features: [] }]);
    const made = spawnSync(process.execPath, ['src/scripts/server-origin.mjs', origin, build, `--grid=${baked}`], { cwd: ROOT, encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    vi.stubGlobal('fetch', (url: URL) => {
      expect(url.origin).toBe(new URL(COOKED_ORIGIN).origin);
      paths.push(url.pathname);
      return Promise.resolve(new Response(readFileSync(join(origin, url.pathname))));
    });
    const options = { origin: 'https://packs.wildshard.io', cache: join(work, 'cache') };
    const reads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 };
    const strips = await readPackGrid(build, options, reads, true);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(`/${serverPackBookPath(build)}`);
    expect(paths[1]).toMatch(/^\/assets\/spawn\/server\/[^/]+\.pack\.br$/u);
    expect(strips.map(strip => [strip.id, strip.mesh.origin.z])).toEqual([['strip-b', 281.25]]);
    expect(reads).toMatchObject({fetched:1,refused:0});
  } finally { vi.unstubAllGlobals(); rmSync(work, { recursive: true, force: true }); }
}, 60_000);
