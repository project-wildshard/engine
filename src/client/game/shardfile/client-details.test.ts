import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { LookDetail } from '@wildshard/format/look-details';
import { detailLayerFiles, installClientDetails, linearTint } from './clientDetails';

// Meta SHARD-SOURCE AP32d1: a shard's look.details row on the page, one InstancedMesh per layer from its library files.

const HASH = (letter: string): string => letter.repeat(64);
const COLUMNS = 16, ROWS = 16;

function triangle(): Uint8Array {
  const floats = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const out = new Uint8Array(floats.byteLength + 6);
  out.set(new Uint8Array(floats.buffer), 0); out.set(new Uint8Array(new Uint16Array([0, 1, 2]).buffer), floats.byteLength);
  return out;
}
const row: LookDetail = {
  id: 'grass', material: 'scene.grass.detail', mesh: { file: HASH('a'), vertices: 3, triangles: 1 },
  region: { corner: [-8, -8], cell: 1, columns: COLUMNS, rows: ROWS, span: [0, 2] }, mask: HASH('b'), heights: HASH('c'),
  clumps: 4, scale: [0.5, 1], tilt: 0.2, tint: [[0.5, 0.5, 0.5], [1, 1, 1]], sway: { amount: 0.3, rate: 0.8 }, radius: 20, shadow: false,
};
const assets = (): Map<string, Uint8Array> => new Map([[HASH('a'), triangle()], [HASH('b'), new Uint8Array(COLUMNS * ROWS).fill(255)], [HASH('c'), new Uint8Array(COLUMNS * ROWS * 2)]]);

function ports(phone = false): { root: THREE.Group; disposers: (() => void)[]; frames: ((dt: number) => void)[]; materials: Map<string, THREE.Material>; phone: boolean } {
  return { root: new THREE.Group(), disposers: [], frames: [], materials: new Map([[row.material, new THREE.MeshStandardMaterial()]]), phone };
}

test('a look.details row draws as one InstancedMesh under the root, filled on the first frame and gone with the scope', () => {
  const p = ports();
  const layers = installClientDetails([row], assets(), { root: p.root, materials: p.materials, phone: false, scope: { onDispose: (run: () => void) => { p.disposers.push(run); } } as never,
    viewer: () => ({ x: 0, z: 0 }), frame: (run) => { p.frames.push(run); } });
  expect(layers).toHaveLength(1);
  expect(p.root.children).toHaveLength(1);
  expect(p.root.children[0]).toBeInstanceOf(THREE.InstancedMesh);
  for (const run of p.frames) run(1 / 60);
  // a full mask grows clumps round the viewer: some slot holds a non-zero matrix
  expect(layers[0]?.ring.matrices.some((value: number) => value !== 0)).toBe(true);
  for (const run of p.disposers) run();
  expect(p.root.children).toHaveLength(0);
});

test('the sRGB tint reaches instanceColor as linear, and a short file or a missing material is refused by layer id', () => {
  const [low] = linearTint([[0.5, 0.5, 0.5], [1, 1, 1]]);
  expect(low?.[0]).toBeCloseTo(0.214, 3);
  const p = ports(), base = { root: p.root, phone: false, scope: { onDispose: () => undefined } as never, viewer: () => ({ x: 0, z: 0 }), frame: () => undefined };
  const short = assets(); short.set(HASH('b'), new Uint8Array(3));
  expect(() => installClientDetails([row], short, { ...base, materials: p.materials })).toThrow(/Detail layer refused: detail grass: mask holds 3 bytes/u);
  expect(() => installClientDetails([row], assets(), { ...base, materials: new Map() })).toThrow(/Detail layer grass: material scene.grass.detail did not compile/u);
  expect(installClientDetails(undefined, assets(), { ...base, materials: p.materials })).toHaveLength(0);
});

