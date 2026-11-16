import * as THREE from 'three';
import { expect, test } from 'vitest';
import { DetailRing, RING_CELL, detailField, layerSeed, ringShape, type DetailLayerFiles, type DetailLayerSource } from './detailRing';
import { DetailLayer, ringFade } from './detailLayer';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import { patchWindField } from './wind';

// Meta SHARD-SOURCE AP32b: a shard's detail layer scattered in a camera ring (Grass.ts's toroidal cells, made general).

const COLUMNS = 128, ROWS = 128, CELLS = COLUMNS * ROWS;
const HASH = (letter: string): string => letter.repeat(64);

/** One triangle card in the format's mesh file layout: positions, normals, uvs (f32), then indices (u16). */
function triangleFile(): Uint8Array {
  const floats = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const out = new Uint8Array(floats.byteLength + 6);
  out.set(new Uint8Array(floats.buffer), 0);
  out.set(new Uint8Array(new Uint16Array([0, 1, 2]).buffer), floats.byteLength);
  return out;
}

/** A 128 m meadow (1 m mask cells) from (-64, -64): full on the west half, empty on the east, ground at y 1.5. */
function meadowFiles(): DetailLayerFiles {
  const mask = new Uint8Array(CELLS);
  for (let z = 0; z < ROWS; z++) mask.fill(255, z * COLUMNS, z * COLUMNS + COLUMNS / 2);
  return { mesh: triangleFile(), mask, heights: new Uint8Array(new Uint16Array(CELLS).fill(32768).buffer) };
}
function meadow(extra: Partial<DetailLayerSource> = {}): DetailLayerSource {
  return {
    id: 'grass', material: 'grass-card',
    mesh: { file: HASH('a'), vertices: 3, triangles: 1 },
    region: { corner: [-64, -64], cell: 1, columns: COLUMNS, rows: ROWS, span: [0, 3] },
    mask: HASH('b'), heights: HASH('c'),
    clumps: 2, scale: [0.5, 1], tilt: 0.2, tint: [[0.8, 0.8, 0.6], [1, 1, 0.9]], radius: 40, shadow: false,
    ...extra,
  };
}
function ringOf(source: DetailLayerSource, phone = false): DetailRing {
  const field = detailField(source, meadowFiles());
  return new DetailRing(field, ringShape(field, source.radius, phone));
}
function cellBytes(ring: DetailRing, cx: number, cz: number): number[] {
  const at = ring.slotOf(cx, cz) * ring.shape.slots * 16;
  return [...ring.matrices.subarray(at, at + ring.shape.slots * 16)];
}

test('the same cell grows the same clumps after the ring moves away and back', () => {
  const ring = ringOf(meadow());
  ring.update(-30, 0);
  const cx = Math.floor(-30 / RING_CELL), cz = 0;
  const before = cellBytes(ring, cx, cz);
  expect(before.some((value) => value !== 0)).toBe(true);
  ring.update(-30 + ring.shape.side * RING_CELL * 3, 0); // far enough that every slot is reseeded
  expect(cellBytes(ring, cx, cz)).not.toEqual(before);
  ring.update(-30, 0);
  expect(cellBytes(ring, cx, cz)).toEqual(before);
});

test('clumps grow only where the mask is set, on the baked height, scaled within range', () => {
  const ring = ringOf(meadow());
  ring.update(0, 0);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  let grown = 0;
  for (let i = 0; i < ring.matrices.length / 16; i++) {
    if (ring.matrices[i * 16 + 15] === 0) continue;
    m.fromArray(ring.matrices, i * 16).decompose(p, q, s);
    expect(p.x).toBeLessThan(0); // the east half's mask is 0
    expect(p.y).toBeCloseTo(1.5, 3);
    expect(s.x).toBeGreaterThanOrEqual(0.5 - 1e-5); expect(s.x).toBeLessThanOrEqual(1 + 1e-5);
    grown++;
  }
  expect(grown).toBe(ring.live());
  // a full 1 m mask cell at 2 clumps: a 4 m ring cell expects 32, on 32 slots, so every west slot grows
  expect(ring.shape.slots).toBe(32);
  expect(grown).toBe(ring.shape.side * (ring.shape.side / 2) * 32);
});

