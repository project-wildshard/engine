// MEMORY-STRUCTURE STR2 (J414): the dev page port stamps every document with its world, and its key outlives a restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { devKey, DEV_STATE, stampDevDocument } from '../scripts/dev-world.mjs';

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
