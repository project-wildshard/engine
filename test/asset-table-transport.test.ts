import { expect, test, vi } from 'vitest';
import { assetTableAsset, assetTableBanks, selectedPackTables } from '../scripts/app-build/assetTables.mjs';
import { prepareAssetTables, prepareAssetPacks, readAssetTables } from '../src/client/app/assetTables';
import { installAssetTables, publicBytes } from '../src/shared/engine/boot/tables';
import { openTitleSettings } from '../src/client/app/titleSettings';

function fixture() {
  const data = { bytes: { '/assets/kept.bin': 42 }, versions: { '/assets/kept.bin': 'abc' }, music: { theme: { loop: 1 } }, sfx: {},
    packs: { legacy: { phone: { bytes: 42, files: [['/assets/kept.bin', 0, 42, 'application/octet-stream']], parts: [{ url: '/assets/packs/p.bin', bytes: 42, files: [['/assets/kept.bin', 0, 42, 'application/octet-stream']] }] } } } };
  const source = JSON.stringify(data); return { data, source, asset: assetTableAsset(source) };
}

function titleFixture(read: (url: string) => Promise<Response>) {
  const data = { ...fixture().data, packs: {} }, source = JSON.stringify(data), asset = assetTableAsset(source);
  const slot = Symbol.for('engine.asset-tables'), previous: unknown = Reflect.get(globalThis, slot);
  Reflect.deleteProperty(globalThis, slot);
  return { data, source, asset, inventory: async () => { installAssetTables(await readAssetTables(asset.address, read)); }, restore: () => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, slot); else Reflect.set(globalThis, slot, previous);
  } };
}

test('renderer-free title Settings awaits verified inventory and shard registration before strict readers run', async () => {
  let finishRead: (value: Response) => void = () => { throw new Error('missing table read'); };
  let finishRegistry: (value: Record<string, never>) => void = () => { throw new Error('missing registry'); };
  const response = new Promise<Response>(resolve => { finishRead = resolve; });
  const registry = new Promise<Record<string, never>>(resolve => { finishRegistry = resolve; });
  const read = vi.fn(() => response), f = titleFixture(read);
  try {
    expect(publicBytes).toThrow('No asset tables installed');
    const open = vi.fn(() => { expect(publicBytes()).toEqual(f.data.bytes); });
    const pending = openTitleSettings(open, { inventory: f.inventory, registry: () => registry });
    expect(read).toHaveBeenCalledExactlyOnceWith(f.asset.address.url); expect(open).not.toHaveBeenCalled();
    finishRead(new Response(f.source));
    await vi.waitFor(() => { expect(publicBytes()).toEqual(f.data.bytes); });
    expect(open).not.toHaveBeenCalled();
    finishRegistry({}); await pending;
    expect(open).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  } finally { f.restore(); }
});

test('renderer-free title Settings refuses corrupt inventory and can reopen after the exact read recovers', async () => {
  let wire = '';
  const read = vi.fn(() => Promise.resolve(new Response(wire))), f = titleFixture(read);
  wire = f.source.replace('kept', 'lost');
  try {
    const open = vi.fn(() => { expect(publicBytes()).toEqual(f.data.bytes); });
    const preparation = { inventory: f.inventory, registry: () => Promise.resolve() };
    await expect(openTitleSettings(open, preparation)).rejects.toThrow('Asset tables differ from the build');
    expect(open).not.toHaveBeenCalled(); expect(publicBytes).toThrow('No asset tables installed');
    wire = f.source; await openTitleSettings(open, preparation);
    expect(open).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  } finally { f.restore(); }
});

