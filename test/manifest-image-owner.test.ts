// oxlint-disable-next-line import/no-nodejs-modules -- Original admitted image bytes exercise native Blob URL transport.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { sourceManifest } from '../src/client/game/plugin/context';
import { emptyShardfile } from '../src/shared/host/author';

const original = Uint8Array.from(readFileSync('test/fixtures/world-source/image.png'));
const hash = 'a'.repeat(64);
function fixture(slug = 'image-owner') {
  const source = emptyShardfile({ slug, name: 'Images', author: 'Test', seed: 1, revision: 1 });
  source.presentation = { biome: 'Image biome', blurb: 'Original image card', card: { thumb: hash, portrait: hash, landscape: hash } };
  source.map = { image: hash, tilesHash: 'b'.repeat(64) };
  return source;
}

test('owned manifest shares one detached image across all card and map references', async () => {
  const owner = new Scope('manifest'), create = vi.spyOn(URL, 'createObjectURL'), revoke = vi.spyOn(URL, 'revokeObjectURL');
  const storage = new Uint8Array(original.length + 8);
  storage.set(original, 4);
  const manifest = sourceManifest(fixture(), new Map([[hash, storage.subarray(4, -4)]]), owner);
  try {
    expect(manifest.card.thumb).toMatch(/^blob:/u);
    expect(manifest.card).toEqual({ thumb: manifest.card.thumb, portrait: manifest.card.thumb, landscape: manifest.card.thumb });
    expect(manifest.minimap?.image).toBe(manifest.card.thumb);
    expect(create).toHaveBeenCalledTimes(1);
    expect(manifest.biome).toBe('Image biome');
    expect(manifest.blurb).toBe('Original image card');
    storage.fill(0);
    const response = await fetch(manifest.card.thumb);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
  } finally { owner.dispose(); }
  expect(revoke.mock.calls).toEqual([[manifest.card.thumb]]);
  await expect(fetch(manifest.card.thumb)).rejects.toThrow();
});

test('replacement retires only the same identity within the same owner', async () => {
  const owner = new Scope('catalogue'), otherOwner = new Scope('other catalogue'), assets = new Map([[hash, original]]);
  const first = sourceManifest(fixture(), assets, owner), neighbour = sourceManifest(fixture('other-images'), assets, owner);
  const independent = sourceManifest(fixture(), assets, otherOwner);
  try {
    const replacement = sourceManifest(fixture(), assets, owner);
    expect(replacement.card.thumb).not.toBe(first.card.thumb);
    await expect(fetch(first.card.thumb)).rejects.toThrow();
    for (const manifest of [replacement, neighbour, independent]) expect((await fetch(manifest.card.thumb)).ok).toBe(true);
    owner.dispose();
    await expect(fetch(replacement.card.thumb)).rejects.toThrow();
    await expect(fetch(neighbour.card.thumb)).rejects.toThrow();
    expect((await fetch(independent.card.thumb)).ok).toBe(true);
  } finally { owner.dispose(); otherOwner.dispose(); }
});

test('failed replacement releases its partial batch and preserves the prior manifest', async () => {
  const owner = new Scope('manifest'), assets = new Map([[hash, original]]);
  const previous = sourceManifest(fixture(), assets, owner);
  const create = vi.spyOn(URL, 'createObjectURL'), revoke = vi.spyOn(URL, 'revokeObjectURL');
  const broken = fixture();
  if (broken.presentation === undefined) throw new Error('Missing fixture presentation');
  broken.presentation.card.portrait = 'c'.repeat(64);
  try {
    expect(() => sourceManifest(broken, assets, owner)).toThrow('Presentation image is missing admitted bytes');
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalledWith(previous.card.thumb);
    expect((await fetch(previous.card.thumb)).ok).toBe(true);
  } finally { owner.dispose(); }
});

test('removing images retires the previous batch without allocating URLs', async () => {
  const owner = new Scope('manifest'), assets = new Map([[hash, original]]);
  const previous = sourceManifest(fixture(), assets, owner), create = vi.spyOn(URL, 'createObjectURL');
  try {
    const empty = emptyShardfile({ slug: 'image-owner', name: 'Images', author: 'Test', seed: 1, revision: 2 });
    const manifest = sourceManifest(empty, new Map(), owner);
    expect(manifest.minimap).toEqual({});
    expect(create).not.toHaveBeenCalled();
    await expect(fetch(previous.card.thumb)).rejects.toThrow();
  } finally { owner.dispose(); }
});

test('retired or missing owners refuse before URL allocation', () => {
  const owner = new Scope('manifest'), assets = new Map([[hash, original]]), create = vi.spyOn(URL, 'createObjectURL');
  owner.dispose();
  expect(() => sourceManifest(fixture(), assets, owner)).toThrow('Image owner retired');
  expect(create).not.toHaveBeenCalled();
  expect(() => sourceManifest(fixture(), assets)).toThrow('Image owner required');
});

test('retiring ancestors refuse before URL allocation', () => {
  const parent = new Scope('parent'), owner = parent.child('manifest'), create = vi.spyOn(URL, 'createObjectURL');
  parent.onDispose(() => undefined);
  const steps = parent.disposeSteps();
  steps.next();
  try {
    expect(owner.disposed).toBe(false);
    expect(() => sourceManifest(fixture(), new Map([[hash, original]]), owner)).toThrow('Image owner retired');
    expect(create).not.toHaveBeenCalled();
  } finally { for (const step of steps) void step; }
});

test('invalid identity refuses before constructing its owned image batch', () => {
  const owner = new Scope('manifest'), source = fixture(), create = vi.spyOn(URL, 'createObjectURL');
  source.identity.slug = 'invalid slug';
  try {
    expect(() => sourceManifest(source, new Map([[hash, original]]), owner)).toThrow();
    expect(create).not.toHaveBeenCalled();
  } finally { owner.dispose(); }
});
