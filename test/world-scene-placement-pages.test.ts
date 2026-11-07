import { expect, test } from 'vitest';
import { parseWorldScenePlacement, parseWorldScenePlacementPage, WorldScenePlacementPageSchema } from '@wildshard/format/worldScenePlacement';
import { parseWorldScenes, worldScenesForTier } from '@wildshard/format/worldScenes';
import { registeredJsonContract } from '@wildshard/format/registeredJson';
import { registeredJsonSchema, namedJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { worldScenePlacementPages } from '@wildshard/sharddev/worldScenes';
import { parseSampledAudioPlacement } from '@wildshard/format/audioScene';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { createShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';
import { emptyShardfile } from '@wildshard/engine/host/author';

const encode = (input: unknown) => new TextEncoder().encode(JSON.stringify(input));
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const row = (index: number, tier?: 'phone' | 'desktop') => {
  const z = index === 0 ? 0 : -index;
  return parseWorldScenePlacement({ id: `marker.${index}`, model: 'marker', draw: 'single',
    poses: [{ x: index, y: 0, z, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, index, 0, z, 1] }],
    colliders: [{ kind: 'box', x: index, y: 0, z, hx: 1, hy: 1, hz: 1 }], piece: { id: `piece.${index}` },
    ...(tier === undefined ? {} : { tier }) });
};
const scene = { version: 1, libraries: [], materials: [], steps: [], catalogue: 'models/catalogue.json' };
const identity = { slug: 'page-contract', name: 'Page', author: 'Test', revision: 1, seed: 1 };

test('pages preserve complete serialized rows, declared order and one deterministic member per original id', () => {
  const input = Array.from({ length: 70 }, (_, i) => row(i, i % 3 === 0 ? 'phone' : i % 3 === 1 ? 'desktop' : undefined));
  const old = input.map(encode), original = structuredClone(input), result = worldScenePlacementPages('forest', input);
  expect(input).toEqual(original);
  expect(result.placements.map(p => p.id)).toEqual(input.map(p => p.id));
  const pages = new Map(result.files.map(file => {
    const name = file.file.name;
    if (name === undefined) throw new Error('Missing page name');
    const page = parseWorldScenePlacementPage(decode(file.bytes));
    expect(page.rows.length).toBeLessThanOrEqual(16);
    expect(new Set(page.rows.map(r => r.tier)).size).toBe(1);
    return [name, page] as const;
  }));
  for (const [index, reference] of result.placements.entries()) {
    const member = pages.get(reference.file)?.rows[reference.member];
    expect(member?.id).toBe(reference.id);
    expect(member?.tier).toBe(reference.tier);
    expect(encode(member)).toEqual(old[index]);
  }
  expect(worldScenePlacementPages('forest', input).files.map(f => [f.file.name, f.file.hash])).toEqual(result.files.map(f => [f.file.name, f.file.hash]));
});

test('page metadata names the complete native root and preserves the old individual contract', () => {
  const name = 'world/placement-pages/forest.shared.0.json';
  expect(registeredJsonContract(name)?.schema).toBe(WorldScenePlacementPageSchema);
  expect(registeredJsonSchema(name)['$comment']).toBe('@wildshard/format/worldScenePlacement#WorldScenePlacementPageSchema');
  expect(registeredJsonContract('scenes/placements/marker.json')?.source).toBe('@wildshard/format/worldScenePlacement#WorldScenePlacementSchema');
  for (const bad of ['world/placement-pages/a/b.json', 'world/placement-pages/../a.json', `world/placement-pages/${'x'.repeat(181)}.json`])
    expect(() => registeredJsonContract(bad)).toThrow('bounded platform id');
  expect(registeredJsonContract('world/placement-pages/forest.bin')).toBeUndefined();
});

test('publication retains authored row key order rather than the validator projection order', () => {
  const source = row(0);
  const original = { poses: source.poses, piece: source.piece, colliders: source.colliders,
    draw: source.draw, model: source.model, id: source.id };
  const result = worldScenePlacementPages('ordered', [original]);
  const file = result.files[0];
  if (file === undefined) throw new Error('Missing placement page');
  const page = JSON.parse(new TextDecoder().decode(file.bytes)) as { rows: unknown[] };
  expect(encode(page.rows[0])).toEqual(encode(original));
  expect(parseWorldScenePlacementPage(page).rows[0]).toEqual(source);
});

test('world admission keeps the original global 128 cap and bounds every page member at 15', () => {
  const rows = Array.from({ length: 128 }, (_, i) => row(i)), result = worldScenePlacementPages('forest', rows);
  expect(result.files).toHaveLength(8);
  expect(parseWorldScenes({ ...scene, placements: result.placements }).placements).toHaveLength(128);
  expect(() => worldScenePlacementPages('forest', [...rows, row(128)])).toThrow('at most 128');
  expect(() => parseWorldScenes({ ...scene, placements: [...result.placements, { id: 'extra', file: 'x.json', member: 0 }] })).toThrow();
  for (const member of [-1, 0.5, 16, Infinity]) expect(() => parseWorldScenes({ ...scene, placements: [{ id: 'marker', file: 'x.json', member }] })).toThrow();
  expect(parseWorldScenes({ ...scene, placements: [{ id: 'marker', file: 'x.json' }] }).placements).toEqual([{ id: 'marker', file: 'x.json' }]);
  expect(worldScenePlacementPages('forest', [])).toEqual({ files: [], placements: [] });
});

test('tier filtering retains exactly the same ordered active placements and never shares an inactive page', () => {
  const rows = [row(0), row(1, 'desktop'), row(2, 'phone'), row(3), row(4, 'phone')];
  const result = worldScenePlacementPages('forest', rows), parsed = parseWorldScenes({ ...scene, placements: result.placements });
  for (const tier of ['phone', 'desktop'] as const) {
    const selected = worldScenesForTier(parsed, tier).placements ?? [], activeFiles = new Set(selected.flatMap(p => 'file' in p ? [p.file] : []));
    expect(selected.map(p => p.id)).toEqual(rows.filter(r => r.tier === undefined || r.tier === tier).map(r => r.id));
    for (const file of result.files) if (file.file.name !== undefined && activeFiles.has(file.file.name))
      expect(parseWorldScenePlacementPage(decode(file.bytes)).rows.every(r => r.tier === undefined || r.tier === tier)).toBe(true);
  }
});

test('complete native page admission refuses duplicate, unknown, malformed and executable rows', () => {
  for (const value of [
    { version: 1, rows: [] }, { version: 1, rows: Array.from({ length: 17 }, (_, i) => row(i)) },
    { version: 1, rows: [row(0), row(0)] }, { version: 1, rows: [row(0)], ignored: 1 },
    { version: 1, rows: [{ ...row(0), poses: [{ x: 0, y: 0, z: 0, matrix: [1] }] }] },
    { version: 1, rows: [row(0), { ...row(1), callback: () => undefined }] },
    { version: 1, rows: [{ ...row(0), poses: [{ x: -0, y: 0, z: 0, yxz: { yaw: 0, scale: 1 } }] }] },
  ]) expect(() => parseWorldScenePlacementPage(value)).toThrow();
  expect(() => worldScenePlacementPages('../escape', [row(0)])).toThrow('bounded id');
  expect(() => worldScenePlacementPages('forest', [row(0), row(0)])).toThrow('unique');
});

test('large native pose lists retain their bounds and refuse accessors before reading them', () => {
  const original = row(0), pose = original.poses[0];
  if (pose === undefined) throw new Error('Missing pose');
  const large = { ...original, poses: Array.from({ length: 6000 }, () => pose) };
  expect(parseWorldScenePlacementPage({ version: 1, rows: [large] }).rows[0]?.poses).toHaveLength(6000);
  const other = { ...large, id: 'other' };
  expect(() => parseWorldScenePlacementPage({ version: 1, rows: [large, other] })).toThrow('plain JSON');
  const packed = worldScenePlacementPages('large', [large, other]);
  expect(packed.files).toHaveLength(2);
  expect(packed.placements.map(reference => reference.member)).toEqual([0, 0]);
  expect(() => parseWorldScenePlacementPage({ version: 1, rows: [{ ...large, poses: Array.from({ length: 8193 }, () => pose) }] })).toThrow();
  let reads = 0;
  const accessor = { version: 1, get rows() { reads++; return [large]; } };
  expect(() => parseWorldScenePlacementPage(accessor)).toThrow('plain JSON');
  const poses = [pose];
  Object.defineProperty(poses, 0, { enumerable: true, get: () => { reads++; return pose; } });
  expect(() => parseWorldScenePlacementPage({ version: 1, rows: [{ ...original, poses }] })).toThrow('plain JSON');
  expect(reads).toBe(0);
  expect(() => parseWorldScenePlacementPage({ version: 1, rows: [{ ...original,
    poses: [{ ...pose, params: { oversized: Array.from({ length: 100001 }, () => 0) } }] }] })).toThrow('plain JSON');
});

test('audio borrows only an identity-checked member after admitting the complete page', () => {
  const original = row(0), source = { id: original.id, file: 'page.json', member: 0 };
  expect(parseSampledAudioPlacement({ version: 1, rows: [original] }, source)).toEqual(original);
  expect(parseSampledAudioPlacement(original, 'placement.json')).toEqual(original);
  for (const member of [-1, 0.5, 1, 16])
    expect(() => parseSampledAudioPlacement({ version: 1, rows: [original] }, { ...source, member })).toThrow();
  expect(() => parseSampledAudioPlacement({ version: 1, rows: [original] }, { ...source, id: 'wrong' })).toThrow('member differs');
  expect(() => parseSampledAudioPlacement({ version: 1, rows: [original, { ...row(1), draw: 'invalid' }] }, source)).toThrow();
});

test('page publication and external reads require exact provenance before any transport', async () => {
  const name = 'world/placement-pages/forest.shared.0.json', input = { version: 1, rows: [row(0)] }, bytes = encode(input);
  expect(nameBlob(name, 'json', bytes, { jsonSchema: registeredJsonSchema(name) }).bytes).toEqual(bytes);
  expect(() => nameBlob(name, 'json', bytes)).toThrow('defining schema');
  expect(() => nameBlob(name, 'json', bytes, { jsonSchema: namedJsonSchema(WorldScenePlacementPageSchema) })).toThrow('exact defining format contract');
  let reads = 0;
  const product = createShardProduct({ slug: identity.slug, revision: 1, shardfile: emptyShardfile(identity), sections: new Map(),
    files: new Map([[name, { hash: 'a'.repeat(64), url: 'x', jsonSchema: namedJsonSchema(WorldScenePlacementPageSchema) }]]),
    read: () => { reads++; return Promise.resolve(bytes); }, builtJson: true });
  await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');
  expect(reads).toBe(0);
});
