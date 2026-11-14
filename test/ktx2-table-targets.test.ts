// S11 (meta SENTRY-TRIAGE): admission refuses a product whose KTX2 table names a file nothing serves (Pine Hollow rev 1's
// phone and desktop 404s, Nine Dragon's phone 404).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readTar } from '@wildshard/format/tar';
import { assertKtx2TableTargets, missingKtx2Targets, type Ktx2TableFolder } from '../src/shared/game/shardfile/ktx2Targets';

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
function product(files: Readonly<Record<string, unknown>>): Ktx2TableFolder {
  const bytes = new Map(Object.entries(files).map(([path, value]) => [path, value instanceof Uint8Array ? value : json(value)]));
  return { paths: () => bytes.keys(), read: path => { const body = bytes.get(path); if (body === undefined) throw new Error(`no ${path}`); return body; } };
}
const discovery = (ktx2: unknown): unknown => ({ version: 1, slug: 'glade', rows: {}, native: { ktx2 } });
const tiers = (phone: Record<string, string>, desktop: Record<string, string>) => ({ phone, desktop });

describe('the KTX2 table rule', () => {
  test('a plain GPU_FILES table: every target is a mount, or the first missing one is named', () => {
    const table = { GPU_FILES: tiers({ '/assets/glade/a.webp': '/assets/gpu/glade/a.phone-1.ktx2', '/assets/glade/b.webp': '/assets/gpu/glade/b.phone-2.ktx2' }, { '/assets/glade/a.webp': '/assets/gpu/glade/a-3.ktx2' }) };
    const files = { 'mounts/shardfiles/glade/discovery.json': discovery(table), 'mounts/assets/gpu/glade/a.phone-1.ktx2': new Uint8Array(1), 'mounts/assets/gpu/glade/a-3.ktx2': new Uint8Array(1) };
    expect(() => assertKtx2TableTargets(product(files))).toThrow('KTX2 table names a missing file: /assets/gpu/glade/b.phone-2.ktx2 (1 of 3 targets missing)');
    expect(() => assertKtx2TableTargets(product({ ...files, 'mounts/assets/gpu/glade/b.phone-2.ktx2': new Uint8Array(1) }))).not.toThrow();
  });

  test('pageModeKtx2 rows: shard and grid, both tiers; a cook row, a product file and an engine file all serve', () => {
    const table = { $call: 'pageModeKtx2', args: [{
      shard: tiers({ '/assets/glade/a.glb': '/assets/gpu/glade/a.phone-1.glb' }, { '/assets/glade/a.glb': '/shardfiles/glade/blobs/glb/aa.glb' }),
      grid: tiers({ '/assets/tex/rock.webp': '/assets/gpu/tex/rock.phone-2.ktx2' }, { '/assets/glade/c.webp': '/assets/gpu/glade/c-4.ktx2' }),
    }] };
    const files = { 'mounts/shardfiles/glade/discovery.json': discovery(table), 'blobs/glb/aa.glb': new Uint8Array(1), 'blobs/ktx2/bb.ktx2': new Uint8Array(1),
      'cook.json': { mounts: [{ url: '/assets/gpu/glade/a.phone-1.glb', path: 'blobs/glb/aa.glb' }, { url: '/assets/gpu/glade/c-4.ktx2', path: 'blobs/ktx2/gone.ktx2' }] } };
    const engine = (url: string): boolean => url === '/assets/gpu/tex/rock.phone-2.ktx2';
    // A cook row over a file the product does not hold serves nothing.
    expect(missingKtx2Targets(product(files), engine)).toEqual({ total: 4, missing: ['/assets/gpu/glade/c-4.ktx2'] });
    expect(missingKtx2Targets(product(files)).missing).toEqual(['/assets/gpu/tex/rock.phone-2.ktx2', '/assets/gpu/glade/c-4.ktx2']);
    expect(() => assertKtx2TableTargets(product({ ...files, 'blobs/ktx2/gone.ktx2': new Uint8Array(1) }), engine)).not.toThrow();
  });

  test('a product file is served at its own slug only, and one missing target is named once', () => {
    const table = { GPU_FILES: tiers({ '/a.webp': '/shardfiles/other/blobs/x.ktx2', '/b.webp': '/shardfiles/other/blobs/x.ktx2' }, {}) };
    const files = { 'mounts/shardfiles/glade/discovery.json': discovery(table), 'blobs/x.ktx2': new Uint8Array(1) };
    expect(missingKtx2Targets(product(files))).toEqual({ total: 2, missing: ['/shardfiles/other/blobs/x.ktx2'] });
  });

  test('a product with no table, or no discovery document, has nothing to check', () => {
    expect(missingKtx2Targets(product({ 'mounts/shardfiles/glade/discovery.json': discovery(undefined) }))).toEqual({ total: 0, missing: [] });
    expect(missingKtx2Targets(product({ 'shard.json': {} }))).toEqual({ total: 0, missing: [] });
  });
});

// The real tarballs: Pine Hollow rev 1 (`0e246ab0…`, on the `pins` release) and rev 2 as prepared (`1c334833…`; the uploaded
// pin `f45e25f2…` holds the same mounts and table). They live in the pin cache; CI's cache holds only the pinned set, where
// `pins.ts install` runs this rule over every pin.
const CACHE = process.env['WILDSHARD_PIN_CACHE'] ?? join(homedir(), '.cache/wildshard/pins');
const REV1 = '0e246ab03210d777619bf1fb09bbaa9da1bbcaea5093a8adfce913508762f084';
const REV2 = '1c334833af01bc70dd9096f9ac3b5ab9b9b33498e5aca8c7bf259eae280ca518';
const tarball = (hash: string): Ktx2TableFolder => {
  const files = readTar(readFileSync(join(CACHE, `${hash}.tar`)));
  return { paths: () => files.keys(), read: path => { const body = files.get(path); if (body === undefined) throw new Error(`no ${path}`); return body; } };
};

test.skipIf(!existsSync(join(CACHE, `${REV1}.tar`)))('Pine Hollow rev 1 is refused, naming its first missing target', () => {
  expect(() => assertKtx2TableTargets(tarball(REV1))).toThrow('KTX2 table names a missing file: /assets/gpu/pine-hollow/creatures/antler-king-rig.phone.rigged-4aa793ec.glb (81 of 321 targets missing)');
}, 60_000);

test.skipIf(!existsSync(join(CACHE, `${REV2}.tar`)))('Pine Hollow rev 2 is admitted', () => {
  expect(missingKtx2Targets(tarball(REV2))).toEqual({ total: 374, missing: [] });
}, 60_000);
