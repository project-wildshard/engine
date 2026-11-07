import {expect, test} from 'vitest';
import * as THREE from 'three';
import {vertexNormalSteps} from './Terrain';

const CHUNK_STEP = 8192;
// Immutable pre-cut algorithm: compare every intermediate byte as well as the final stock result.
function* predecessorNormals(geo: THREE.BufferGeometry): Generator<void, void, undefined> {
  const index = geo.getIndex(), position = geo.getAttribute('position'), normal = geo.getAttribute('normal');
  if (index === null || !(normal instanceof THREE.BufferAttribute) || normal.count !== position.count) { geo.computeVertexNormals(); return; }
  for (let i = 0; i < normal.count; i++) { if (i > 0 && i % (CHUNK_STEP * 4) === 0) yield; normal.setXYZ(i, 0, 0, 0); }
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    if (i > 0 && i % (CHUNK_STEP * 3) === 0) yield;
    const vA = index.getX(i), vB = index.getX(i + 1), vC = index.getX(i + 2);
    pA.fromBufferAttribute(position, vA); pB.fromBufferAttribute(position, vB); pC.fromBufferAttribute(position, vC);
    cb.subVectors(pC, pB); ab.subVectors(pA, pB); cb.cross(ab);
    nA.fromBufferAttribute(normal, vA); nB.fromBufferAttribute(normal, vB); nC.fromBufferAttribute(normal, vC);
    nA.add(cb); nB.add(cb); nC.add(cb);
    normal.setXYZ(vA, nA.x, nA.y, nA.z); normal.setXYZ(vB, nB.x, nB.y, nB.z); normal.setXYZ(vC, nC.x, nC.y, nC.z);
  }
  yield;
  const v = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    if (i > 0 && i % (CHUNK_STEP * 2) === 0) yield;
    v.fromBufferAttribute(normal, i); v.normalize(); normal.setXYZ(i, v.x, v.y, v.z);
  }
  normal.needsUpdate = true;
}
function terrain(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(500, 500, 255, 255);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) position.setY(i, 12 * Math.sin(position.getX(i) * .013) + 7 * Math.cos(position.getZ(i) * .021));
  return geometry;
}
function equalNormals(actual: THREE.BufferGeometry, expected: THREE.BufferGeometry): void {
  const a = actual.getAttribute('normal').array, b = expected.getAttribute('normal').array;
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), reference = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  expect(bytes.length).toBe(reference.length);
  let firstMismatch = -1;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== reference[i]) { firstMismatch = i; break; }
  expect(firstMismatch).toBe(-1);
}
function compareSteps(actual: THREE.BufferGeometry, expected: THREE.BufferGeometry, atYield?: (geometry: THREE.BufferGeometry, yieldIndex: number) => void): number {
  const aNormal = actual.getAttribute('normal'), bNormal = expected.getAttribute('normal');
  if (!(aNormal instanceof THREE.BufferAttribute) || !(bNormal instanceof THREE.BufferAttribute)) throw new Error('Missing normal buffer');
  const aVersion = aNormal.version, bVersion = bNormal.version;
  const next = vertexNormalSteps(actual), old = predecessorNormals(expected);
  let yields = 0;
  while (true) {
    const a = next.next(), b = old.next();
    expect(a.done).toBe(b.done); equalNormals(actual, expected);
    if (a.done) break;
    yields++;
    atYield?.(actual, yields); atYield?.(expected, yields);
  }
  expect(aNormal.version - aVersion).toBe(1); expect(bNormal.version - bVersion).toBe(1);
  return yields;
}

test('every terrain normal byte and all intermediate yield boundaries match the predecessor and stock Three', () => {
  const actual = terrain(), expected = actual.clone(), stock = actual.clone();
  try {
    expect(compareSteps(actual, expected)).toBe(20);
    stock.computeVertexNormals(); equalNormals(actual, stock);
  } finally { actual.dispose(); expected.dispose(); stock.dispose(); }
});

for (const custom of [false, true]) test(`resuming after a yield reads replacement arrays${custom ? ' and honors a new custom reader' : ''}`, () => {
  const actual = terrain(), expected = actual.clone();
  try {
    compareSteps(actual, expected, (geometry, index) => {
      if (index !== 3) return;
      const position = geometry.getAttribute('position');
      if (!(position instanceof THREE.BufferAttribute)) throw new Error('Missing position');
      position.array = Float32Array.from(position.array, value => value + .125);
      const normal = geometry.getAttribute('normal');
      if (!(normal instanceof THREE.BufferAttribute)) throw new Error('Missing normal');
      normal.array = Float32Array.from(normal.array, value => value * .5);
      if (custom) {
        const getY = position.getY.bind(position);
        position.getY = i => getY(i) + Math.sin(i);
      }
    });
  } finally { actual.dispose(); expected.dispose(); }
});

test('repeated indices, degenerate faces and nonfinite coordinates keep the predecessor bytes', () => {
  const actual = new THREE.BufferGeometry();
  actual.setAttribute('position', new THREE.Float32BufferAttribute([0, -0, 0, 1, 2, 3, -3, 2, 1, Number.NaN, Infinity, -Infinity], 3));
  actual.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  actual.setIndex([0, 0, 1, 1, 2, 1, 0, 1, 2, 1, 2, 3]);
  const expected = actual.clone();
  try { compareSteps(actual, expected); } finally { actual.dispose(); expected.dispose(); }
});

for (const kind of ['normalized', 'interleaved', 'custom', 'array-accessor'] as const) {
  test(`${kind} attributes keep their existing reader and writer semantics`, () => {
    const make = (): THREE.BufferGeometry => {
      const geometry = new THREE.PlaneGeometry(2, 3, 4, 4), position = geometry.getAttribute('position');
      if (kind === 'normalized') {
        geometry.setAttribute('position', new THREE.Int16BufferAttribute(Int16Array.from(position.array, value => value * 300), 3, true));
        geometry.setAttribute('normal', new THREE.Int16BufferAttribute(new Int16Array(position.count * 3), 3, true));
      } else if (kind === 'interleaved') {
        geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(Float32Array.from(position.array), 3), 3, 0));
      } else if (kind === 'array-accessor') {
        const array = position.array;
        Object.defineProperty(position, 'array', {get: () => array});
      } else {
        const getY = position.getY.bind(position);
        position.getY = i => getY(i) + Math.sin(i);
      }
      return geometry;
    };
    const actual = make(), expected = make();
    try { compareSteps(actual, expected); } finally { actual.dispose(); expected.dispose(); }
  });
}