test('title Settings preserves registry refusal after verified inventory and opens only after registry recovery', async () => {
  let wire = '';
  const read = vi.fn(() => Promise.resolve(new Response(wire))), f = titleFixture(read);
  wire = f.source;
  try {
    const ready = f.inventory(), open = vi.fn(() => { expect(publicBytes()).toEqual(f.data.bytes); });
    await expect(openTitleSettings(open, { inventory: () => ready, registry: async () => {
      await ready; throw new Error('Registry unavailable');
    } })).rejects.toThrow('Registry unavailable');
    expect(open).not.toHaveBeenCalled(); expect(publicBytes()).toEqual(f.data.bytes);
    await openTitleSettings(open, { inventory: () => ready, registry: () => Promise.resolve() });
    expect(open).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  } finally { f.restore(); }
});
test('selected-entry transport retains every original table value and pack tuple', async () => {
  const f = fixture();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.source)));
  expect(f.asset.address.sha256).toBe(Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''));
  expect(await readAssetTables(f.asset.address, url => { expect(url).toBe(`/${f.asset.fileName}`); return Promise.resolve(new Response(f.source)); })).toEqual(f.data);
});
test('table transport refuses corruption, truncation and extra bytes before publication', async () => {
  const f = fixture();
  for (const source of [f.source.slice(1), `${f.source} `, f.source.replace('kept', 'lost')]) {
    await expect(readAssetTables(f.asset.address, () => Promise.resolve(new Response(source)))).rejects.toThrow();
  }
});
test('a dropped boot table retries its exact build address before publishing verified values', async () => {
  const f = fixture(), attempts: {url: string; cache: RequestCache | undefined}[] = [];
  const value = await readAssetTables(f.asset.address, (url, init) => {
    attempts.push({url, cache: init?.cache});
    return attempts.length === 1 ? Promise.reject(new TypeError('Synthetic table connection dropped')) : Promise.resolve(new Response(f.source));
  });
  expect(value).toEqual(f.data);
  expect(attempts).toEqual([{url: f.asset.address.url, cache: undefined}, {url: f.asset.address.url, cache: 'reload'}]);
});
test('HTML at the boot table address names the missing path instead of reaching JSON parsing', async () => {
  const f = fixture(), read = vi.fn(() => Promise.resolve(new Response('<html>missing</html>', {headers: {'content-type': 'text/html'}})));
  await expect(readAssetTables(f.asset.address, read)).rejects.toThrow(`Read failed: ${f.asset.address.url} · missing content (HTML response)`);
  expect(read).toHaveBeenCalledTimes(2);
});
test('matching bytes still require the table contract and a bounded build address', async () => {
  const asset = assetTableAsset(JSON.stringify({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: { bad: { phone: { bytes: -1 } } } }));
  await expect(readAssetTables(asset.address, () => Promise.resolve(new Response(asset.source)))).rejects.toThrow('Invalid asset tables');
  await expect(readAssetTables({ ...asset.address, bytes: 17 * 1024 * 1024 }, () => { throw new Error('must not fetch'); })).rejects.toThrow('Invalid asset table address');
});

test('concurrent entry callers await one complete read before synchronous tables change', async () => {
  const f = fixture(), slot = Symbol.for('engine.asset-tables'), previous: unknown = Reflect.get(globalThis, slot);
  const before = { bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} }; Reflect.set(globalThis, slot, before);
  let finish: (response: Response) => void = () => { throw new Error('read has not started'); };
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const shared = { ...f.data, packs: {} }, common = assetTableAsset(JSON.stringify(shared));
  const read = vi.fn(() => Promise.resolve(new Response(f.source))).mockImplementationOnce(() => response);
  const globals: readonly (readonly [string, unknown])[] = [['document', { querySelector: () => null }], ['fetch', read],
    ['__BOOT_TABLE_ASSETS__', { common: common.address, all: f.asset.address, packs: { legacy: f.asset.address } }]];
  const originals = new Map(globals.map(([name]) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of globals) Reflect.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    const first = prepareAssetTables(), second = prepareAssetTables();
    expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1);
    expect(Reflect.get(globalThis, slot)).toBe(before);
    finish(new Response(common.source)); await first;
    expect(Reflect.get(globalThis, slot)).toEqual(shared);
    await prepareAssetPacks('unpacked'); expect(read).toHaveBeenCalledTimes(1);
    await prepareAssetPacks('legacy'); await prepareAssetPacks('legacy'); expect(read).toHaveBeenCalledTimes(2);
    expect(Reflect.get(globalThis, slot)).toEqual(f.data);
  } finally {
    Reflect.set(globalThis, slot, previous);
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Reflect.defineProperty(globalThis, name, descriptor);
    }
  }
});

test('pack projection keeps shared facts exact and excludes another shard bank', () => {
  const f = fixture(), shared = { ...f.data, packs: {} }, other = { ...f.data, packs: { another: f.data.packs.legacy } };
  const banks = assetTableBanks(JSON.stringify({ common: JSON.stringify(shared), all: f.source,
    packs: { legacy: f.source, another: JSON.stringify(other) } }));
  expect(JSON.parse(banks.common.source)).toEqual(shared);
  expect(JSON.parse(banks.packs['legacy']?.source ?? '')).toEqual(f.data);
  expect(banks.packs['legacy']?.address).not.toEqual(banks.packs['another']?.address);
  expect(banks.all.source).toBe(f.source);
});

test('selected phone banks retain their own late audio even without a geometry pack', () => {
  const f = fixture(), geometry = f.data.packs.legacy;
  const input = { legacy: geometry, 'legacy-audio-piano': geometry, 'legacy-audio-folk': geometry,
    'unpacked-audio-piano': geometry, foreign: geometry, 'foreign-audio-piano': geometry };
  const selected = selectedPackTables(input, ['legacy', 'unpacked']);
  expect(Object.keys(selected)).toEqual(['legacy', 'unpacked']);
  expect(JSON.parse(selected['legacy'] ?? '')).toEqual({ bytes: {}, versions: {}, music: {}, sfx: {},
    packs: { legacy: geometry, 'legacy-audio-piano': geometry, 'legacy-audio-folk': geometry } });
  expect(JSON.parse(selected['unpacked'] ?? '')).toEqual({ bytes: {}, versions: {}, music: {}, sfx: {},
    packs: { 'unpacked-audio-piano': geometry } });
  expect(input.foreign).toBe(geometry);
});
