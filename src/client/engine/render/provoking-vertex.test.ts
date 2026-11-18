import { expect, test } from 'vitest';
import { BufferAttribute, DynamicDrawUsage } from 'three';
import { rotateTriangles, webKitEngine } from './drawHooks';

test('each triangle turns once so its last vertex leads, keeping the triangle and its winding', () => {
  const index = new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);
  const version = index.version;
  expect(rotateTriangles(index)).toBe(true);
  expect([...index.array]).toEqual([2, 0, 1, 3, 2, 1]);
  expect(index.version).toBe(version + 1); // an uploaded index goes up again
  expect(rotateTriangles(index)).toBe(true); // asked again: already turned, unchanged
  expect([...index.array]).toEqual([2, 0, 1, 3, 2, 1]);
});

test('one array behind two attributes turns once', () => {
  const array = new Uint32Array([4, 5, 6]);
  expect(rotateTriangles(new BufferAttribute(array, 1))).toBe(true);
  expect(rotateTriangles(new BufferAttribute(array, 1))).toBe(true);
  expect([...array]).toEqual([6, 4, 5]);
});

test('an index the rotation cannot cover draws in GL convention', () => {
  const dynamic = new BufferAttribute(new Uint16Array([0, 1, 2]), 1).setUsage(DynamicDrawUsage);
  expect(rotateTriangles(dynamic)).toBe(false);
  expect([...dynamic.array]).toEqual([0, 1, 2]);
  expect(rotateTriangles(new BufferAttribute(new Uint16Array([0, 1, 2, 3]), 1))).toBe(false);
  const rewritten = new BufferAttribute(new Uint16Array([0, 1, 2]), 1);
  expect(rotateTriangles(rewritten)).toBe(true);
  rewritten.needsUpdate = true; // its owner wrote it again after the rotation
  expect(rotateTriangles(rewritten)).toBe(false);
});

test('only WebKit draws in the first-vertex convention (Blink stalls the load when the extension is on)', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
  const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1';
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  const edge = `${chrome} Edg/142.0.0.0`, headless = chrome.replace('Chrome/', 'HeadlessChrome/');
  const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0';
  expect([safari, iosChrome, chrome, edge, headless, firefox].map(webKitEngine)).toEqual([true, true, false, false, false, false]);
});
