import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { seamLookGeometrySteps, seamSolidSteps } from '../src/client/game/grid/seamLook';
import { SEAM_BUCKETS, type SeamPiece } from '../src/shared/game/grid/seamGeometry';
import { linear, splitByKey, tintedPart, uniformPart, type GrainLayer } from '../src/client/game/grid/roadSolid';

/** a strip of a jittered height grid: shared vertices, so normals accumulate across faces */
function strip(seed: number, ox: number, oz: number): SeamPiece {
  const side = 24, positions = new Float32Array(side * side * 3), colours = new Float32Array(side * side * 3).fill(0.25), indices: number[] = [];
  let s = seed;
  const rand = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const k = (j * side + i) * 3;
    positions[k] = i * 1.7 + rand() * 0.3; positions[k + 1] = rand() * 2.5; positions[k + 2] = j * 1.3 + rand() * 0.3;
  }
  for (let j = 0; j < side - 1; j++) for (let i = 0; i < side - 1; i++) {
    const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const index = new Uint32Array(indices), third = Math.floor(index.length / 9) * 3;
  return { mesh: { origin: { x: ox, z: oz }, positions, colours, indices: index },
    features: [{ kind: 'deck', firstIndex: 0, indexCount: third }, { kind: 'cliff', firstIndex: third, indexCount: third }, { kind: 'road-wall', firstIndex: 2 * third, indexCount: third }] };
}

test('the seam merge in steps yields between strips and keeps three\'s own normal and bounding-sphere bytes', () => {
  const pieces = [strip(1, 0, 0), strip(2, 40, -12), strip(3, -25, 31)], home = { origin: { x: 5, z: -3 } };
  const steps = seamLookGeometrySteps(pieces, home, undefined, 562.5);
  let yields = 0, result: ReturnType<typeof steps.next>;
  for (result = steps.next(); result.done !== true; result = steps.next()) yields++;
  const { geometry, state } = result.value;
  expect(yields).toBeGreaterThanOrEqual(pieces.length);
  expect(state.triangles).toBe(pieces.reduce((n, p) => n + p.mesh.indices.length / 3, 0));
  // three's whole calls on the same merged positions and index
  const index = geometry.getIndex();
  if (index === null) throw new Error('Missing merged index');
  const reference = new BufferGeometry().setAttribute('position', geometry.getAttribute('position').clone()).setIndex(index.clone());
  reference.computeVertexNormals(); reference.computeBoundingSphere();
  expect(Buffer.from(new Float32Array(geometry.getAttribute('normal').array).buffer)).toEqual(Buffer.from(new Float32Array(reference.getAttribute('normal').array).buffer));
  expect(geometry.boundingSphere?.center.toArray()).toEqual(reference.boundingSphere?.center.toArray());
  expect(geometry.boundingSphere?.radius).toBe(reference.boundingSphere?.radius);
  expect(geometry.getAttribute('normal')).toBeInstanceOf(BufferAttribute);
});

