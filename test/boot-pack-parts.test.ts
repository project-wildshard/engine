import { expect, test } from 'vitest';
import { bootPackParts } from '../scripts/boot-pack-parts.mjs';
import { Scope } from '../src/shared/engine/app/scope';
import type { PackFile, PackPart } from '../src/shared/engine/boot/tables';
import { TexturePackReads } from '../src/client/engine/boot/texturePack';

test('texture cohorts isolate revisions, unrelated families and non-texture files', () => {
  const paths = [
    '/assets/sky.jpg',
    '/assets/gpu/rock/diffuse-00000000.ktx2', '/assets/gpu/rock/normal-11111111.ktx2', '/assets/gpu/rock/arm-22222222.ktx2',
    '/assets/gpu/rock/diffuse-33333333.ktx2', '/assets/gpu/rock/normal-44444444.ktx2', '/assets/gpu/rock/arm-55555555.ktx2',
    '/assets/gpu/tree/cards-66666666.ktx2', '/assets/gpu/tree/normal-77777777.ktx2',
    '/assets/model.glb', '/assets/props.bin',
  ];
  const groups = bootPackParts(paths, () => 100);
  expect(groups).toEqual([paths.slice(0, 1), paths.slice(1, 4), paths.slice(4, 7), paths.slice(7, 9), paths.slice(9)]);
  expect(groups.flat()).toEqual(paths);
  expect(bootPackParts([], () => 100)).toEqual([]);
});

test('texture parts split before the original demand-reader cap, never through a file', () => {
  const paths = ['a', 'b', 'c', 'd'].map(slot => `/assets/gpu/coats/${slot}-00000000.ktx2`);
  const sizes = [2_097_152, 2_097_152, 4_194_305, 10];
  const sizeOf = (path: string): number => {
    const size = sizes[paths.indexOf(path)];
    if (size === undefined) throw new Error('Unknown part fixture');
    return size;
  };
  expect(bootPackParts(paths, sizeOf)).toEqual([paths.slice(0, 2), paths.slice(2, 3), paths.slice(3)]);
});

test('dotted model variants share only their own model demand, retaining material cohorts', () => {
  const paths = ['bear.brown.old.phone', 'bear.brown.young.phone', 'deer.hind.white.phone', 'deer.hind.brown.phone',
    'bolt.arm', 'bolt.col', 'bolt.nrm'].map(slot => `/assets/gpu/shared/${slot}-00000000.ktx2`);
  expect(bootPackParts(paths, () => 100)).toEqual([paths.slice(0, 2), paths.slice(2, 4), paths.slice(4)]);
});

test('non-texture parts retain boot order and image-before-glTF adjacency', () => {
  const paths = ['/assets/models/prop/textures/color.png', '/assets/models/prop/textures/normal.png',
    '/assets/models/prop/prop.gltf', '/assets/world.bin'];
  expect(bootPackParts(paths, () => 3_000_000)).toEqual([paths.slice(0, 3), paths.slice(3)]);
});

test('emitted model cohorts in one directory combine independently through the real demand reader', async () => {
  const scope = new Scope('cohort-pack-transport');
  const bodies = new Map<string, Uint8Array<ArrayBuffer>>();
  const digest = async (body: Uint8Array<ArrayBuffer>): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 8);
  const family = (name: string, seed: number): Promise<string[]> => Promise.all(['color', 'normal', 'arm'].map(async (slot, index) => {
    const body = new Uint8Array(20 + index).fill(seed + index);
    const path = `/assets/gpu/shared/${name}.kind.${slot}.phone-${await digest(body)}.ktx2`;
    bodies.set(path, body); return path;
  }));
  const first = await family('first', 1), second = await family('second', 4);
  const wire = (path: string): Uint8Array<ArrayBuffer> => {
    const body = bodies.get(path); if (body === undefined) throw new Error('Missing declared pack bytes'); return body;
  };
  const paths = [...first, ...second];
  const parts: PackPart[] = await Promise.all(bootPackParts(paths, path => wire(path).length).map(async group => {
    const bytes = new Uint8Array(group.reduce((sum, path) => sum + wire(path).length, 0));
    const files: PackFile[] = []; let offset = 0;
    for (const path of group) { const body = wire(path); bytes.set(body, offset); files.push([path, offset, body.length, 'image/ktx2']); offset += body.length; }
    const url = `/assets/packs/fixture.phone-${await digest(bytes)}.bin`;
    bodies.set(url, bytes); return { url, bytes: bytes.length, files };
  }));
  const lone = second[0]; if (lone === undefined) throw new Error('Missing partial fixture');
  let releaseCache: (value: Response | undefined) => void = () => {throw new Error('Missing cache observation');};
  const pendingCache = new Promise<Response | undefined>(resolve => {releaseCache = resolve;});
  let observeLone = (): void => {throw new Error('Missing lone transport observation');};
  const loneStarted = new Promise<void>(resolve => {observeLone = resolve;});
  const reads: string[] = [];
  const net: typeof fetch = input => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    reads.push(path); if (path === lone) observeLone(); return Promise.resolve(new Response(wire(path).slice()));
  };
  const reader = new TexturePackReads({ parts, bytes: parts.reduce((sum, part) => sum + part.bytes, 0), files: parts.flatMap(part => part.files) }, scope, path => path === parts[0]?.url ? pendingCache : Promise.resolve(undefined));
  const read = (path: string): Promise<Response> => {
    const response = reader.read(path, net); if (response === undefined) throw new Error('Missing declared texture'); return response;
  };
  try {
    const requested = [...first, lone];
    const completed = Promise.all(requested.map(read));
    await loneStarted; expect(reads).toEqual([lone]);
    releaseCache(undefined); const responses = await completed;
    expect(reads).toEqual([lone, parts[0]?.url]);
    expect(parts).toHaveLength(2);
    for (const [index, response] of responses.entries()) {
      const path = requested[index]; if (path === undefined) throw new Error('Missing response owner');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(wire(path));
      expect(response.headers.get('content-type')).toBe('image/ktx2');
    }
  } finally { reader.dispose(); scope.dispose(); }
});
