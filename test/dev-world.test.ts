// MEMORY-STRUCTURE STR2 (J414): the dev page port stamps every document with its world, and its key outlives a restart.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { devKey, devServerBuildArgs, DEV_STATE, stampDevDocument } from '../src/scripts/dev-world.mjs';
import { devControlUrl, devControls } from '../src/client/host/online/devControl';
import { devRoute } from '../src/server/host/dedicated/devControl';
import { isDevGround } from '../src/shared/game/devColliders';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('a dev document carries the world first and the rebuild poll last', () => {
  const html = stampDevDocument('<!doctype html><html><head><meta charset="utf-8"><script>boot()</script></head><body><p>x</p></body></html>', { release: 'http://127.0.0.1:4402/__dev/release.json', key: 'ab</script>' }, 3);
  expect(html.indexOf('globalThis.__WS_WORLD__=')).toBeLessThan(html.indexOf('boot()'));
  expect(html).not.toContain('ab</script>');
  expect(html.indexOf(DEV_STATE)).toBeGreaterThan(html.indexOf('<p>x</p>'));
  expect(html).toContain('const seen=3;');
  expect(stampDevDocument('no head here', { release: 'r', key: 'k' }, 1)).toBe('no head here');
});

test('the dev key is made once and kept', () => {
  const work = mkdtempSync(join(process.cwd(), 'tmp', 'dev-key-'));
  made.push(work);
  const first = devKey(work);
  expect(first.public).toMatch(/^[0-9a-f]+$/u);
  expect(devKey(work)).toEqual(first);
});

// meta QA 11-24 row 45: a world on a build that placed a shard off the in-tree grid sent that shard as frame 1, the page's first
// grid cell, and the page left for Pine Hollow; the server now bakes the build's own catalogue
test('the dev server bakes its client build\'s catalogue', () => {
  const built = mkdtempSync(join(process.cwd(), 'tmp', 'dev-built-'));
  made.push(built);
  expect(devServerBuildArgs({ id: 'b1', out: 'srv', built, dev: true })).toEqual(['--build', 'b1', '--out', 'srv', '--dev']);
  writeFileSync(join(built, 'catalogue.json'), '{}');
  expect(devServerBuildArgs({ id: 'b1', out: 'srv', built, dev: false })).toEqual(['--build', 'b1', '--out', 'srv', '--catalogue', join(built, 'catalogue.json')]);
});

test('a watch heightfield crosses the real dev HTTP route', async () => {
  const accepted: unknown[] = [];
  let wake: () => void = () => {};
  const arrived = new Promise<void>(resolve => { wake = resolve; });
  const server = createServer((request, response) => {
    devRoute(request, response, (device, message) => {
      const ok = device === 'author' && isDevGround(message);
      if (ok) { accepted.push(message); wake(); }
      return Promise.resolve({ ok });
    }, [], () => []);
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Dev route has no port');
    const socket = `ws://127.0.0.1:${address.port}/`;
    const ground = { resolution: 2, x: 0, z: 0, size: 5, heights: new Float32Array([0, 0.25, 2, -0.5]) };
    devControls(() => socket, 'author').devGround(ground);
    await arrived;
    expect(accepted).toEqual([{ wildshardDevGround: ground }]);
    const refused = await fetch(devControlUrl(socket), {
      method: 'POST', body: JSON.stringify({ device: 'author', wildshardDevGround: { ...ground, heights: [0, 1, 2] } }),
    });
    expect(refused.status).toBe(409);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  }
});
