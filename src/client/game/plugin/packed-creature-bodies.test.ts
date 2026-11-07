import { zlibSync } from 'fflate';
import { afterAll, expect, test, vi } from 'vitest';
import { packedCreatureBodies } from './geometry';
import { HullLookBook } from '../looks/speciesBook';
import { Rng } from '@wildshard/engine/core/rng';

const file = `/assets/test/bodies-${'a'.repeat(64)}.bin`;
const row = () => ({ file, bytes: 36, bodies: [{ kind: 'bird', variant: 'small',
  bones: [{ name: 'body', parent: null, pos: [0, 0, 0] }],
  dims: { bodyY: .5, bodyHalfLen: .5, bodyRadius: .2, headRadius: .1, legLen: .3, halfWidth: .2, feet: [[0, 0]], capsuleAxis: 'y' },
  fur: null, eye: null, hard: { offsets: [0], row: { attrs: [['position', 'f32', 3, false]], count: 3, index: null, indexCount: 0, box: false } } }] });
afterAll(() => { vi.unstubAllGlobals(); });

test('preloads once and gives each spawned body independent geometry, bones and feet', async () => {
  const bytes = zlibSync(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  const fetcher = vi.fn(() => Promise.resolve(new Response(bytes)));
  vi.stubGlobal('fetch', fetcher);
  const bodies = packedCreatureBodies(row());
  expect(() => bodies.copy('bird', 'small')).toThrow('not loaded');
  await Promise.all([bodies.preload(), bodies.preload()]);
  const a = bodies.copy('bird', 'small'), b = bodies.copy('bird', 'small');
  const first = a.hardParts[0], second = b.hardParts[0];
  if (first === undefined || second === undefined) throw new Error('Missing body geometry');
  first.getAttribute('position').setX(0, 12);
  expect(second.getAttribute('position').getX(0)).toBe(0);
  expect(a.bones[0]).not.toBe(b.bones[0]); expect(a.dims.feet[0]).not.toBe(b.dims.feet[0]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(() => bodies.copy('bird', 'missing')).toThrow('no baked creature body');
  const view = { id: 'look.finch', species: 'species.finch', kind: 'finch', family: 'bird', variants: { juvenile: 'small' }, skeleton: 'bird.v1', sockets: ['body'], clips: [] };
  const looks = bodies.looks({ poses: {}, rows: [view] }), look = looks.get('finch');
  const copied = look.build({ id: 'juvenile', label: 'Juvenile', weight: 1, rarity: 'common', scale: [1, 1] }, new Rng(1));
  expect(copied.bones).toEqual(b.bones); expect(copied.hardParts[0]).not.toBe(second);
  expect(() => looks.get('missing')).toThrow('Unknown packed creature look');
  expect(() => bodies.looks({ poses: {}, rows: [view, { ...view, id: 'another' }] })).toThrow('Duplicate');
  expect(() => bodies.looks({ poses: {}, rows: [{ ...view, variants: { juvenile: 'absent' } }] })).toThrow('Missing packed creature look body');
  expect(() => bodies.looks({ poses: {}, rows: [{ ...view, pose: 'absent' }] })).toThrow('Missing packed creature joint pose');
  expect(() => bodies.looks({ poses: {}, rows: [{ ...view, build: () => copied }] })).toThrow();
});

test('refuses unsafe paths, invalid metadata, failed fetches and mismatched payloads', async () => {
  expect(() => packedCreatureBodies({ ...row(), file: '/assets/../outside.bin' })).toThrow();
  const invalid = row(); const body = invalid.bodies[0];
  if (body === undefined) throw new Error('Missing row');
  body.hard.offsets[0] = 40;
  expect(() => packedCreatureBodies(invalid)).toThrow('exceeds its bake');
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
  await expect(packedCreatureBodies(row()).preload()).rejects.toThrow('404');
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(zlibSync(new Uint8Array(4)))));
  const short = packedCreatureBodies(row()); await short.preload();
  expect(() => short.copy('bird', 'small')).toThrow('does not match');
});

test('accepts normalized contiguous parts with raw indices, draw groups and a lent decode', async () => {
  const raw = new Uint8Array(44);
  raw.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  raw.set(new Uint8Array(new Uint16Array([0, 1, 2]).buffer), 36);
  const base = row(), body = base.bodies[0];
  if (body === undefined) throw new Error('Missing row');
  const part = { ...body.hard, offsets: [0, 36], indexEncoding: 'raw', groups: [[0, 3, 1]],
    row: { ...body.hard.row, index: 'u16', indexCount: 3 } };
  const input = { ...base, bytes: raw.length, bodies: [{ ...body, hard: [part, part] }] };
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Uint8Array([1]))));
  const bodies = packedCreatureBodies(input, () => raw); await bodies.preload();
  const parts = bodies.copy('bird', 'small').hardParts, first = parts[0], second = parts[1];
  if (first === undefined || second === undefined) throw new Error('Missing normalized parts');
  expect(first).not.toBe(second); expect(first.index?.getX(1)).toBe(1);
  expect(first.groups.some(group => group.materialIndex === 1)).toBe(true);
});

