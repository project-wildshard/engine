// SHARD-SOURCE S12f2b2: a phone drawing the phone set reads the cook's own 6×6 file for a splat layer the discovery table
// names (`<blob URL>#layer`), and its selection never admits the blob; a device drawing the desktop set, or a product cooked
// before (no row), reads the blob as it did.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SplatTerrain } from '@wildshard/format/splatTerrain';
import { cookedSplatBytes, readSplatLayer } from '../src/client/game/shardfile/splatLayerRead';
import { splatLayerFiles, splatLayerKey } from '../src/shared/engine/boot/splatLayerRows';

const hash = (c: string): string => c.repeat(64);
const set = (a: string, b: string) => ({ colour: [a, b, a, b].map(hash), normal: [a, b, a, b].map(hash), arm: [a, b, a, b].map(hash) }) as SplatTerrain['layers'];
const tint: [number, number, number] = [1, 1, 1];
// Pine after S12f2b3: the phone set's colour and normal are the desktop layers' own files, its ARM its own
const splat = { material: 'ground', layers: set('a', 'b'), phone: { ...set('a', 'b'), arm: set('c', 'd').arm }, tints: [tint, tint, tint, tint], boreal: null } as SplatTerrain;
const cookedUrl = `/assets/pine-hollow/splat/${hash('a')}.t16384-0123abcd.ktx2`;
const rows = splatLayerFiles({ [splatLayerKey(`/shardfiles/pine-hollow/blobs/ktx2/${hash('a')}.ktx2`)]: cookedUrl });
const drawn = new Set([hash('a'), hash('b'), hash('c'), hash('d')]);

const realFetch = globalThis.fetch, same = (url: string): string => url;
afterEach(() => { globalThis.fetch = realFetch; });

describe('S12f2b2: the phone\'s splat ground reads the cooked layer', () => {
  test('a phone with the row reads the cooked file in the blob\'s place, and only that one', async () => {
    const read = vi.fn(async (url: string) => new TextEncoder().encode(url));
    const bytes = await cookedSplatBytes(splat, drawn, 'phone', ref => rows.get(ref), read);
    expect(read.mock.calls).toEqual([[cookedUrl]]);
    expect([...bytes.keys()]).toEqual([hash('a')]);
  });
  test('without a row, or drawing the desktop set, nothing is read by URL: the blob is', async () => {
    const read = vi.fn(async () => new Uint8Array());
    expect((await cookedSplatBytes(splat, drawn, 'phone', () => undefined, read)).size).toBe(0);
    expect((await cookedSplatBytes(splat, drawn, 'desktop', ref => rows.get(ref), read)).size).toBe(0);
    expect((await cookedSplatBytes({ ...splat, phone: undefined } as unknown as SplatTerrain, drawn, 'phone', ref => rows.get(ref), read)).size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
  test('the cooked file is checked against its name', async () => {
    const body = new Uint8Array([1, 2, 3]), digest = createHash('sha256').update(body).digest('hex').slice(0, 8);
    const fetch = vi.fn(async () => new Response(body));
    globalThis.fetch = fetch;
    await expect(readSplatLayer(`/assets/x/splat/${hash('a')}.t16384-${digest}.ktx2`, same)).resolves.toEqual(body);
    await expect(readSplatLayer(`/assets/x/splat/${hash('a')}.t16384-00000000.ktx2`, same)).rejects.toThrow(/differs from its name/u);
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(readSplatLayer(`/assets/x/splat/${hash('a')}.t16384-${digest}.ktx2`, same)).rejects.toThrow(/answered 404/u);
  });
});