test('a detail file left out of the library is read, not refused (format 0.7.0 does not require it there)', async () => {
  const all = assets(), retained = new Map([[HASH('a'), all.get(HASH('a')) ?? new Uint8Array()]]), asked: string[] = [];
  const files = await detailLayerFiles([row], retained, (hash) => { asked.push(hash); return Promise.resolve(all.get(hash) ?? new Uint8Array()); });
  expect(asked.sort()).toEqual([HASH('b'), HASH('c')]);
  expect([...files.keys()].sort()).toEqual([HASH('a'), HASH('b'), HASH('c')]);
  expect(await detailLayerFiles(undefined, retained, () => Promise.reject(new Error('no read')))).toEqual(new Map());
});

// Meta SHARD-SOURCE SS7: the cards part round the movers on the page's trample field
test('an owned field gets every mover pushed and one update a frame; a field another system owns is only bent on', () => {
  const pushes: number[][] = [], updates: number[][] = [];
  const field = { push: (x: number, z: number, radius: number, strength = 1, vx = 0, vz = 0) => { pushes.push([x, z, radius, strength, vx, vz]); },
    update: (dt: number, at: { x: number; z: number }) => { updates.push([dt, at.x, at.z]); } };
  let x = 0;
  const frames: ((dt: number) => void)[] = [], p = ports();
  const base = { root: p.root, materials: p.materials, phone: false, scope: { onDispose: () => undefined } as never, viewer: () => ({ x: 0, z: 0 }) };
  installClientDetails([row], assets(), { ...base, frame: (run) => { frames.push(run); },
    trample: { field, uniforms: {}, glsl: 'vec2 trampleBend( vec2 p ) { return vec2( 0.0 ); }', movers: () => [{ id: 'player', x, z: 0, radius: 0.55 }, { id: 'creature:boar', x: 3, z: x, radius: 0.7 }] } });
  for (const run of frames) run(0.1);
  x = 0.5;
  for (const run of frames) run(0.1);
  expect(updates).toEqual([[0.1, 0, 0], [0.1, 0.5, 0]]);
  expect(pushes).toHaveLength(4);
  expect(pushes[2]).toEqual([0.5, 0, 0.55, 1, 5, 0]); // the player's velocity from its last frame
  expect(pushes[3]?.[5]).toBeCloseTo(5); // the creature walks +z
  // a jump of 10 m in a frame is a teleport: pushed still
  x = 10.5;
  for (const run of frames) run(0.1);
  expect(pushes[4]).toEqual([10.5, 0, 0.55, 1, 0, 0]);
  // owned elsewhere: the layer bends on it, but nothing pushes or updates from here
  const before = updates.length, others: ((dt: number) => void)[] = [];
  installClientDetails([row], assets(), { ...base, frame: (run) => { others.push(run); }, trample: { field, uniforms: {}, glsl: 'vec2 trampleBend( vec2 p ) { return vec2( 0.0 ); }', movers: () => null } });
  for (const run of others) run(0.1);
  expect(updates).toHaveLength(before);
});

test('a mover missing for a frame is forgotten: it comes back pushed still, not with a stride', () => {
  const pushes: number[][] = [], p = ports(), frames: ((dt: number) => void)[] = [];
  const field = { push: (x: number, _z: number, _radius: number, _strength = 1, vx = 0, vz = 0) => { pushes.push([x, vx, vz]); }, update: () => undefined };
  let seen = true, x = 0;
  installClientDetails([row], assets(), { root: p.root, materials: p.materials, phone: false, scope: { onDispose: () => undefined } as never, viewer: () => ({ x: 0, z: 0 }),
    frame: (run) => { frames.push(run); }, trample: { field, uniforms: {}, glsl: 'vec2 trampleBend( vec2 p ) { return vec2( 0.0 ); }',
      movers: () => (seen ? [{ id: 'creature:boar', x, z: 0, radius: 0.7 }] : []) } });
  for (const run of frames) run(0.1);
  seen = false; for (const run of frames) run(0.1);
  seen = true; x = 2; for (const run of frames) run(0.1);
  expect(pushes.at(-1)).toEqual([2, 0, 0]);
});
