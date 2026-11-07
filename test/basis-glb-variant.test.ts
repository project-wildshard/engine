// oxlint-disable-next-line import/no-nodejs-modules -- Complete shipped GLBs are immutable byte oracles for this producer-only fixture.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the pure source bundle without file services in its output.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { build } from 'vite';
import { basisGlbVariant } from '../src/sharddev/bake/basisGlb';
import { assertConfigBoundary } from '../src/sharddev/configBoundary';
import { hashImmutableBytes } from '../src/shared/host/immutable';

const original = readFileSync('test/fixtures/sky-rigs/storm-roc.glb');
const phone = readFileSync('public/assets/gpu/far-reach/rigs/storm-roc-70e5655f.glb');
const phoneHash = hashImmutableBytes(phone), sourceHash = hashImmutableBytes(original);
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Missing fixture object');
  return value as Record<string, unknown>;
};
function image(bytes: Uint8Array): Uint8Array {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), size = header.getUint32(12, true);
  const doc = object(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + size))));
  const images = doc['images'], views = doc['bufferViews'];
  if (!Array.isArray(images) || !Array.isArray(views)) throw new Error('Missing fixture paint');
  const id = object(images[0])['bufferView'];
  if (typeof id !== 'number') throw new Error('Missing fixture view');
  const view = object(views[id]), offset = view['byteOffset'], length = view['byteLength'];
  if (typeof offset !== 'number' || typeof length !== 'number') throw new Error('Missing fixture range');
  return new Uint8Array(bytes.subarray(28 + size + offset, 28 + size + offset + length));
}

test('the injected shipped image reproduces the entire shipped phone container', async () => {
  const paint = image(phone);
  const result = await basisGlbVariant(original, input => {
    expect(input).toMatchObject({ index: 0, width: 1024, height: 1024 });
    input.bytes.fill(0);
    return paint;
  });
  expect(hashImmutableBytes(result)).toBe(phoneHash);
  paint.fill(0);
  expect(hashImmutableBytes(result)).toBe(phoneHash);
  expect(hashImmutableBytes(original)).toBe(sourceHash);
});

test('the caller cannot mutate geometry while the asynchronous encoder owns its detached image', async () => {
  const source = new Uint8Array(original);
  const result = await basisGlbVariant(source, async input => {
    source.fill(0); input.bytes.fill(0);
    await Promise.resolve();
    return image(phone);
  });
  expect(hashImmutableBytes(result)).toBe(phoneHash);
});

test.each([
  ['empty image', () => new Uint8Array()],
  ['truncated image', () => image(phone).subarray(0, 80)],
  ['raw texel encoding', () => { const bytes = image(phone); new DataView(bytes.buffer).setUint32(12, 37, true); return bytes; }],
  ['changed dimensions', () => { const bytes = image(phone); new DataView(bytes.buffer).setUint32(20, 512, true); return bytes; }],
  ['missing mip level', () => { const bytes = image(phone); new DataView(bytes.buffer).setUint32(40, 10, true); return bytes; }],
] as const)('a malformed encoder result refuses: %s', async (_label, encoded) => {
  await expect(basisGlbVariant(original, encoded)).rejects.toThrow();
  expect(hashImmutableBytes(original)).toBe(sourceHash);
});

test('unsupported or malformed sources refuse before requesting an encoder', async () => {
  let called = 0;
  const encode = (): Uint8Array => { called++; return image(phone); };
  for (const source of [new Uint8Array(), phone, readFileSync('test/fixtures/sky-rigs/sky-goat.glb')]) {
    await expect(basisGlbVariant(source, encode)).rejects.toThrow();
  }
  expect(called).toBe(0);
  await expect(basisGlbVariant(original, () => { throw new Error('encoder unavailable'); })).rejects.toThrow('encoder unavailable');
});

test('an individually bounded image cannot overflow the combined GLB allocation', async () => {
  const encoded = new Uint8Array(25_000_000); encoded.set(image(phone));
  await expect(basisGlbVariant(original, () => encoded)).rejects.toThrow('GLB variant buffer cap');
  expect(hashImmutableBytes(original)).toBe(sourceHash);
});

test('the unused writer bundles as one config-safe chunk with no file, process or generated imports', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: resolve('src/sharddev/bake/basisGlb.ts'), formats: ['es'] },
    rolldownOptions: { external: [/^node:/u], output: { codeSplitting: false } } } });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing variant writer bundle');
  const chunks = output.output.filter(row => row.type === 'chunk'); expect(chunks).toHaveLength(1);
  for (const chunk of chunks) {
    assertConfigBoundary([...chunk.imports, ...chunk.dynamicImports]);
    expect([...chunk.imports, ...chunk.dynamicImports]).toEqual([]);
    expect(Object.keys(chunk.modules).some(path => path.includes('.generated.'))).toBe(false);
  }
});
