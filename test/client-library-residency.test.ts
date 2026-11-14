import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { Scope } from '../src/shared/engine/app/scope';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { leaseClientLibrary } from '../src/client/game/shardfile/clientLibrary';

function fixture() {
  const source = emptyShardfile({ slug: 'resident-library', name: 'Library', author: 'Test', revision: 1, seed: 1 });
  const wire = new Uint8Array([1, 2, 3]), ref = hashImmutableBytes(wire);
  source.files.push({ hash: ref, kind: 'binary', compressed: wire.length, decoded: 20, gpu: 4, triangles: 0, draws: 0, dependencies: [], critical: false });
  source.library.push(ref);
  const cache = new Map([[ref, wire]]), fetch = vi.fn(() => Promise.reject(new Error('Offline fetch refused')));
  const assets = new ClientAssets(source, new Map(), { base: 'https://example.invalid/output/', offline: true, firstParty: true, fetch,
    hash: bytes => Promise.resolve(hashImmutableBytes(bytes)), cache: {
      product: () => Promise.resolve(null), putFolder: () => Promise.resolve(),
      asset: (_base, hash) => Promise.resolve(cache.get(hash) ?? null), putAsset: () => Promise.resolve(true),
    } });
  const allocator = new ResidencyAllocator(), scope = new Scope('resident');
  const ports = { allocator, scope, owner: 'home', read: (hash: string) => assets.read(hash) };
  return { source, wire, ref, cache, fetch, assets, allocator, scope, ports };
}

test('released library transport is verified again and retains its complete decoded/GPU claim', async () => {
  const f = fixture();
  try {
    await leaseClientLibrary(f.source, f.assets.retained, f.ports);
    expect(f.assets.retained.size).toBe(0);
    expect(f.allocator.cost().input.libraries).toBe(24);
    expect(f.allocator.entries()).toHaveLength(1);
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { f.scope.dispose(); }
  expect(f.allocator.entries()).toHaveLength(0);
});

test.each(['missing', 'corrupt'] as const)('a %s reread refuses before publishing any residency claim', async mode => {
  const f = fixture();
  if (mode === 'missing') f.cache.clear(); else f.cache.set(f.ref, new Uint8Array([3, 2, 1]));
  try {
    await expect(leaseClientLibrary(f.source, f.assets.retained, f.ports)).rejects.toThrow(mode === 'missing' ? 'Missing cached' : 'hash or size');
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
});

test('a library lease still refuses absent bytes without an admitted rereader', async () => {
  const f = fixture();
  try {
    await expect(leaseClientLibrary(f.source, f.assets.retained, { allocator: f.allocator, scope: f.scope, owner: 'home' })).rejects.toThrow('Missing admitted library residency');
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
});

test('a disposed region cannot publish claims after a pending verified read completes', async () => {
  const f = fixture();
  let finish: ((value: Uint8Array) => void) | undefined;
  const read = () => new Promise<Uint8Array>(resolve => { finish = resolve; });
  const pending = leaseClientLibrary(f.source, f.assets.retained, { ...f.ports, read });
  f.scope.dispose();
  if (finish === undefined) throw new Error('Missing pending library read');
  finish(f.wire);
  await expect(pending).rejects.toThrow('owner left');
  expect(f.allocator.entries()).toHaveLength(0);
});

test.each(['missing', 'corrupt'] as const)('image residency preserves the full claim without a %s eager body read', async mode => {
  const f = fixture(), file = f.source.files[0];
  if (file === undefined) throw new Error('Missing image fixture');
  file.kind = 'image';
  if (mode === 'missing') f.cache.clear(); else f.cache.set(f.ref, new Uint8Array([3, 2, 1]));
  const read = vi.fn(f.ports.read);
  try {
    await leaseClientLibrary(f.source, f.assets.retained, { ...f.ports, read });
    expect(read).not.toHaveBeenCalled();
    expect(f.assets.retained.size).toBe(0);
    expect(f.allocator.cost().input.libraries).toBe(24);
    expect(f.allocator.entries()).toHaveLength(1);
    // The real image consumer still uses the original verified body reader.
    await expect(f.assets.read(f.ref)).rejects.toThrow(mode === 'missing' ? 'Missing cached' : 'hash or size');
    f.cache.set(f.ref, f.wire);
    await expect(f.assets.read(f.ref)).resolves.toEqual(f.wire);
    expect(f.fetch).not.toHaveBeenCalled();
  } finally { f.scope.dispose(); }
  expect(f.allocator.entries()).toHaveLength(0);
});

test('KTX2 residency still reads and parses bytes before publishing device-specific costs', async () => {
  const f = fixture(), file = f.source.files[0];
  if (file === undefined) throw new Error('Missing texture fixture');
  file.kind = 'ktx2';
  const read = vi.fn(f.ports.read);
  try {
    // This hash-valid three-byte body is not a KTX2 texture.
    await expect(leaseClientLibrary(f.source, f.assets.retained, { ...f.ports, read })).rejects.toThrow();
    expect(read).toHaveBeenCalledExactlyOnceWith(f.ref);
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
});

test('declared commons still receive verified byte-derived residency costs', async () => {
  const f = fixture();
  f.source.requires.commons.push(f.ref); f.source.requires.commonsWire[f.ref] = f.wire.length;
  const read = vi.fn(f.ports.read);
  try {
    await leaseClientLibrary(f.source, f.assets.retained, { ...f.ports, read });
    expect(read).toHaveBeenCalledWith(`commons:${f.ref}`);
    expect(f.allocator.cost().input.commons).toBe(f.wire.length);
    expect(f.allocator.cost().input.libraries).toBe(24);
  } finally { f.scope.dispose(); }
  expect(f.allocator.entries()).toHaveLength(0);
});

test('malformed commons refuse before any library claim is published', async () => {
  const f = fixture(), bytes = new Uint8Array([103, 108, 84, 70]), hash = hashImmutableBytes(bytes);
  f.source.requires.commons.push(hash); f.source.requires.commonsWire[hash] = bytes.length;
  f.cache.set(hash, bytes);
  try {
    await expect(leaseClientLibrary(f.source, f.assets.retained, f.ports)).rejects.toThrow('truncated');
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
});
