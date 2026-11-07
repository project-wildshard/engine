import { expect, test } from 'vitest';
import { gridPrefetchOrder, readGridPrefetch } from './prefetch';

test('G554: the whole set is read nearest cell first, each product once', () => {
  const cell = (slug: string, x: number, z: number) => ({ instance: `${slug}@${x},${z}`, slug, cell: [x, z] as const, origin: { x: x * 555, y: 0, z: z * 555 } });
  const cells = [cell('far', 2, 2), cell('plot', 1, 0), cell('home', 0, 0), cell('plot', -1, 0), cell('next', 0, 1)];
  expect(gridPrefetchOrder({ cells }, { x: 10, z: -5 })).toEqual(['home', 'plot', 'next', 'far']);
});

test('I9: the phone tier prefetches only the home cell and its ring', () => {
  const cell = (slug: string, x: number, z: number) => ({ instance: `${slug}@${x},${z}`, slug, cell: [x, z] as const, origin: { x: x * 555, y: 0, z: z * 555 } });
  const cells = [cell('far', 3, 0), cell('corner', 2, 2), cell('east', 2, 1), cell('home', 1, 1), cell('west', 0, 0)];
  expect(gridPrefetchOrder({ cells }, { x: 600, z: 555 }, 'phone')).toEqual(['home', 'east', 'corner', 'west']);
  expect(gridPrefetchOrder({ cells }, { x: 600, z: 555 }, 'desktop')).toEqual(['home', 'east', 'corner', 'west', 'far']);
});

test('prefetch persistence bypasses HTTP cache and preserves exact response bytes', async () => {
  const requests: (RequestInit | undefined)[] = [];
  const fetcher: typeof fetch = (_url, init) => {
    requests.push(init); return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  };
  expect(await readGridPrefetch('http://localhost/file', 3, fetcher)).toEqual(new Uint8Array([1, 2, 3]));
  expect(requests).toEqual([{ cache: 'no-store' }]);
});

test('cancels a body over its declared size without buffering the entire response', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull: controller => { controller.enqueue(new Uint8Array([1, 2, 3])); },
    cancel: () => { cancelled = true; } });
  const fetcher: typeof fetch = () => Promise.resolve(new Response(body));
  await expect(readGridPrefetch('http://localhost/file', 2, fetcher)).rejects.toThrow('declared size');
  expect(cancelled).toBe(true);
  await expect(readGridPrefetch('http://localhost/file', -1, fetcher)).rejects.toThrow('body size');
});
