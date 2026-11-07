// oxlint-disable-next-line import/no-nodejs-modules -- Actual admitted inert image bytes exercise the reader.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { parseStillImage } from '@wildshard/format/stillImage';
import { Scope } from '../src/shared/engine/app/scope';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { leaseMapImage } from '../src/client/game/shardfile/mapImage';
import { ApproachInputsDeferredError } from '../src/client/game/grid/productInputs';

test('map admission hands off to only the retained bitmap or canvas pixels', () => {
  const bytes = Uint8Array.from(readFileSync('test/fixtures/world-source/image.png'));
  const image = parseStillImage(bytes), hash = 'a'.repeat(64);
  const source = emptyShardfile({ slug: 'map-fixture', name: 'Map', author: 'Test', seed: 1, revision: 1 });
  source.map = { image: hash, tilesHash: hash };
  source.files.push({ hash, kind: 'image', compressed: bytes.length, decoded: image.decoded, gpu: image.gpu,
    triangles: 0, draws: 0, dependencies: [], critical: false });
  for (const retained of [{ width: image.width, height: image.height }, { width: 400, height: 400 }, null]) {
    const scope = new Scope('map'), allocator = new ResidencyAllocator();
    const lease = leaseMapImage(source, new Map([[hash, bytes]]), allocator, scope);
    if (lease === undefined) throw new Error('Map missing');
    expect(allocator.cost().input.libraries).toBe(image.decoded + image.gpu);
    lease.retained(retained);
    expect(allocator.cost().input.libraries).toBe(retained === null ? 0 : retained.width * retained.height * 4);
    expect(() => lease.retained(retained)).toThrow('already settled');
    scope.dispose();
    expect(allocator.entries()).toHaveLength(0);
  }
});

test('optional map decoding cannot evict the return world; required map admission retains its policy', () => {
  const bytes = Uint8Array.from(readFileSync('test/fixtures/world-source/image.png'));
  const image = parseStillImage(bytes), hash = 'a'.repeat(64);
  const source = emptyShardfile({ slug: 'map-pressure', name: 'Map', author: 'Test', seed: 1, revision: 1 });
  source.map = { image: hash, tilesHash: hash };
  source.files.push({ hash, kind: 'image', compressed: bytes.length, decoded: image.decoded, gpu: image.gpu, triangles: 0, draws: 0, dependencies: [], critical: false });
  const assets = new Map([[hash, bytes]]), probe = new ResidencyAllocator(), probeScope = new Scope('probe-map');
  leaseMapImage(source, assets, probe, probeScope);
  const cap = probe.cost().playing + 1; probeScope.dispose();
  const allocator = new ResidencyAllocator({ playing: cap }), scope = new Scope('optional-map'), evict = vi.fn();
  const kept = allocator.reserve({ id: 'kept-map-world', owner: 'kept', category: 'sim', bytes: 3, distance: 1, needed: false, evictSync: () => { evict(); } });
  if (kept === null) throw new Error('Kept world missing');
  try {
    expect(() => leaseMapImage(source, assets, allocator, scope, true)).toThrow(ApproachInputsDeferredError);
    expect(evict).not.toHaveBeenCalled(); expect(allocator.has('kept-map-world')).toBe(true);
    const actual = leaseMapImage(source, assets, allocator, scope);
    if (actual === undefined) throw new Error('Required map missing');
    expect(evict).toHaveBeenCalledOnce(); actual.retained(null);
  } finally { kept.release(); scope.dispose(); }
});