test('the phone grows half the radius and fills half the slots', () => {
  const desk = ringOf(meadow()), phone = ringOf(meadow(), true);
  expect(phone.shape.radius).toBe(desk.shape.radius / 2);
  expect(phone.shape.slots).toBe(desk.shape.slots / 2);
  expect(phone.shape.side).toBe(desk.shape.side / 2);
  desk.update(-10, 0); phone.update(-10, 0);
  expect(phone.matrices.length).toBe(desk.matrices.length / 8);
  expect(ringShape({ cell: 0.5, clumps: 64 }, 40, false).slots).toBe(96); // capped
});

test('two layers seed differently; a budget spreads the reseed over frames', () => {
  expect(layerSeed('grass')).not.toBe(layerSeed('ferns'));
  const ringA = ringOf(meadow({ clumps: 1 })), ringB = ringOf(meadow({ id: 'ferns', clumps: 1 }));
  ringA.update(-30, 0); ringB.update(-30, 0);
  expect(cellBytes(ringA, -8, 0)).not.toEqual(cellBytes(ringB, -8, 0));
  ringA.take();
  expect(ringA.update(-30 + RING_CELL, 0, 3)).toBe(3);
  expect(ringA.take()).toHaveLength(3);
  expect(ringA.update(-30 + RING_CELL, 0, Infinity)).toBe(ringA.shape.side - 3);
});

test('a layer draws in one call: one InstancedMesh over the ring tables', () => {
  const material = new THREE.MeshStandardMaterial();
  const layer = new DetailLayer(meadow({ sway: { amount: 0.3, rate: 0.8 } }), meadowFiles(), material, { phone: false });
  layer.update({ x: -30, z: 0 });
  const meshes: THREE.Object3D[] = [];
  layer.mesh.traverse((node) => { if ((node as THREE.Mesh).isMesh) meshes.push(node); });
  expect(meshes).toHaveLength(1);
  expect(layer.mesh.instanceMatrix.array).toBe(layer.ring.matrices);
  expect(layer.mesh.count).toBe(layer.ring.shape.side ** 2 * layer.ring.shape.slots);
  expect(layer.mesh.geometry.getIndex()?.count).toBe(3);
  expect(layer.mesh.material).not.toBe(material); // the sway patch stays on the layer's clone
  layer.dispose();
});

// review MUSTs: the clone keeps the look's own patches, a wind-patched look gets the wind field once, and every layer fades
// to nothing at the ring's edge
test("the layer's material keeps the look's patches, declares the wind once and fades at the ring's edge", () => {
  const material = new THREE.MeshStandardMaterial();
  patchShader(material, 'test.look-wind', PATCH_ORDER.decorate - 1, (shader) => {
    patchWindField(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n// look-mark');
  }, { key: 'look-wind' });
  const layer = new DetailLayer(meadow({ sway: { amount: 0.3, rate: 0.8 } }), meadowFiles(), material, { phone: false });
  const look = layer.mesh.material as THREE.Material;
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  look.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
  expect(shader.vertexShader).toContain('// look-mark');
  expect(shader.vertexShader.split('uniform float uWindTime').length - 1).toBe(1);
  expect(shader.vertexShader).toContain('smoothstep( uDetailRadius - uDetailFade, uDetailRadius, ringDist )');
  expect(shader.uniforms['uDetailRadius']?.value).toBe(layer.ring.shape.radius);
  expect(shader.uniforms['uDetailFade']?.value).toBe(ringFade(layer.ring.shape.radius));
  layer.dispose();
});
