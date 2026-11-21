// meta IPHONE13-DRIFTWOOD DW12 (mini-dw12b): the outer road's construction holds less at once. The deck's merge drops each
// solid part as soon as it is copied, the clip writes its cut vertices into room the merge left instead of copying every
// channel again, and what is drawn is the same geometry, byte for byte.
import { expect, test } from 'vitest';
import { DataArrayTexture, DataTexture, Group, Mesh, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import { RoadMapShare } from './roadResources';
import { Scope } from '@wildshard/engine/app/scope';
import { installPlatformRoad, type PlatformRoadInput } from './roadLookPlatform';
import type { PlatformRenderAdmission } from './renderResidency';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { generatePlatform, type PlatformCell, type StripProfile } from '@wildshard/engine/sim/strips';
import { solidGeometryDrainSteps, solidGeometrySteps, solidSource, SOLID_FLOATS, type SolidPart } from './roadSolid';
import { clipToBinsSteps, meshBytesSteps, ROAD_LOD } from './roadCull';
import { roadBuildLean } from './roadBuildLean';

const isMesh = (object: Object3D | undefined): object is Mesh => object instanceof Mesh;
const run = <T>(steps: Generator<void, T>): T => { for (;;) { const next = steps.next(); if (next.done === true) return next.value; } };

/** Every attribute's name, item size and bytes, the index's bytes and the draw range, as one FNV-1a word and a length. */
const digest = (geometry: BufferGeometry): string => {
  let hash = 0x811c9dc5, length = 0;
  const feed = (bytes: Uint8Array): void => { for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0; length += bytes.length; };
  const text = (value: string): void => { feed(new TextEncoder().encode(value)); };
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const array = (attribute as BufferAttribute).array;
    text(`${name}:${String(attribute.itemSize)}:`); feed(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  const index = geometry.getIndex();
  if (index !== null) { text('index:'); feed(new Uint8Array(index.array.buffer, index.array.byteOffset, index.array.byteLength)); }
  text(`range:${String(geometry.drawRange.start)}:${String(geometry.drawRange.count)}`);
  return `${hash.toString(16)}:${String(length)}`;
};

/** A strip of `quads` quads along x from `x0`, crossing bin lines (so the clip cuts it), one layer, `seed` varies values. */
function part(x0: number, quads: number, seed: number, layer: number): SolidPart {
  const vertices = (quads + 1) * 2, positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colours = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2), grain = new Float32Array(vertices * 2), indices = new Uint32Array(quads * 6);
  for (let q = 0; q <= quads; q++) for (let s = 0; s < 2; s++) {
    const v = q * 2 + s;
    positions.set([x0 + q * 7.3, ((q * 13 + seed) % 17) / 4, s * 9.1 + seed], v * 3);
    normals.set([0, 1, 0], v * 3); colours.set([((q + seed) % 5) / 5, s, 0.5], v * 3);
    uvs.set([q * 0.25, s], v * 2); grain.set([layer, 0], v * 2);
  }
  for (let q = 0; q < quads; q++) indices.set([q * 2, q * 2 + 1, q * 2 + 2, q * 2 + 1, q * 2 + 3, q * 2 + 2], q * 6);
  return { positions, normals, colours, uvs, grain, indices };
}
// 4,500 quads = 9,002 vertices a part: past the merge's 8,192-vertex step, so it pauses after every part
const parts = (): SolidPart[] => [part(-400, 4500, 1, 0), part(-380, 4500, 2, 1), part(-350, 4500, 3, 2), part(-300, 4500, 4, 4)];

test('the lean merge drops each part as soon as it is copied, and merges the same bytes', () => {
  const originals = parts(), drained = [...originals];
  const plain = run(solidGeometrySteps(originals));
  const steps = solidGeometryDrainSteps(drained);
  let pauses = 0;
  for (;;) {
    const next = steps.next(); if (next.done === true) { expect(digest(next.value)).toBe(digest(plain)); break; }
    // after the k-th pause the first k parts are copied: the list holds none of their arrays any more
    for (let k = 0; k < Math.min(pauses, originals.length); k++) {
      const held = drained[k];
      expect(held === undefined || (held !== originals[k] && held.positions.length === 0)).toBe(true);
    }
    pauses++;
  }
  expect(pauses).toBeGreaterThanOrEqual(originals.length);
  expect(drained).toHaveLength(0);
});

test('with the clip count, the merge leaves room and the clip writes its cut vertices there: no second copy of any channel', () => {
  const plain = run(solidGeometrySteps(parts()));
  run(clipToBinsSteps(plain, CONTENT_CAPS.pitch));
  const source = parts(), bytes = run(meshBytesSteps(source.map(solidSource), SOLID_FLOATS, { pitch: CONTENT_CAPS.pitch, lod: ROAD_LOD }, true));
  expect(bytes.clipped).toBeGreaterThan(source.reduce((n, p) => n + p.positions.length / 3, 0)); // the clip does cut
  const lean = run(solidGeometryDrainSteps(source, bytes.clipped));
  const buffers = Object.fromEntries(Object.entries(lean.attributes).map(([name, a]) => [name, (a as BufferAttribute).array.buffer]));
  run(clipToBinsSteps(lean, CONTENT_CAPS.pitch));
  for (const [name, attribute] of Object.entries(lean.attributes)) {
    const array = (attribute as BufferAttribute).array;
    expect(array.buffer).toBe(buffers[name]); // the merge's own allocation, filled in place
    expect(array.byteOffset).toBe(0); expect(array.buffer.byteLength).toBe(array.byteLength); // tight: nothing spare kept
  }
  expect(digest(lean)).toBe(digest(plain));
});

/** One cell with a shaped north and east edge (road-deck-upload.test.ts's `strips`): seams, so the deck has parts. */
function strips(): ReturnType<typeof generatePlatform> {
  const count = 257, empty: StripProfile = { roadHeight: 0, heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.25, 0.25, 0.25]) };
  const profile: StripProfile = { roadHeight: 0,
    heights: Array.from({ length: count }, (_, i) => i === 0 || i === count - 1 || Math.abs(-250 + i * 500 / (count - 1)) < 12 ? 0 : i % 31 - 10),
    colours: Array.from({ length: count }, (_, i) => i === 0 || i === count - 1 ? [0.25, 0.25, 0.25] : [0.125, (i % 7) / 7, (i % 11) / 11]) };
  const observed = { entryWidth: 8, waterSurface: 0, geometry: 'ground' as const, sourceSurface: 'terrain', outflows: [{ from: -30, to: -15 }] };
  const cells: PlatformCell[] = [{ instance: 'probe', cell: [0, 0], origin: { x: 0, z: 0 },
    edges: { north: profile, east: profile, south: empty, west: empty }, observations: { north: observed, east: observed, south: { entryWidth: 0 }, west: { entryWidth: 0 } } }];
  return generatePlatform(cells, empty);
}

