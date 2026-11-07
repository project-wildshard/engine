// oxlint-disable-next-line import/no-nodejs-modules -- Keep the shipped phone rig as the complete immutable byte oracle.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import { nameBlob } from '../src/sharddev/blobs';
import { hashImmutableBytes } from '../src/shared/host/immutable';

const original = readFileSync('public/assets/gpu/far-reach/rigs/storm-roc-70e5655f.glb');
const record = v.record(v.string(), v.unknown());
function row(doc: Record<string, unknown>, key: string, index = 0): Record<string, unknown> {
  const rows = doc[key];
  if (!Array.isArray(rows)) throw new Error('Missing fixture rows');
  const value: unknown = rows[index];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Missing fixture row');
  return value as Record<string, unknown>;
}
function changed(edit: (doc: Record<string, unknown>, image: DataView) => void): Uint8Array {
  const header = new DataView(original.buffer, original.byteOffset, original.byteLength), size = header.getUint32(12, true);
  const doc = v.parse(record, JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + size))));
  const binary = new Uint8Array(original.subarray(28 + size));
  const image = row(doc, 'images'), range = row(doc, 'bufferViews', v.parse(v.number(), image['bufferView']));
  const offset = v.parse(v.number(), range['byteOffset']), length = v.parse(v.number(), range['byteLength']);
  edit(doc, new DataView(binary.buffer, offset, length));
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + padded + binary.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + padded); bytes.set(json, 20);
  view.setUint32(20 + padded, binary.length, true); view.setUint32(24 + padded, 0x004e4942, true); bytes.set(binary, 28 + padded);
  return bytes;
}

test('the complete shipped phone Basis rig admits without reencoding or changing its identity', async () => {
  await prepareGlbCost();
  const hash = '70e5655f969dfb40edba0109d16d7baddc6faef7bede8d10d91c2e2661f7d8ad';
  expect(original.byteLength).toBe(2_053_504); expect(hashImmutableBytes(original)).toBe(hash);
  const admitted = nameBlob('models/phone-rig.glb', 'glb', original);
  expect(admitted.file).toMatchObject({ compressed: 2_053_504, hash, decoded: 2_054_820, gpu: 6_380_144, triangles: 11_760, draws: 2 });
  expect(hashImmutableBytes(admitted.bytes)).toBe(hash); expect(admitted.bytes).not.toBe(original);
});

test.each([
  ['external image URI', (doc: Record<string, unknown>) => { row(doc, 'images')['uri'] = 'https://example.invalid/paint.ktx2'; }],
  ['wrong image MIME', (doc: Record<string, unknown>) => { row(doc, 'images')['mimeType'] = 'image/webp'; }],
  ['wrong texture binding', (doc: Record<string, unknown>) => {
    row(doc, 'textures')['extensions'] = { EXT_texture_webp: { source: 0 } };
    doc['extensionsUsed'] = ['EXT_texture_webp'];
  }],
  ['undeclared Basis extension', (doc: Record<string, unknown>) => { doc['extensionsUsed'] = []; }],
  ['ambiguous texture sources', (doc: Record<string, unknown>) => { row(doc, 'textures')['extensions'] = { KHR_texture_basisu: { source: 0 }, EXT_texture_webp: { source: 0 } }; }],
  ['invalid KTX2 signature', (_doc: Record<string, unknown>, image: DataView) => { image.setUint8(0, 0); }],
  ['missing image view', (doc: Record<string, unknown>) => { row(doc, 'images')['bufferView'] = 100; }],
  ['missing sampler', (doc: Record<string, unknown>) => { row(doc, 'textures')['sampler'] = 100; }],
  ['invalid sampler', (doc: Record<string, unknown>) => { row(doc, 'samplers')['minFilter'] = 0; }],
  ['invalid Basis image reference', (doc: Record<string, unknown>) => { row(doc, 'textures')['extensions'] = { KHR_texture_basisu: { source: 100 } }; }],
  ['oversized pixel allocation', (_doc: Record<string, unknown>, image: DataView) => { image.setUint32(20, 8192, true); }],
  ['empty mip inventory', (_doc: Record<string, unknown>, image: DataView) => { image.setUint32(40, 0, true); }],
  ['out-of-range mip payload', (_doc: Record<string, unknown>, image: DataView) => { image.setBigUint64(80, BigInt(image.byteLength), true); }],
  ['overlapping mip payloads', (_doc: Record<string, unknown>, image: DataView) => { image.setBigUint64(104, image.getBigUint64(80, true), true); }],
  ['non-Basis texel format', (_doc: Record<string, unknown>, image: DataView) => { image.setUint32(12, 37, true); }],
  ['non-Basis descriptor', (_doc: Record<string, unknown>, image: DataView) => { image.setUint8(image.getUint32(48, true) + 12, 1); }],
  ['combined image residency cap', (doc: Record<string, unknown>) => {
    const material = row(doc, 'materials');
    doc['materials'] = Array.from({ length: 5 }, () => structuredClone(material));
  }],
] as const)('normal admission refuses %s before allocation', async (_label, edit) => {
  await prepareGlbCost();
  const invalid = changed(edit);
  expect(() => parseGlbData(invalid)).toThrow();
  expect(() => nameBlob('models/refused.glb', 'glb', invalid)).toThrow();
});
