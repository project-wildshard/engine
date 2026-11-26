import { installCatalogueFixture } from './fixtures/bootSetup';
import { afterEach, expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { Scope } from '@wildshard/engine/app/scope';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { outputIndexEnvelope } from '@wildshard/format/version';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import * as runtime from '../src/client/game/shardfile/runtimeFolder';
import { readFolderDescriptor, type FolderOptions } from '../src/client/game/shardfile/folder';
import { findShard } from '../src/client/game/shard/registry';
import { gridShardfileEdges, gridShardfileFarBytes, gridShardfileKept, readGridShardfileFar, readGridShardfileLook, readGridShardfileNear } from '../src/client/game/grid/folders';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';

// QA 11-25 row 116: Nine's one-cell boot read its 749 KB `shard.json` four times (its admission, then the grid's far bytes,
// kept rows and far view) and three sections twice. A boot reads each file of its home once: this boot counts them.
await installCatalogueFixture();
const SLUG = 'driftwood-isle';

const scopes: Scope[] = [], restores: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const restore of restores.splice(0).reverse()) restore(); for (const scope of scopes.splice(0)) scope.dispose(); });
/** A page global for this test only (the suite's setup stubs others, so no blanket unstub). */
function pageGlobal(name: string, value: unknown): void {
  const held = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  restores.push(() => { if (held === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, held); });
}

/** The home's built product at its catalogue URL, served by a build reader that counts every read by path. */
function product(seed: number) {
  pageGlobal('location', { href: 'https://game.test/' });
  const manifest = findShard(SLUG);
  if (manifest?.shardfile === undefined) throw new Error('Missing catalogue home');
  const url = new URL(manifest.shardfile, 'https://game.test/'), base = new URL('.', url).href;
  const source = emptyShardfile({ slug: SLUG, name: 'Boot reads', author: 'Test', revision: 1, seed });
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
  const sections = new Map([...outputSectionPayloads(source)].map(([name, value]) => [name, encode(value)]));
  const index = encode(outputIndexEnvelope({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, requires: source.requires, build: { sourceHash: '0'.repeat(64), validator: 'test' },
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [...sections].map(([name, bytes]) => ({ name, path: `sections/${name}.json`, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length })),
    schemas: [], files: [], runtime: null }));
  // the build's verdict table lists the home's index, as a built page's does (its reads carry `?v=`)
  pageGlobal('__SHARDFILE_VERDICTS__', [{ path: url.pathname, indexHash: hashImmutableBytes(index) }]);
  const wires = new Map([[url.pathname, index], ...[...sections].map(([name, bytes]) => [new URL(`sections/${name}.json`, base).pathname, bytes] as const)]);
  const reads = new Map<string, number>();
  const options: FolderOptions = { base, offline: false, hash: (bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)),
    fetch: () => Promise.reject(new Error('A built-in product reads through its build reader')),
    buildRead: (address: string, size?: number) => {
      const path = new URL(address).pathname, bytes = wires.get(path);
      reads.set(path, (reads.get(path) ?? 0) + 1);
      if (bytes === undefined || (size !== undefined && size !== bytes.length)) return Promise.reject(new Error(`Missing emitted file ${path}`));
      return Promise.resolve(Uint8Array.from(bytes));
    } };
  vi.spyOn(runtime, 'browserShardfileOptions').mockReturnValue(options);
  const owner = (): { allocator: ResidencyAllocator; scope: Scope } => { const scope = new Scope('boot reads'); scopes.push(scope); return { allocator: new ResidencyAllocator({}), scope }; };
  return { manifest, url, options, reads, owner, repeats: (): [string, number][] => [...reads].filter(([, count]) => count > 1) };
}

/** The grid's descriptor helpers, as a one-cell boot asks them (session.ts, play.ts, the page shell): together, then again. */
async function gridHelpers(owner: Parameters<typeof gridShardfileEdges>[1]): Promise<void> {
  const ask = (): Promise<unknown> => Promise.all([gridShardfileFarBytes(SLUG), gridShardfileKept(SLUG), readGridShardfileFar(SLUG, true),
    gridShardfileEdges(SLUG, owner), readGridShardfileLook(SLUG), readGridShardfileNear(SLUG)]);
  await ask(); await ask();
}

test('a grid page boot reads its home\'s index and sections once: the grid takes what its admission read', async () => {
  const f = product(1);
  // the page admits its home under its catalogue manifest before the grid opens (entry.ts installManifestShardfile)
  const source = await readFolderDescriptor(f.options);
  runtime.provideManifestAdmission(f.manifest, { source, assets: new Map(), cached: false }, f.options);
  const admitted = f.reads.size;
  expect(f.reads.get(f.url.pathname)).toBe(1); expect(admitted).toBeGreaterThan(1);
  await gridHelpers(f.owner());
  expect(f.repeats()).toEqual([]);
  expect(f.reads.size).toBe(admitted);
});

test('without an admission the grid\'s helpers still read a cell\'s index and each section once', async () => {
  // a neighbour (or a home whose admission is gone): its far bytes, kept rows, far view and edges ask together
  const f = product(2);
  await gridHelpers(f.owner());
  expect(f.reads.get(f.url.pathname)).toBe(1);
  expect(f.repeats()).toEqual([]);
});
