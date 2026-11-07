import { expect, test, vi } from 'vitest';
import { audioPackReader } from './audioPack';
import type { PackDef } from '../../../shared/engine/boot/tables';

async function fixture(): Promise<{ pack: PackDef; paths: string[]; wire: Uint8Array<ArrayBuffer> }> {
  const paths = ['/assets/sfx/fixture/one.m4a', '/assets/music/fixture/two.m4a'];
  const wire = new Uint8Array([1, 2, 3, 4, 5]);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', wire))].map(value => value.toString(16).padStart(2, '0')).join('');
  const files = [[paths[0] ?? '', 0, 2, 'audio/mp4'], [paths[1] ?? '', 2, 3, 'audio/mp4']] as const;
  return { paths, wire, pack: { bytes: 5, files, parts: [{ url: `/assets/packs/fixture.phone-${hash.slice(0, 8)}.bin`, bytes: 5, files }] } };
}

test('concurrent late clips use one verified part and private complete member bytes', async () => {
  const { pack, paths, wire } = await fixture();
  const net = vi.fn<typeof fetch>(() => Promise.resolve(new Response(wire)));
  const { read, release } = audioPackReader(pack, new Set(paths), net);
  const [one, two, again] = await Promise.all([read(paths[0] ?? ''), read(paths[1] ?? ''), read(paths[0] ?? '')]);
  expect(net).toHaveBeenCalledExactlyOnceWith(pack.parts[0]?.url, {});
  expect([...new Uint8Array(one)]).toEqual([1, 2]);
  expect([...new Uint8Array(two)]).toEqual([3, 4, 5]);
  structuredClone(one, { transfer: [one] });
  expect(one.byteLength).toBe(0);
  expect([...new Uint8Array(again)]).toEqual([1, 2]);
  expect([...new Uint8Array(await read(paths[0] ?? ''))]).toEqual([1, 2]);
  release();
  await read(paths[0] ?? '');
  expect(net).toHaveBeenLastCalledWith(paths[0], {});
});

test('a partial demand never downloads unselected control or foreign clips', async () => {
  const { pack, paths } = await fixture(), first = paths[0] ?? '';
  const net = vi.fn<typeof fetch>(() => Promise.resolve(new Response(new Uint8Array([1, 2]))));
  const { read } = audioPackReader(pack, new Set([first]), net);
  expect([...new Uint8Array(await read(first))]).toEqual([1, 2]);
  expect(net).toHaveBeenCalledExactlyOnceWith(first, {});
  await expect(read(paths[1] ?? '')).rejects.toThrow('outside its selected bank');
  expect(net).toHaveBeenCalledTimes(1);
});

test.each(['missing', 'truncated', 'changed'] as const)('a %s part falls back to original clips without publishing corrupt bytes', async mode => {
  const { pack, paths, wire } = await fixture(), first = paths[0] ?? '';
  const net = vi.fn<typeof fetch>(input => Promise.resolve(input === first
    ? new Response(new Uint8Array([1, 2]))
    : mode === 'missing' ? new Response(null, { status: 404 }) : new Response(mode === 'truncated' ? wire.slice(0, 4) : new Uint8Array([1, 2, 3, 4, 6]))));
  const { read } = audioPackReader(pack, new Set(paths), net);
  expect([...new Uint8Array(await read(first))]).toEqual([1, 2]);
  expect([...new Uint8Array(await read(first))]).toEqual([1, 2]);
  expect(net.mock.calls.filter(([input]) => input === pack.parts[0]?.url)).toHaveLength(1);
});

test('bad offsets and duplicate members refuse before fetching', async () => {
  const { pack, paths } = await fixture(), part = pack.parts[0];
  if (part === undefined) throw new Error('Missing fixture part');
  const net = vi.fn<typeof fetch>();
  const broken = { ...part, files: part.files.map(([path, at, bytes, type]) => [path, at + 1, bytes, type] as const) };
  expect(() => audioPackReader({ ...pack, parts: [broken] }, new Set(paths), net)).toThrow('Invalid audio pack member');
  expect(() => audioPackReader({ ...pack, parts: [part, part] }, new Set(paths), net)).toThrow('Invalid audio pack member');
  expect(net).not.toHaveBeenCalled();
});

test('retiring the bank aborts its part without starting per-file fallback', async () => {
  const { pack, paths } = await fixture(), lifetime = new AbortController();
  const net = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(new DOMException('Retired', 'AbortError')); }, { once: true });
  }));
  const { read } = audioPackReader(pack, new Set(paths), net, lifetime.signal);
  const pending = read(paths[0] ?? ''); lifetime.abort();
  await expect(pending).rejects.toThrow();
  await expect(read(paths[1] ?? '')).rejects.toThrow();
  expect(net).toHaveBeenCalledTimes(1);
});
