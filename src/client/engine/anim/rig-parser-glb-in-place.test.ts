// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Scene, type Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createRigLoader } from './rigParser';

afterEach(() => { vi.restoreAllMocks(); });

/** a real GLB (one JSON and one BIN chunk) of a box, as the exporter writes it */
async function boxGlb(): Promise<ArrayBuffer> {
  const scene = new Scene(); scene.add(new Mesh(new BoxGeometry(1, 2, 3), new MeshBasicMaterial()));
  const out = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('expected a GLB');
  return out;
}
const positions = (scene: Object3D): number[] => {
  let found: number[] = [];
  scene.traverse((o) => {
    const geometry: unknown = o instanceof Mesh ? o.geometry : undefined;
    const position: unknown = geometry instanceof BufferGeometry ? geometry.getAttribute('position') : undefined;
    if (position instanceof BufferAttribute) found = Array.from(position.array);
  });
  return found;
};

test('MG10: a GLB decodes from its own bytes, with no whole-BIN copy, to the same geometry three reads', async () => {
  const glb = await boxGlb();
  const slice = vi.spyOn(ArrayBuffer.prototype, 'slice');
  const gltf = await createRigLoader().parseAsync(glb, '');
  const sliced = slice.mock.results.map(result => (result.value as ArrayBuffer).byteLength);
  vi.restoreAllMocks();
  const view = new DataView(glb), bin = view.getUint32(20 + view.getUint32(12, true), true);
  // every slice is one buffer view, never the BIN chunk whole
  expect(sliced.length).toBeGreaterThan(0);
  expect(Math.max(...sliced)).toBeLessThan(bin);
  expect(positions(gltf.scene)).toEqual([...new BoxGeometry(1, 2, 3).getAttribute('position').array]);
});

test('MG10: a GLB lent as part of a larger buffer decodes in place too', async () => {
  const glb = new Uint8Array(await boxGlb()), wire = new Uint8Array(glb.byteLength + 16);
  wire.set(glb, 8);
  const gltf = await createRigLoader().parseBytesAsync(wire.subarray(8, 8 + glb.byteLength), '');
  expect(positions(gltf.scene)).toEqual([...new BoxGeometry(1, 2, 3).getAttribute('position').array]);
});

test('MG10: a file that is not a GLB still goes to three as it was', async () => {
  const text = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }));
  const gltf = await createRigLoader().parseAsync(text.buffer, '');
  expect(gltf.scene.children).toHaveLength(0);
});

/** a GLB around `json` and `bin` (the BIN chunk padded to 4) */
function glbOf(json: object, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.byteLength / 4) * 4, binLength = Math.ceil(bin.byteLength / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jsonLength); out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); out.set(bin, 28 + jsonLength);
  return out.buffer;
}

test('MG10: a meshopt view still reads its own bytes of buffer 0, with no BIN copy', async () => {
  const bin = Uint8Array.from({ length: 64 }, (_, i) => i);
  const json = { asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'], buffers: [{ byteLength: 64 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 40, byteLength: 16, byteStride: 4, count: 4, mode: 'ATTRIBUTES' } } },
      { buffer: 0, byteOffset: 8, byteLength: 8 }] };
  const seen: number[][] = [];
  const decoder = { supported: true, ready: Promise.resolve(), decodeGltfBuffer: (): void => undefined,
    decodeGltfBufferAsync: (_count: number, _stride: number, source: Uint8Array): Promise<Uint8Array> => { seen.push([...source]); return Promise.resolve(source.slice()); } };
  const loader = createRigLoader().setMeshoptDecoder(decoder as never);
  const slice = vi.spyOn(ArrayBuffer.prototype, 'slice');
  const gltf = await loader.parseAsync(glbOf(json, bin), '');
  const [packed, plain] = await Promise.all([gltf.parser.getDependency('bufferView', 0), gltf.parser.getDependency('bufferView', 1)]) as [ArrayBuffer, ArrayBuffer];
  const sliced = slice.mock.results.map(result => (result.value as ArrayBuffer).byteLength);
  vi.restoreAllMocks();
  expect(seen).toEqual([[...bin.subarray(40, 56)]]);
  expect([...new Uint8Array(packed)]).toEqual([...bin.subarray(40, 56)]);
  expect([...new Uint8Array(plain)]).toEqual([...bin.subarray(8, 16)]);
  expect(sliced.every(length => length < 64)).toBe(true);
});