function roadInput(scope: Scope, scene: Group, lean: boolean): PlatformRoadInput {
  const admission: PlatformRenderAdmission = { allocate: (plan, factory) => factory(scope.child(plan.id)) };
  const maps = new RoadMapShare();
  maps.hold('road.deck-grain', new DataArrayTexture(new Uint8Array(4), 1, 1, 1));
  for (const id of ['road.asphalt', 'road.junctions']) maps.hold(id, new DataTexture(new Uint8Array(4), 1, 1));
  return { scope, admission, maps, strips: strips(), pitch: CONTENT_CAPS.pitch, scene, plans: new Map(), voidFloor: false, lean,
    home: { instance: 'probe', slug: 'probe', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } },
    signs: layout => new Uint8Array(layout.width * layout.height * 2),
    layout: { segments: [], junctions: [], signs: [], lights: [], holes: [],
      rail: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, edge: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } } };
}

test('a lean road builds the same deck, curtain and cull plans byte for byte', () => {
  const plainScope = new Scope('plain road'), leanScope = new Scope('lean road');
  try {
    const plainScene = new Group(), leanScene = new Group();
    const plainInput = roadInput(plainScope, plainScene, false), leanInput = roadInput(leanScope, leanScene, true);
    installPlatformRoad(plainInput); installPlatformRoad(leanInput);
    for (const name of ['grid-deck', 'grid-seam-curtain']) {
      const a = plainScene.getObjectByName(name), b = leanScene.getObjectByName(name);
      if (!isMesh(a) || !isMesh(b)) throw new Error(`no ${name}`);
      expect(digest(b.geometry)).toBe(digest(a.geometry));
      const pa = plainInput.plans.get(a), pb = leanInput.plans.get(b);
      expect(pb?.source).toEqual(pa?.source); expect(pb?.bins).toEqual(pa?.bins);
    }
  } finally { plainScope.dispose(); leanScope.dispose(); }
});

test('the slot: unset is the default, false or true wins', () => {
  expect(roadBuildLean(true)).toBe(true);
  for (const off of [false, 'false', 'off', 0]) expect(roadBuildLean(off)).toBe(false);
  expect(typeof roadBuildLean(null)).toBe('boolean');
});
