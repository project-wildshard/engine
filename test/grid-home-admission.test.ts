import { installCatalogueFixture } from './fixtures/bootSetup';
import { afterEach, expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { hashImmutableBytes } from '@wildshard/engine/host/immutable';
import { Scope } from '@wildshard/engine/app/scope';
import * as product from '../src/client/game/shardfile/folder';
import * as runtime from '../src/client/game/shardfile/runtimeFolder';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { findShard } from '../src/client/game/shard/registry';
import { gridShardfileFolder } from '../src/client/game/grid/folders';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';

// QA 11-25 row 109: a grid page boots a shell while its home cell's product is admitted under the cell's catalogue manifest
// (findShard(slug)); the boot's release of the page's own admission left all of Nine's (415 files, 37.6 MB) held.
await installCatalogueFixture();

const scopes: Scope[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const scope of scopes.splice(0)) scope.dispose(); });

function installedHome() {
  const source = emptyShardfile({ slug: 'driftwood-isle', name: 'Home admission', author: 'Test', revision: 1, seed: 1 });
  const binary = Uint8Array.of(4, 5, 6, 7), ref = hashImmutableBytes(binary);
  source.files.push({ hash: ref, kind: 'binary', compressed: binary.length, decoded: binary.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  source.library.push(ref);
  const wire = new Map([[ref, binary]]);
  const releasePreparedTransport = vi.fn((refs: Iterable<string>) => { const released = [...refs]; for (const hash of released) wire.delete(hash); return Promise.resolve(released); });
  const native = vi.fn(() => Promise.resolve(Uint8Array.from(binary)));
  const options: product.FolderOptions = { base: 'https://home.test/', offline: false, buildRead: native,
    fetch: vi.fn(() => Promise.resolve(Response.json({}))), hash: (bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)) };
  const reader = new ClientAssets(source, wire, options);
  const home = findShard('driftwood-isle');
  if (home === undefined) throw new Error('Missing catalogue home');
  runtime.provideManifestAdmission(home, { source, assets: wire, cached: false, releasePreparedTransport }, options, reader);
  // the page boots a shell of the same slug, another object (pageShell.ts)
  return { source, ref, binary, wire, reader, home, shell: { ...home }, native, options };
}

test('a grid page boot releases its home cell\'s admission, not only its shell\'s', async () => {
  const f = installedHome();
  await runtime.releaseManifestTransport(f.shell);
  expect(f.wire.has(f.ref)).toBe(true); // the shell owns no admission: the old release kept the home's whole product
  await runtime.releaseBootTransport(f.shell, f.home);
  expect(f.wire.size).toBe(0); expect(f.reader.retained.size).toBe(0);
  expect(runtime.heldAdmissionBytes(f.ref)).toBeUndefined();
});

test('a file the home admission holds is read once: later reads take its bytes until the boot releases it', async () => {
  const f = installedHome();
  expect(runtime.heldAdmissionBytes(f.ref)).toBe(f.binary);
  // the page's build reader (the grid's admission, its input leases and its cell readers all read through it)
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no read while the admission holds it'));
  const read = runtime.browserShardfileOptions('https://home.test/shardfiles/driftwood-isle/', true).buildRead;
  if (read === undefined) throw new Error('Missing build reader');
  const progress = vi.fn<(bytes: number) => void>();
  await expect(read(`https://home.test/shardfiles/driftwood-isle/blobs/${f.ref}`, f.binary.length, progress, f.ref)).resolves.toBe(f.binary);
  expect(fetch).not.toHaveBeenCalled(); expect(progress).toHaveBeenCalledWith(f.binary.length);
  await runtime.releaseBootTransport(f.shell, f.home);
  expect(runtime.heldAdmissionBytes(f.ref)).toBeUndefined();
});

test('the grid admits its home from the installed source instead of reading its descriptor again', async () => {
  const f = installedHome();
  vi.spyOn(runtime, 'browserShardfileOptions').mockReturnValue(f.options);
  const descriptor = vi.spyOn(product, 'readFolderDescriptor');
  const admit = vi.spyOn(product, 'admitFolder').mockImplementation(async (input, opts) => {
    await opts.reserve?.(f.source);
    return { source: input as typeof f.source, assets: new Map(f.wire), cached: false, releasePreparedTransport: () => Promise.resolve([]) };
  });
  const scope = new Scope('home product'); scopes.push(scope);
  const metadata = await gridShardfileFolder('driftwood-isle', { scope, allocator: new ResidencyAllocator({}) }, 'metadata');
  if (metadata === null) throw new Error('Missing home metadata');
  expect(descriptor).not.toHaveBeenCalled();
  expect(admit.mock.calls[0]?.[0]).toBe(f.source);
  metadata.release();
  await runtime.releaseBootTransport(f.shell, f.home);
});
