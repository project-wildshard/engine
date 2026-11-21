// meta IPHONE13-DRIFTWOOD DW12 (mini-dw12): the outer road deck goes to the GPU a band a frame, at most N bytes a frame,
// and what is drawn afterwards is the same geometry, byte for byte.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, DataArrayTexture, DataTexture, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { RoadMapShare } from './roadResources';
import { Scope } from '@wildshard/engine/app/scope';
import { DECK_UPLOAD_BAND_BYTES, deckUploadBands, roadDeckPaced, stageRoadDeck } from './roadDeckUpload';
import { installPlatformRoad, installPlatformRoadSliced, type PlatformRoadInput } from './roadLookPlatform';
import type { PlatformRenderAdmission } from './renderResidency';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { generatePlatform, type PlatformCell, type StripProfile } from '@wildshard/engine/sim/strips';

const MiB = 1024 * 1024;
const isMesh = (object: Object3D | undefined): object is Mesh => object instanceof Mesh;

/** A deck with Driftwood's outer deck shape: 470k vertices of position, normal, colour and grain (13 floats) and 1.4M indices. */
function driftwoodSizedDeck(): Mesh {
  const vertices = 470_000, geometry = new BufferGeometry();
  const fill = (n: number, size: number): Float32Array => { const a = new Float32Array(n * size); for (let i = 0; i < a.length; i++) a[i] = ((i * 2654435761) % 1000) / 1000; return a; };
  geometry.setAttribute('position', new BufferAttribute(fill(vertices, 3), 3)).setAttribute('normal', new BufferAttribute(fill(vertices, 3), 3))
    .setAttribute('color', new BufferAttribute(fill(vertices, 3), 3)).setAttribute('grainUv', new BufferAttribute(fill(vertices, 4), 4));
  const index = new Uint32Array(1_400_000); for (let i = 0; i < index.length; i++) index[i] = i % vertices;
  geometry.setIndex(new BufferAttribute(index, 1));
  return new Mesh(geometry, new MeshBasicMaterial());
}

/** three's upload rule, in Node: each drawn frame every mesh in the scene uploads the attributes (and index) of its
 *  geometry it has not uploaded before, keyed by the attribute object (WebGLAttributes). Returns bytes per frame. */
function fakeRenderer(scene: Object3D, only: (mesh: Mesh) => boolean = () => true): { frame: () => Promise<void>; uploads: number[]; seen: Set<object> } {
  const seen = new Set<object>(), uploads: number[] = [];
  const frame = (): Promise<void> => {
    let bytes = 0;
    scene.traverse(object => {
      if (!isMesh(object) || !only(object)) return;
      const geometry = object.geometry;
      for (const attribute of [...Object.values(geometry.attributes), ...(geometry.index === null ? [] : [geometry.index])]) {
        if (seen.has(attribute)) continue;
        seen.add(attribute); bytes += (attribute as BufferAttribute).array.byteLength;
      }
    });
    uploads.push(bytes);
    return Promise.resolve();
  };
  return { frame, uploads, seen };
}

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

test('a Driftwood-sized deck goes up in bands of at most 8 MiB a frame, each channel once, then draws with nothing left to upload', async () => {
  const deck = driftwoodSizedDeck(), scene = new Group(), before = digest(deck.geometry), attributes = { ...deck.geometry.attributes }, index = deck.geometry.index;
  const total = Object.values(deck.geometry.attributes).reduce((n, a) => n + (a as BufferAttribute).array.byteLength, 0) + (index?.array.byteLength ?? 0);
  expect(total).toBeGreaterThan(20 * MiB); // the single-frame burst it replaces
  const gpu = fakeRenderer(scene);
  const bands = await stageRoadDeck(deck, scene, async () => {
    expect(scene.children.includes(deck)).toBe(false);
    expect(scene.children.filter(child => child.name === 'grid-deck-upload')).toHaveLength(1);
    await gpu.frame();
  });
  expect(bands.length).toBeGreaterThan(1);
  expect(gpu.uploads).toHaveLength(bands.length);
  for (const bytes of gpu.uploads) expect(bytes).toBeLessThanOrEqual(DECK_UPLOAD_BAND_BYTES);
  expect(gpu.uploads.reduce((n, b) => n + b, 0)).toBe(total);
  expect(scene.children).toHaveLength(0); // the stand-in is gone
  // the deck itself: the same attribute objects, the same bytes, and its first draw uploads nothing
  expect(deck.geometry.index).toBe(index);
  for (const [name, attribute] of Object.entries(attributes)) expect(deck.geometry.getAttribute(name)).toBe(attribute);
  expect(digest(deck.geometry)).toBe(before);
  scene.add(deck); await gpu.frame();
  expect(gpu.uploads.at(-1)).toBe(0);
});