test('palette lookup preserves negative-zero bins, neighbour order and explicit surfaces', () => {
  const positions = Float32Array.of(-2, 0, 0, 0, 0, 0, 2, 0, 0, 1, 3, 0, 0, 4, 1, -1, 2, 0);
  const colours = Float32Array.of(0.1, 0.1, 0.8, 0.8, 0.1, 0.1, 0.1, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const grey = [0.32, 0.3, 0.28], expectedGround = [2, 1, 1];
  for (const resolved of [false, true]) {
    const piece: SeamPiece = { mesh: { origin: { x: 0, z: 0 }, positions, colours, indices: Uint32Array.of(0, 1, 2, 3, 4, 5) },
      features: [{ kind: 'deck', firstIndex: 0, indexCount: 3 }, { kind: 'cliff', firstIndex: 3, indexCount: 3, sourceSurface: 'soil' }] };
    const surface = [0.4, 0.2, 0.6] as const;
    const steps = seamLookGeometrySteps([piece], { origin: { x: 0, z: 0 } }, resolved ? () => surface : undefined);
    let result = steps.next(); while (!result.done) result = steps.next();
    const geometry = result.value.geometry, actual = geometry.getAttribute('color');
    try {
      for (let k = 0; k < expectedGround.length; k++) for (let c = 0; c < 3; c++) {
        const g = expectedGround[k] ?? 0, own = resolved ? surface[c] ?? 0 : colours[g * 3 + c] ?? 0;
        expect(actual.array[(k + 3) * 3 + c]).toBe(Math.fround((own * 0.6 + (grey[c] ?? 0) * 0.4) * 0.9));
      }
    } finally { geometry.dispose(); }
  }
});

test('the final native index preserves feature order, first ownership and ground fallback across strips', () => {
  const first = strip(91, 12, -7), second = strip(27, -4, 9);
  const features = [
    { kind: 'cliff', firstIndex: 9, indexCount: 9 },
    { kind: 'road-wall', firstIndex: 3, indexCount: 9 },
    { kind: 'deck', firstIndex: 0, indexCount: 6 },
    { kind: 'new-feature', firstIndex: 18, indexCount: 3 },
    { kind: 'parapet', firstIndex: 21, indexCount: 6 },
  ];
  const pieces = [{ ...first, features }, { ...second, features: [...features].reverse() }], buckets = ['ground', 'stone', 'rock', 'dike', 'rail', 'curtain'];
  const expected = new Map(buckets.map(bucket => [bucket, [] as number[]]));
  let base = 0;
  for (const piece of pieces) {
    const named = new Set<number>();
    for (const feature of piece.features) {
      const bucket = feature.kind === 'cliff' ? 'rock' : feature.kind === 'road-wall' ? 'curtain' : feature.kind === 'parapet' ? 'stone' : 'ground';
      for (let i = feature.firstIndex; i < feature.firstIndex + feature.indexCount; i++) {
        if (named.has(i)) continue; named.add(i); expected.get(bucket)?.push((piece.mesh.indices[i] ?? 0) + base);
      }
    }
    for (let i = 0; i < piece.mesh.indices.length; i++) if (!named.has(i)) expected.get('ground')?.push((piece.mesh.indices[i] ?? 0) + base);
    base += piece.mesh.positions.length / 3;
  }
  const steps = seamLookGeometrySteps(pieces, { origin: { x: 0, z: 0 } });
  let done = steps.next(); while (!done.done) done = steps.next();
  try {
    expect(done.value.geometry.index?.array).toEqual(Uint32Array.from(buckets.flatMap(bucket => expected.get(bucket) ?? [])));
    let start = 0;
    const groups = buckets.flatMap((bucket, materialIndex) => {
      const count = expected.get(bucket)?.length ?? 0; if (count === 0) return [];
      const group = { start, count, materialIndex }; start += count; return [group];
    });
    expect(done.value.geometry.groups).toEqual(groups);
  } finally { done.value.geometry.dispose(); }
});

test.each([false, true])('grouped seam parts retain every original split channel and local index (sparse %s)', sparse => {
  const a = strip(8, 7, -11), b = strip(19, -31, 23);
  if (sparse) a.mesh.indices[45] = 4_000_000_000;
  const kinds = ['deck', 'parapet', 'cliff', 'dike', 'guard-rail', 'road-wall'];
  const pieces = [a, b].map((piece, pieceIndex): SeamPiece => ({ mesh: piece.mesh, features: kinds.map((kind, index) => ({ kind,
    firstIndex: index * 30, indexCount: 30, sourceSurface: pieceIndex === 0 ? 'soil' : 'rock' })) }));
  const home = { origin: { x: 5, z: -3 } }, layers: readonly GrainLayer[] = ['gravel', 'stone', 'strata', 'riprap', 'white', 'white'];
  const vertices = pieces.reduce((sum, piece) => sum + piece.mesh.positions.length / 3, 0);
  const channels = sparse ? { origin: home.origin, pitch: 562.5, normals: new Float32Array(vertices * 3).fill(0.25), uvs: new Float32Array(vertices * 2).fill(-0), sphere: { centre: [0, 0, 0] as const, radius: 100 } } : undefined;
  const surfaces = () => [0.3, 0.2, 0.7] as const;
  const referenceSteps = seamLookGeometrySteps(pieces, home, surfaces, 562.5, channels);
  let reference = referenceSteps.next(); while (!reference.done) reference = referenceSteps.next();
  const geometry = reference.value.geometry, buckets = new Int8Array((geometry.index?.count ?? 0) / 3).fill(-1);
  for (const group of geometry.groups) buckets.fill(group.materialIndex ?? 0, group.start / 3, (group.start + group.count) / 3);
  const split = splitByKey(geometry, triangle => buckets[triangle] ?? 0, SEAM_BUCKETS.length);
  const expected = split.flatMap((part, index) => {
    const bucket = SEAM_BUCKETS[index]; if (part.indices.length === 0 || bucket === 'curtain') return [];
    const layered = uniformPart(part, layers[index] ?? 'white', bucket === 'rail');
    return [bucket === 'stone' ? tintedPart(layered, linear(0xc9c4b8)) : bucket === 'dike' ? tintedPart(layered, linear(0xe0dcd2)) : bucket === 'rail' ? tintedPart(layered, new Color(0x38e6ff).multiplyScalar(1.6)) : layered];
  });
  const steps = seamSolidSteps(pieces, home, surfaces, 562.5, channels); let actual = steps.next(); while (!actual.done) actual = steps.next();
  expect(actual.value.state).toEqual(reference.value.state); expect(actual.value.parts).toHaveLength(expected.length);
  for (const [index, part] of expected.entries()) for (const key of ['positions', 'normals', 'colours', 'uvs', 'grain', 'indices'] as const) {
    const value = actual.value.parts[index]?.[key]; if (value === undefined) throw new Error('Missing seam part');
    const bytes = (values: ArrayLike<number>): Buffer => Buffer.from(Uint8Array.from(new Uint8Array((key === 'indices' ? Uint32Array.from(values) : Float32Array.from(values)).buffer)));
    expect(bytes(value)).toEqual(bytes(part[key]));
  }
  const curtain = split[SEAM_BUCKETS.indexOf('curtain')];
  expect(actual.value.curtain.positions).toEqual(curtain?.positions); expect(actual.value.curtain.indices).toEqual(curtain?.indices);
  geometry.dispose();
});
