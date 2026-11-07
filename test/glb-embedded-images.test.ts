// oxlint-disable-next-line import/no-nodejs-modules -- Keep the complete original native rig as the byte-contract oracle.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import { glbBuffers } from '@wildshard/format/glbBuffers';
import { glbImageCost } from '@wildshard/format/glbImages';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { nameBlob } from '../src/sharddev/blobs';

const original = readFileSync('test/fixtures/sky-rigs/storm-roc.glb');
const record = v.record(v.string(), v.unknown());
function row(doc: Record<string, unknown>, key: string, index = 0): Record<string, unknown> {
  const rows = doc[key];
  if (!Array.isArray(rows)) throw new Error('Missing fixture array');
  const value: unknown = rows[index];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Missing fixture row');
  return value as Record<string, unknown>;
}
function changed(edit: (doc: Record<string, unknown>, binary: Uint8Array) => void): Uint8Array {
  const source = new DataView(original.buffer, original.byteOffset, original.byteLength), size = source.getUint32(12, true);
  const doc = v.parse(record, JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + size))));
  const binary = new Uint8Array(original.subarray(28 + size));
  edit(doc, binary);
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + padded + binary.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + padded); bytes.set(json, 20);
  view.setUint32(20 + padded, binary.length, true); view.setUint32(24 + padded, 0x004e4942, true); bytes.set(binary, 28 + padded);
  return bytes;
}

function imageCost(bytes: Uint8Array): ReturnType<typeof glbImageCost> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = view.getUint32(12, true);
  const doc = v.parse(record, JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + size))));
  const data = glbBuffers(doc, bytes.subarray(28 + size));
  return glbImageCost(doc, data.views, data.bytes);
}

test('normal admission charges original WebP paint and every RGBA8 mip without changing the rig', async () => {
  await prepareGlbCost();
  const hash = '1c057979c81e5fafd2f97a151b7936c90ccf01555b2f307b911fc628e7c19af0';
  expect(hashImmutableBytes(original)).toBe(hash);
  expect(imageCost(original)).toEqual({ decoded: 4_817_080, gpu: 5_592_404 });
  expect(original.byteLength).toBe(492_772);
  expect(hashImmutableBytes(original)).toBe(hash);
  const cost = { decoded: 6_253_578, gpu: 6_380_144, triangles: 11_760, draws: 2 };
  expect(parseGlbData(original)).toEqual(cost);
  const admitted = nameBlob('models/painted-rig.glb', 'glb', original);
  expect(admitted.file).toEqual({ name: 'models/painted-rig.glb', kind: 'glb', hash,
    path: `blobs/glb/${hash}.glb`, compressed: 492_772, ...cost, critical: false, dependencies: [] });
  expect(hashImmutableBytes(admitted.bytes)).toBe(hash);
  expect(admitted.bytes).not.toBe(original);
});