test('named body files use one product read and preserve every original vertex and independent copy', async () => {
  const raw = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), compressed = zlibSync(raw);
  const fetcher = vi.fn(() => Promise.reject(new Error('Named body must not fetch a public fallback')));
  vi.stubGlobal('fetch', fetcher);
  const read = vi.fn((name: string) => {
    expect(name).toBe('actors/bodies.bin');
    return Promise.resolve(compressed);
  });
  const bodies = packedCreatureBodies({ ...row(), file: 'actors/bodies.bin' }, undefined, read);
  await Promise.all([bodies.preload(), bodies.preload()]);
  const a = bodies.copy('bird', 'small'), b = bodies.copy('bird', 'small');
  const first = a.hardParts[0], second = b.hardParts[0];
  if (first === undefined || second === undefined) throw new Error('Missing named body geometry');
  const positions = first.getAttribute('position');
  expect(Array.from({ length: positions.count }, (_, i) => [positions.getX(i), positions.getY(i), positions.getZ(i)]))
    .toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  expect(a.bones).toEqual(row().bodies[0]?.bones); expect(a.dims).toEqual(row().bodies[0]?.dims);
  positions.setX(0, 42); expect(second.getAttribute('position').getX(0)).toBe(0);
  expect(a.bones[0]).not.toBe(b.bones[0]); expect(a.dims.feet[0]).not.toBe(b.dims.feet[0]);
  expect(read).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});

test('named body paths and missing reader refuse before any capability or public fallback', async () => {
  const read = vi.fn(() => Promise.reject(new Error('Missing named body')));
  const fetcher = vi.fn(() => Promise.reject(new Error('Unexpected fallback'))); vi.stubGlobal('fetch', fetcher);
  expect(() => packedCreatureBodies({ ...row(), file: 'actors/bodies.bin' })).toThrow('requires its product reader');
  for (const name of ['../bodies.bin', 'actors/../bodies.bin', 'actors//bodies.bin', '/outside.bin', 'https://test/bodies.bin',
    'file:///bodies.bin', 'actors/bodies.bin?x', 'actors/bodies.bin#x', 'actors/%2e%2e/bodies.bin', String.raw`actors\bodies.bin`, `${'a'.repeat(257)}.bin`]) {
    expect(() => packedCreatureBodies({ ...row(), file: name }, undefined, read)).toThrow();
  }
  expect(read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  const bodies = packedCreatureBodies({ ...row(), file: 'actors/bodies.bin' }, undefined, read);
  await expect(bodies.preload()).rejects.toThrow('Missing named body');
  expect(read).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});

test('public hash bodies keep their original fetch owner when a product reader exists', async () => {
  const bytes = zlibSync(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  const fetcher = vi.fn(() => Promise.resolve(new Response(bytes))); vi.stubGlobal('fetch', fetcher);
  const read = vi.fn(() => Promise.reject(new Error('Public source must retain its fetch owner')));
  const bodies = packedCreatureBodies(row(), undefined, read); await bodies.preload();
  expect(bodies.copy('bird', 'small').hardParts).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
});


test('the hull book passes its existing product file capability to the packed owner', async () => {
  const input = { slug: 'named-body-book', body: { ...row(), file: 'actors/bodies.bin' }, definitions: {}, rows: [] };
  const compressed = zlibSync(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer));
  const fetcher = vi.fn(() => Promise.reject(new Error('Hull book must use its product'))); vi.stubGlobal('fetch', fetcher);
  let reads = 0;
  const files = { file(name: string): Promise<Uint8Array> {
    expect(this).toBe(files); expect(name).toBe('actors/bodies.bin'); reads++;
    return Promise.resolve(compressed);
  } };
  expect(() => new HullLookBook(input)).toThrow('requires its product reader');
  const book = new HullLookBook(input, files);
  await Promise.all([book.packed.preload(), book.packed.preload()]);
  expect(book.packed.copy('bird', 'small').hardParts).toHaveLength(1);
  expect(reads).toBe(1); expect(fetcher).not.toHaveBeenCalled();
});