test('bands keep geometry order, never split a channel and put an oversized channel alone', () => {
  const geometry = new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array(300), 3)).setAttribute('normal', new BufferAttribute(new Float32Array(300), 3))
    .setAttribute('grainUv', new BufferAttribute(new Float32Array(4000), 4)).setIndex(new BufferAttribute(new Uint32Array(100), 1));
  expect(deckUploadBands(geometry, 4096)).toEqual([
    { names: ['position', 'normal'], index: false, bytes: 2400 },
    { names: ['grainUv'], index: false, bytes: 16000 },
    { names: [], index: true, bytes: 400 },
  ]);
  expect(deckUploadBands(geometry, 1e9)).toEqual([{ names: ['position', 'normal', 'grainUv'], index: true, bytes: 18800 }]);
  expect(() => deckUploadBands(geometry, 0)).toThrow(RangeError);
});

test('the slot: off unless true (DW12 measured no peak change)', () => {
  expect(roadDeckPaced(null)).toBe(false);
  expect(roadDeckPaced(true)).toBe(true);
  for (const off of [false, 'false', 'off', 0]) expect(roadDeckPaced(off)).toBe(false);
});

/** One cell with a shaped north and east edge (compiled-grid-strips.test.ts's `native`): seams, so the deck has parts. */
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

function roadInput(scope: Scope, scene: Group): PlatformRoadInput {
  const admission: PlatformRenderAdmission = { allocate: (plan, factory) => factory(scope.child(plan.id)) };
  // the canvases (asphalt, junctions) and the grain arrive shared, as a split road's second half gets them (no DOM here)
  const maps = new RoadMapShare();
  maps.hold('road.deck-grain', new DataArrayTexture(new Uint8Array(4), 1, 1, 1));
  for (const id of ['road.asphalt', 'road.junctions']) maps.hold(id, new DataTexture(new Uint8Array(4), 1, 1));
  return { scope, admission, maps, strips: strips(), pitch: CONTENT_CAPS.pitch, scene, plans: new Map(), voidFloor: false,
    home: { instance: 'probe', slug: 'probe', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } },
    signs: layout => new Uint8Array(layout.width * layout.height * 2),
    layout: { segments: [], junctions: [], signs: [], lights: [], holes: [],
      rail: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, edge: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } } };
}

test('the sliced road stages its deck before the deck joins the scene, and builds the same deck byte for byte', async () => {
  const plainScope = new Scope('plain road'), stagedScope = new Scope('staged road');
  try {
    const plainScene = new Group();
    installPlatformRoad(roadInput(plainScope, plainScene));
    const plainDeck = plainScene.getObjectByName('grid-deck');
    if (!isMesh(plainDeck)) throw new Error('no plain deck');

    const stagedScene = new Group(), gpu = fakeRenderer(stagedScene, mesh => mesh.name === 'grid-deck-upload' || mesh.name === 'grid-deck');
    let staged: Mesh | undefined, bands = 0;
    await installPlatformRoadSliced(roadInput(stagedScope, stagedScene), () => Promise.resolve(), {
      stageDeck: async deck => {
        expect(deck.name).toBe('grid-deck');
        expect(stagedScene.getObjectByName('grid-deck')).toBeUndefined();
        staged = deck;
        bands = (await stageRoadDeck(deck, stagedScene, gpu.frame, 2048)).length;
      },
    });
    const stagedDeck = stagedScene.getObjectByName('grid-deck');
    expect(stagedDeck).toBe(staged);
    await gpu.frame();
    expect(bands).toBeGreaterThan(1);
    // no frame uploads more than the band size, unless one channel alone is larger (it then goes alone)
    const geometry = (staged as Mesh).geometry, channels = [...Object.values(geometry.attributes), ...(geometry.index === null ? [] : [geometry.index])];
    const largest = Math.max(...channels.map(a => (a as BufferAttribute).array.byteLength));
    for (const bytes of gpu.uploads) expect(bytes).toBeLessThanOrEqual(Math.max(2048, largest));
    expect(gpu.uploads.at(-1)).toBe(0); // the deck's own first draw: everything was already up
    if (!isMesh(stagedDeck)) throw new Error('no staged deck');
    expect(digest(stagedDeck.geometry)).toBe(digest(plainDeck.geometry));
    expect(stagedDeck.material).not.toBe(plainDeck.material);
  } finally { plainScope.dispose(); stagedScope.dispose(); }
});