test.each([
  ['external URI', (doc: Record<string, unknown>) => { row(doc, 'images')['uri'] = 'https://example.invalid/paint.webp'; }],
  ['data URI', (doc: Record<string, unknown>) => { row(doc, 'images')['uri'] = 'data:image/webp;base64,AAAA'; }],
  ['missing image view', (doc: Record<string, unknown>) => { row(doc, 'images')['bufferView'] = 9999; }],
  ['MIME mismatch', (doc: Record<string, unknown>) => { row(doc, 'images')['mimeType'] = 'image/png'; }],
  ['unknown texture extension', (doc: Record<string, unknown>) => { row(doc, 'textures')['extensions'] = { EXT_foreign: { source: 0 } }; }],
  ['ambiguous image source', (doc: Record<string, unknown>) => { row(doc, 'textures')['source'] = 0; }],
  ['missing image source', (doc: Record<string, unknown>) => { row(doc, 'textures')['extensions'] = { EXT_texture_webp: { source: 9999 } }; }],
  ['undeclared WebP extension', (doc: Record<string, unknown>) => { doc['extensionsUsed'] = ['EXT_meshopt_compression']; }],
  ['missing sampler', (doc: Record<string, unknown>) => { row(doc, 'textures')['sampler'] = 9999; }],
  ['sampler count cap', (doc: Record<string, unknown>) => { doc['samplers'] = Array.from({ length: 33 }, () => row(doc, 'samplers')); }],
  ['invalid filter', (doc: Record<string, unknown>) => { row(doc, 'samplers')['minFilter'] = 1; }],
  ['invalid wrap', (doc: Record<string, unknown>) => { row(doc, 'samplers')['wrapS'] = 1; }],
  ['unknown material extension', (doc: Record<string, unknown>) => { row(doc, 'materials')['extensions'] = { KHR_materials_clearcoat: { clearcoatTexture: { index: 0 } } }; }],
  ['unsupported texture coordinates', (doc: Record<string, unknown>) => { row(doc, 'materials')['normalTexture'] = { index: 0, texCoord: 2 }; }],
  ['unknown texture transform', (doc: Record<string, unknown>) => { row(doc, 'materials')['normalTexture'] = { index: 0, extensions: { KHR_texture_transform: {} } }; }],
  ['missing material texture', (doc: Record<string, unknown>) => { row(doc, 'materials')['normalTexture'] = { index: 9999 }; }],
  ['image count cap', (doc: Record<string, unknown>) => { doc['images'] = Array.from({ length: 17 }, () => row(doc, 'images')); }],
  ['texture count cap', (doc: Record<string, unknown>) => { doc['textures'] = Array.from({ length: 33 }, () => row(doc, 'textures')); }],
  ['corrupt image bytes', (doc: Record<string, unknown>, binary: Uint8Array) => {
    const image = row(doc, 'images'), view = row(doc, 'bufferViews', v.parse(v.number(), image['bufferView']));
    binary[v.parse(v.number(), view['byteOffset'])] = 0;
  }],
] as const)('embedded admission refuses %s before loader allocation', async (_label, edit) => {
  await prepareGlbCost();
  const invalid = changed(edit);
  expect(() => imageCost(invalid)).toThrow();
  expect(() => parseGlbData(invalid)).toThrow();
  expect(() => nameBlob('models/refused.glb', 'glb', invalid)).toThrow();
});


test('texture uses retain independent mip costs and refuse aggregate allocation beyond the existing GLB cap', async () => {
  await prepareGlbCost();
  const two = changed(doc => { row(doc, 'materials')['normalTexture'] = { index: 0 }; });
  expect(imageCost(two)).toEqual({ decoded: 4_817_080, gpu: 11_184_808 });
  const tooMany = changed(doc => { doc['textures'] = Array.from({ length: 5 }, () => row(doc, 'textures')); });
  expect(() => imageCost(tooMany)).toThrow('GLB image resource cap');
  expect(() => parseGlbData(tooMany)).toThrow('GLB image resource cap');
  const tooManyPixels = changed(doc => { doc['images'] = Array.from({ length: 6 }, () => row(doc, 'images')); });
  expect(() => imageCost(tooManyPixels)).toThrow('GLB image resource cap');
  expect(() => parseGlbData(tooManyPixels)).toThrow('GLB image resource cap');
});

test('an untextured document has zero embedded image cost', () => {
  expect(glbImageCost({}, [], new Uint8Array())).toEqual({ decoded: 0, gpu: 0 });
});


test('omitted sampler fields retain the original full-mip allocation floor', async () => {
  await prepareGlbCost();
  expect(imageCost(changed(doc => { doc['samplers'] = [{}]; }))).toEqual({ decoded: 4_817_080, gpu: 5_592_404 });
});


test('combined geometry and image allocations retain the existing GLB cap and blob cost floor', async () => {
  await prepareGlbCost();
  const combined = changed(doc => { doc['images'] = Array.from({ length: 5 }, () => row(doc, 'images')); });
  expect(imageCost(combined).decoded).toBe(24_085_400);
  expect(() => parseGlbData(combined)).toThrow('GLB resource cap');
  expect(() => nameBlob('models/understated.glb', 'glb', original, { gpu: 6_380_143 }))
    .toThrow('Blob costs cannot understate actual bytes or geometry');
  expect(() => nameBlob('models/understated.glb', 'glb', original, { decoded: 6_253_577 }))
    .toThrow('Blob costs cannot understate actual bytes or geometry');
});
