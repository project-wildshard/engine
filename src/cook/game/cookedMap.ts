/// <reference types="node" />
/** J450 (QA-FEEDBACK 2026-11-19 row 15, Jake: "the map and the minimap should never be broken ... done at cook time"): the cook
 * draws every zone's top-down map from the uploaded shard itself, so no zone needs an author-declared `look/map` to have one.
 *
 * Renderer-free and deterministic: the shard's own render lattice is rasterized straight down in the minimap's frame (north +Z
 * up the image, east −X to the right, the 500 m cell centred, as `scripts/bake-map-glb.mjs` and every baked map are), keeping
 * the highest surface in each pixel. The ground is the terrain tiles' own heights and vertex colours; buildings, walls, paths
 * and trees are the world GLBs' triangles (hierarchy, GPU instancing, meshopt and quantization decoded), each coloured by its
 * material's base colour times its vertex colours times its colour texture's mean; water is the declared pools at their level.
 * Then a hillshade, an ink line where the surface steps up, a short shadow to the south-east, and an exposure that keeps a dark
 * shard readable. Ground with nothing on it shows a plot grid, never a flat square.
 *
 * Pure bytes in, bytes out (a PNG, written with zlib only: the cook job may load no native addon). Every file it cannot read
 * is skipped and counted, never thrown: a map never refuses or fails a cook (SHARD-COMPAT §16). */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {deflateSync, zstdDecompressSync} from 'node:zlib';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createRequire} from 'node:module';
import {glbBuffers, prepareGlbBuffers} from '@wildshard/format/glbBuffers';
import {glbTransform} from '@wildshard/format/glbTriangles';
import {decodeTerrainTile} from '@wildshard/format/terrainTileBytes';

/** 0.49 m a pixel over the 500 m cell: the minimap's ~110 m view is ~225 px of it. The home cell reads this one. */
export const COOKED_MAP_SIZE = 1024;
/** Every other cell's copy, at the size the page keeps a neighbour's map (`minimapBlend.ts` CELL_PX): the Bag map's cells. */
export const COOKED_CELL_SIZE = 400;
const METRES = 500, HALF = METRES / 2;

export interface MapSourceFile {readonly hash: string; readonly path: string; readonly kind: string}
/** What the map reads of an opened product: its file rows, its parsed sections, and checked reads by path. */
export interface MapSource {
  readonly files: readonly MapSourceFile[];
  readonly sections: ReadonlyMap<string, unknown>;
  readonly read: (path: string) => Uint8Array;
}
/** Linear RGB of a colour texture's mean (KTX2 bytes), or undefined when it can't be read. */
export type TextureMean = (bytes: Uint8Array) => readonly [number, number, number] | undefined;
export interface CookedMapStats {
  readonly terrainTiles: number; readonly glbs: number; readonly triangles: number; readonly water: number;
  readonly skipped: number; readonly covered: number;
}
export interface CookedMap {readonly size: number; readonly rgba: Uint8Array; readonly stats: CookedMapStats}

type Rgb = [number, number, number];
const object = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const num = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const toLinear = (c: number): number => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (v: number): number => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

/** The raster: the highest surface per pixel, its linear colour, and what it is (0 nothing, 1 ground, 2 object). */
class Raster {
  readonly size: number; readonly top: Float32Array; readonly rgb: Float32Array; readonly what: Uint8Array; readonly ppm: number;
  triangles = 0;
  constructor(size: number) {
    this.size = size;
    this.top = new Float32Array(size * size).fill(-Infinity); this.rgb = new Float32Array(size * size * 3);
    this.what = new Uint8Array(size * size); this.ppm = size / METRES;
  }
  /** One triangle in shard metres (x, y, z each) with per-vertex linear colour; `kind` 1 ground, 2 object. */
  triangle(a: readonly number[], b: readonly number[], c: readonly number[], ca: Rgb, cb: Rgb, cc: Rgb, kind: number): void {
    const {size, ppm} = this;
    const ax = (HALF - (a[0] ?? 0)) * ppm, ay = (HALF - (a[2] ?? 0)) * ppm, bx = (HALF - (b[0] ?? 0)) * ppm, by = (HALF - (b[2] ?? 0)) * ppm;
    const cx = (HALF - (c[0] ?? 0)) * ppm, cy = (HALF - (c[2] ?? 0)) * ppm;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0 || !Number.isFinite(area)) return;
    const ha = a[1] ?? 0, hb = b[1] ?? 0, hc = c[1] ?? 0;
    // World tiles can contain platforms at any height. Sky and backdrop assets live outside the world file selection.
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) return;
    this.triangles++;
    // walls darker than floors: the face's own slope, before any image-space light
    const ux = (b[0] ?? 0) - (a[0] ?? 0), uy = hb - ha, uz = (b[2] ?? 0) - (a[2] ?? 0), wx = (c[0] ?? 0) - (a[0] ?? 0), wy = hc - ha, wz = (c[2] ?? 0) - (a[2] ?? 0);
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, len = Math.hypot(nx, ny, nz);
    const face = len === 0 ? 1 : 0.6 + 0.4 * Math.abs(ny / len);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const sx = x + 0.5, sy = y + 0.5;
      const w0 = ((bx - sx) * (cy - sy) - (cx - sx) * (by - sy)) / area, w1 = ((cx - sx) * (ay - sy) - (ax - sx) * (cy - sy)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const h = w0 * ha + w1 * hb + w2 * hc, at = y * size + x;
      if (h <= (this.top[at] ?? Infinity)) continue;
      this.top[at] = h; this.what[at] = kind;
      for (let k = 0; k < 3; k++) this.rgb[at * 3 + k] = face * (w0 * (ca[k] ?? 0) + w1 * (cb[k] ?? 0) + w2 * (cc[k] ?? 0));
    }
  }
}

const GROUND: Rgb = [0.16, 0.26, 0.08];
/** A baked terrain tile: its heights on a regular grid, its vertex colours (linear) or the plain ground colour. */
function terrainTile(raster: Raster, bytes: Uint8Array): void {
  const tile = decodeTerrainTile(bytes), r = tile.resolution, step = tile.size / (r - 1), colours = tile.colours;
  const at = (i: number, j: number): number[] => [tile.x + i * step, tile.heights[j * r + i] ?? 0, tile.z + j * step];
  const colour = (i: number, j: number): Rgb => colours === undefined ? GROUND
    : [colours[(j * r + i) * 3] ?? 0, colours[(j * r + i) * 3 + 1] ?? 0, colours[(j * r + i) * 3 + 2] ?? 0];
  for (let j = 0; j + 1 < r; j++) for (let i = 0; i + 1 < r; i++) {
    const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1), p11 = at(i + 1, j + 1);
    const c00 = colour(i, j), c10 = colour(i + 1, j), c01 = colour(i, j + 1), c11 = colour(i + 1, j + 1);
    raster.triangle(p00, p10, p11, c00, c10, c11, 1); raster.triangle(p00, p11, p01, c00, c11, c01, 1);
  }
}

const COMPONENT_BYTES: Readonly<Record<number, number>> = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const TYPE_WIDTH: Readonly<Record<string, number>> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
interface Accessor {readonly n: number; readonly width: number; readonly read: (row: number, c: number) => number}

/** A GLB's JSON and its decoded binary chunk (meshopt streams expanded into plain views). */
function readGlb(bytes: Uint8Array): {readonly doc: Record<string, unknown>; readonly bin: Uint8Array} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB');
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
  const binAt = 20 + jsonLength, physical = binAt + 8 <= bytes.length ? bytes.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true)) : new Uint8Array(0);
  const {bytes: bin} = glbBuffers(doc, physical);
  return {doc, bin};
}

function accessors(doc: Readonly<Record<string, unknown>>, bin: Uint8Array): (index: unknown) => Accessor | undefined {
  const views = array(doc['bufferViews']).map(object), rows = array(doc['accessors']).map(object);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), made = new Map<number, Accessor>();
  return index => {
    if (typeof index !== 'number') return undefined;
    const hit = made.get(index); if (hit !== undefined) return hit;
    const row = rows[index], view = views[num(row?.['bufferView'], -1)];
    const component = num(row?.['componentType'], 0), size = COMPONENT_BYTES[component], width = TYPE_WIDTH[text(row?.['type']) ?? ''];
    if (row === undefined || view === undefined || size === undefined || width === undefined) return undefined;
    const n = num(row['count'], 0), stride = num(view['byteStride'], size * width), base = num(view['byteOffset'], 0) + num(row['byteOffset'], 0);
    const normalized = row['normalized'] === true;
    if (base + (n - 1) * stride + size * width > bin.byteLength) return undefined;
    const raw = (at: number): number => {
      switch (component) {
        case 5120: return data.getInt8(at); case 5121: return data.getUint8(at); case 5122: return data.getInt16(at, true);
        case 5123: return data.getUint16(at, true); case 5125: return data.getUint32(at, true); default: return data.getFloat32(at, true);
      }
    };
    const scale = !normalized ? 1 : component === 5120 ? 127 : component === 5121 ? 255 : component === 5122 ? 32767 : component === 5123 ? 65535 : 1;
    const accessor: Accessor = {n, width, read: (r, c) => { const v = raw(base + r * stride + c * size); return normalized ? Math.max(v / scale, -1) : v; }};
    made.set(index, accessor);
    return accessor;
  };
}

const multiply = (a: readonly number[], b: readonly number[]): number[] => Array.from({length: 16}, (_, i) => {
  let sum = 0; for (let k = 0; k < 4; k++) sum += (a[i % 4 + k * 4] ?? 0) * (b[k + Math.floor(i / 4) * 4] ?? 0);
  return sum;
});
const point = (m: readonly number[], x: number, y: number, z: number): number[] => [
  (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
  (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
  (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0)];

/** Every triangle of one world GLB, in the shard's frame, coloured as `material` says. */
function glbTriangles(raster: Raster, bytes: Uint8Array, material: (doc: Readonly<Record<string, unknown>>, bin: Uint8Array, index: unknown) => Rgb): void {
  const {doc, bin} = readGlb(bytes), accessor = accessors(doc, bin);
  const nodes = array(doc['nodes']).map(object), meshes = array(doc['meshes']).map(object), parents = new Map<number, number>();
  nodes.forEach((node, id) => { for (const child of array(node?.['children'])) if (typeof child === 'number') parents.set(child, id); });
  const worlds = new Map<number, readonly number[]>();
  const world = (id: number, depth = 0): readonly number[] => {
    const hit = worlds.get(id); if (hit !== undefined) return hit;
    const node = nodes[id] ?? {}, parent = parents.get(id), local = glbTransform(node);
    const result = parent === undefined || depth > 64 ? local : multiply(world(parent, depth + 1), local);
    worlds.set(id, result); return result;
  };
  const colours = new Map<unknown, Rgb>();
  const draw = (meshId: unknown, matrix: readonly number[]): void => {
    const mesh = meshes[num(meshId, -1)];
    for (const value of array(mesh?.['primitives'])) {
      const primitive = object(value), attributes = object(primitive?.['attributes']);
      if (primitive === undefined || attributes === undefined || num(primitive['mode'], 4) !== 4) continue;
      const position = accessor(attributes['POSITION']), indices = accessor(primitive['indices']), colour = accessor(attributes['COLOR_0']);
      if (position === undefined || position.width < 3) continue;
      let base = colours.get(primitive['material']);
      if (base === undefined) { base = material(doc, bin, primitive['material']); colours.set(primitive['material'], base); }
      const tint = base;
      const vertex = (i: number): {p: number[]; c: Rgb} => ({p: point(matrix, position.read(i, 0), position.read(i, 1), position.read(i, 2)),
        c: colour === undefined ? tint : [tint[0] * colour.read(i, 0), tint[1] * colour.read(i, 1), tint[2] * colour.read(i, 2)]});
      const count = indices?.n ?? position.n;
      for (let t = 0; t + 2 < count; t += 3) {
        const ia = indices === undefined ? t : indices.read(t, 0), ib = indices === undefined ? t + 1 : indices.read(t + 1, 0), ic = indices === undefined ? t + 2 : indices.read(t + 2, 0);
        if (ia >= position.n || ib >= position.n || ic >= position.n) continue;
        const a = vertex(ia), b = vertex(ib), c = vertex(ic);
        raster.triangle(a.p, b.p, c.p, a.c, b.c, c.c, 2);
      }
    }
  };
  nodes.forEach((node, id) => {
    if (node?.['mesh'] === undefined || node['skin'] !== undefined) return;
    const transform = world(id), instancing = object(object(node['extensions'])?.['EXT_mesh_gpu_instancing']);
    if (instancing === undefined) { draw(node['mesh'], transform); return; }
    const attributes = object(instancing['attributes']) ?? {};
    const translation = accessor(attributes['TRANSLATION']), rotation = accessor(attributes['ROTATION']), scale = accessor(attributes['SCALE']);
    const count = translation?.n ?? rotation?.n ?? scale?.n ?? 0;
    for (let i = 0; i < count; i++) {
      const row = (a: Accessor | undefined, width: number): number[] | undefined => a === undefined ? undefined : Array.from({length: width}, (_, c) => a.read(i, c));
      const t = row(translation, 3), r = row(rotation, 4), s = row(scale, 3);
      draw(node['mesh'], multiply(transform, glbTransform({...(t === undefined ? {} : {translation: t}), ...(r === undefined ? {} : {rotation: r}), ...(s === undefined ? {} : {scale: s})})));
    }
  });
}

/** A point in a polygon of [x, z] rows (even-odd). */
function inside(points: readonly (readonly number[])[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]?.[0] ?? 0, zi = points[i]?.[1] ?? 0, xj = points[j]?.[0] ?? 0, zj = points[j]?.[1] ?? 0;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
/** A water body's outline as [x, z] rows: a polygon, a circle or a box; undefined for a shape the map doesn't know. */
function outline(shape: Readonly<Record<string, unknown>> | undefined): (readonly number[])[] | undefined {
  if (shape === undefined) return undefined;
  const kind = text(shape['kind']);
  if (kind === 'polygon') return array(shape['points']).map(row => array(row).map(v => num(v, 0)));
  const cx = num(shape['x'], 0), cz = num(shape['z'], 0);
  if (kind === 'circle' || kind === 'disc') {
    const r = num(shape['radius'] ?? shape['r'], 0);
    return r > 0 ? Array.from({length: 48}, (_, i) => [cx + r * Math.cos(i / 48 * Math.PI * 2), cz + r * Math.sin(i / 48 * Math.PI * 2)]) : undefined;
  }
  if (kind === 'box' || kind === 'rect' || kind === 'rectangle') {
    const hx = num(shape['hx'] ?? num(shape['width'], 0) / 2, 0), hz = num(shape['hz'] ?? num(shape['depth'], 0) / 2, 0);
    return hx > 0 && hz > 0 ? [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]] : undefined;
  }
  return undefined;
}

/** The files a world draws with: the render lattice's terrain and GLB tiles at their finest level, the props' tiles, and the near
 *  placeholder only when the lattice has no GLB of its own. */
function worldFiles(source: MapSource): {readonly terrain: readonly MapSourceFile[]; readonly glbs: readonly MapSourceFile[]} {
  const byHash = new Map(source.files.map(row => [row.hash, row]));
  const tiles = object(source.sections.get('world/tiles')), rows = array(tiles?.['tiles']).map(object);
  const finest = rows.reduce((low, row) => Math.min(low, num(row?.['lod'], 0)), Infinity);
  const hashes = new Set<string>();
  for (const row of rows) if (num(row?.['lod'], 0) === finest) for (const file of array(row?.['files'])) if (typeof file === 'string') hashes.add(file);
  for (const row of array(object(object(source.sections.get('world/terrain'))?.['terrain'])?.['tiles'])) { const file = text(object(row)?.['file']); if (file !== undefined) hashes.add(file); }
  for (const row of array(object(object(source.sections.get('world/props'))?.['props'])?.['tiles'])) { const file = text(object(row)?.['file']); if (file !== undefined) hashes.add(file); }
  const picked = [...hashes].flatMap(hash => { const row = byHash.get(hash); return row === undefined ? [] : [row]; });
  const glbs = picked.filter(row => row.kind === 'glb');
  if (glbs.length === 0) for (const hash of array(object(tiles?.['near'])?.['content'])) { const row = typeof hash === 'string' ? byHash.get(hash) : undefined; if (row?.kind === 'glb') glbs.push(row); }
  return {terrain: picked.filter(row => row.kind === 'tile'), glbs};
}

/** Draw the map: the raster, then the water, the light, the ink and the exposure, as RGBA. */
export function renderCookedMap(source: MapSource, options: {readonly size?: number; readonly texture?: TextureMean | undefined; readonly objects?: boolean} = {}): CookedMap {
  const size = options.size ?? COOKED_MAP_SIZE, raster = new Raster(size);
  let skipped = 0, terrainTiles = 0, glbs = 0, water = 0;
  const {terrain, glbs: glbFiles} = worldFiles(source);
  for (const row of terrain) { try { terrainTile(raster, source.read(row.path)); terrainTiles++; } catch { skipped++; } }
  // a material's colour: its base colour, times its colour texture's mean when the map can read it (the props' material table by
  // name, as the page binds it, else the GLB's own KTX2 image)
  const props = object(object(source.sections.get('world/props'))?.['props']), table = object(props?.['materials']);
  const byHash = new Map(source.files.map(row => [row.hash, row])), means = new Map<string, Rgb | undefined>();
  const mean = (key: string, bytes: () => Uint8Array): Rgb | undefined => {
    if (means.has(key)) return means.get(key);
    let found: Rgb | undefined;
    try { const read = options.texture?.(bytes()); found = read === undefined ? undefined : [read[0], read[1], read[2]]; } catch { found = undefined; }
    means.set(key, found); return found;
  };
  const material = (doc: Readonly<Record<string, unknown>>, bin: Uint8Array, index: unknown): Rgb => {
    const row = object(array(doc['materials'])[num(index, -1)]), pbr = object(row?.['pbrMetallicRoughness']);
    const factor = array(pbr?.['baseColorFactor']).map(v => num(v, 1)), base: Rgb = [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1];
    let tex: Rgb | undefined;
    const named = text(row?.['name']), bound = named === undefined ? undefined : text(object(object(table?.[named])?.['colour'])?.['file']);
    const file = bound === undefined ? undefined : byHash.get(bound);
    if (file !== undefined) tex = mean(file.hash, () => source.read(file.path));
    else {
      const texture = object(array(doc['textures'])[num(object(pbr?.['baseColorTexture'])?.['index'], -1)]);
      const image = num(object(object(texture?.['extensions'])?.['KHR_texture_basisu'])?.['source'] ?? texture?.['source'], -1);
      const img = object(array(doc['images'])[image]), view = object(array(doc['bufferViews'])[num(img?.['bufferView'], -1)]);
      if (img !== undefined && text(img['mimeType']) === 'image/ktx2' && view !== undefined) {
        const at = num(view['byteOffset'], 0), length = num(view['byteLength'], 0);
        tex = mean(`${named ?? ''}#${image}#${at}`, () => bin.subarray(at, at + length));
      }
    }
    return tex === undefined ? base : [base[0] * tex[0], base[1] * tex[1], base[2] * tex[2]];
  };
  // MAP-NEXT MN5: `objects: false` is the terrain map, drawn when the world's GLBs broke the full render
  if (options.objects !== false) for (const row of glbFiles) { try { glbTriangles(raster, source.read(row.path), material); glbs++; } catch { skipped++; } }

  const {top, rgb, what} = raster, n = size * size, mpp = METRES / size;
  // water: each declared body at its level, over whatever is under it
  const wet = new Float32Array(n).fill(-Infinity);
  for (const value of array(object(source.sections.get('world/water'))?.['water'])) {
    const body = object(value), points = outline(object(body?.['shape']));
    if (body === undefined || points === undefined || points.length < 3) continue;
    const level = num(body['level'], 0);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p[0] ?? 0); x1 = Math.max(x1, p[0] ?? 0); z0 = Math.min(z0, p[1] ?? 0); z1 = Math.max(z1, p[1] ?? 0); }
    const px0 = Math.max(0, Math.floor((HALF - x1) / mpp)), px1 = Math.min(size - 1, Math.ceil((HALF - x0) / mpp));
    const py0 = Math.max(0, Math.floor((HALF - z1) / mpp)), py1 = Math.min(size - 1, Math.ceil((HALF - z0) / mpp));
    for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
      const at = y * size + x, wx = HALF - (x + 0.5) * mpp, wz = HALF - (y + 0.5) * mpp;
      if ((top[at] ?? -Infinity) < level + 0.05 && inside(points, wx, wz)) wet[at] = Math.max(wet[at] ?? -Infinity, level);
    }
    water++;
  }

  // exposure: the median ground's brightness lifted to a mid tone, so a dusk-lit shard's colours still read on a phone
  const lum: number[] = [];
  for (let at = 0; at < n; at += 7) if ((what[at] ?? 0) !== 0) lum.push(0.2126 * (rgb[at * 3] ?? 0) + 0.7152 * (rgb[at * 3 + 1] ?? 0) + 0.0722 * (rgb[at * 3 + 2] ?? 0));
  lum.sort((a, b) => a - b);
  const median = lum[Math.floor(lum.length / 2)] ?? 0.1, gain = Math.min(3, Math.max(0.85, 0.16 / Math.max(median, 1e-3)));

  const h = (x: number, y: number, fallback: number): number => {
    if (x < 0 || y < 0 || x >= size || y >= size) return fallback;
    const v = top[y * size + x] ?? -Infinity; return v === -Infinity ? fallback : v;
  };
  // the sun from the north-west (the image's top left), 45° up: a hillshade, a short shadow, an ink line on every step up
  const lx = -0.5, ly = -0.5, lz = 0.7071, shadowSteps = Math.max(4, Math.round(10 * size / 1024));
  const out = new Uint8Array(n * 4), VOID: Rgb = [0.012, 0.017, 0.024], GRID: Rgb = [0.03, 0.04, 0.05];
  const WATER_DEEP: Rgb = [0.02, 0.09, 0.17], WATER_SHALLOW: Rgb = [0.09, 0.3, 0.42], SHORE: Rgb = [0.55, 0.72, 0.78];
  /** Water shallower than this over ground is a wet sheet: the ground drawn as ground, a little toward the water's colour. */
  const WATER_FILM = 0.25, FILM_TINT = 0.2;
  let covered = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = y * size + x, here = top[at] ?? -Infinity, kind = what[at] ?? 0;
    let colour: Rgb;
    // a sheet of water a few centimetres over solid ground (Mirror Salt's flood) wets the ground, it doesn't hide it
    const level = wet[at] ?? -Infinity, film = level !== -Infinity && here !== -Infinity && level - here < WATER_FILM;
    if (level !== -Infinity && !film) {
      const depth = Math.min(1, Math.max(0, ((wet[at] ?? 0) - (here === -Infinity ? (wet[at] ?? 0) - 2 : here)) / 2.5));
      colour = [0, 1, 2].map(k => (WATER_SHALLOW[k] ?? 0) + ((WATER_DEEP[k] ?? 0) - (WATER_SHALLOW[k] ?? 0)) * depth) as Rgb;
      const dry = (dx: number, dy: number): boolean => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < size && yy < size && (wet[yy * size + xx] ?? -Infinity) === -Infinity; };
      if (dry(1, 0) || dry(-1, 0) || dry(0, 1) || dry(0, -1)) colour = SHORE;
      covered++;
    } else if (kind === 0) {
      // nothing drawn here: the plot's dark ground with its 62.5 m grid, never one flat colour
      const line = (v: number): boolean => Math.abs(((v * mpp) % 62.5 + 62.5) % 62.5) < mpp * 1.2;
      colour = line(x) || line(y) ? GRID : VOID;
    } else {
      covered++;
      const dx = (h(x + 1, y, here) - h(x - 1, y, here)) / (2 * mpp), dy = (h(x, y + 1, here) - h(x, y - 1, here)) / (2 * mpp);
      // image x grows east (−X), image y grows south (−Z): a rise to the east is a slope facing west
      const nl = Math.hypot(dx, dy, 1), lambert = Math.max(0, (-dx * lx - dy * ly + lz) / nl);
      let shade = 0.55 + 0.6 * lambert;
      for (let k = 1; k <= shadowSteps; k++) if (h(x - k, y - k, -Infinity) - here > k * mpp * 1.1 + 0.3) { shade *= 0.7; break; }
      // the ink: this pixel stands over a neighbour by a step (a wall's top, a roof's edge, a cliff)
      const low = Math.min(h(x + 1, y, here), h(x - 1, y, here), h(x, y + 1, here), h(x, y - 1, here));
      const ink = here - low > 0.6 ? 0.5 : 1;
      const lift = kind === 2 ? 1.05 : 1;
      // a soft shoulder, not a clip: a pale stone stays a pale stone with its shading, never a white hole
      colour = [0, 1, 2].map(k => { const v = (rgb[at * 3 + k] ?? 0) * gain * shade * ink * lift; return 1.25 * v / (1 + v); }) as Rgb;
      if (film) colour = [0, 1, 2].map(k => (colour[k] ?? 0) * (1 - FILM_TINT) + (WATER_SHALLOW[k] ?? 0) * FILM_TINT) as Rgb;
    }
    out[at * 4] = toSrgb(colour[0]); out[at * 4 + 1] = toSrgb(colour[1]); out[at * 4 + 2] = toSrgb(colour[2]); out[at * 4 + 3] = 255;
  }
  return {size, rgba: out, stats: {terrainTiles, glbs, triangles: raster.triangles, water, skipped, covered: covered / n}};
}

const CRC_TABLE = Uint32Array.from({length: 256}, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array): number => { let c = 0xffffffff; for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** Median cut over a 5-bit-a-channel histogram: at most 256 colours, each the weighted mean of its box, so rare colours with
 *  their own place in colour space (an ink line, a shore, a roof) keep a slot beside a field of noisy grass. */
function palette(rgba: Uint8Array): {readonly colours: Uint8Array; readonly index: (r: number, g: number, b: number) => number} {
  const counts = new Uint32Array(32768), key = (r: number, g: number, b: number): number => (r >> 3) << 10 | (g >> 3) << 5 | b >> 3;
  for (let i = 0; i < rgba.length; i += 4) { const bin = key(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0); counts[bin] = (counts[bin] ?? 0) + 1; }
  const bins: number[] = []; for (let bin = 0; bin < 32768; bin++) if ((counts[bin] ?? 0) > 0) bins.push(bin);
  const channel = (bin: number, c: number): number => (bin >> (10 - c * 5)) & 31;
  const boxes: number[][] = [bins];
  while (boxes.length < 256) {
    let best = -1, bestScore = 0, bestChannel = 0;
    boxes.forEach((box, at) => {
      if (box.length < 2) return;
      const weight = box.reduce((sum, bin) => sum + (counts[bin] ?? 0), 0);
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0; for (const bin of box) { const v = channel(bin, c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
        // a box's range, weighted gently by its pixels: wide sparse boxes split as well as big busy ones
        const score = (hi - lo) * Math.sqrt(weight);
        if (hi > lo && score > bestScore) { bestScore = score; best = at; bestChannel = c; }
      }
    });
    if (best === -1) break;
    const box = (boxes[best] ?? []).sort((a, b) => channel(a, bestChannel) - channel(b, bestChannel) || a - b);
    const total = box.reduce((sum, bin) => sum + (counts[bin] ?? 0), 0);
    let run = 0, cut = box.length - 1;
    for (let k = 0; k < box.length - 1; k++) { run += counts[box[k] ?? 0] ?? 0; if (run * 2 >= total) { cut = k + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  const colours = new Uint8Array(boxes.length * 3), lookup = new Int16Array(32768).fill(-1);
  boxes.forEach((box, at) => {
    let r = 0, g = 0, b = 0, w = 0;
    for (const bin of box) { const n = counts[bin] ?? 0; r += (channel(bin, 0) * 8 + 4) * n; g += (channel(bin, 1) * 8 + 4) * n; b += (channel(bin, 2) * 8 + 4) * n; w += n; }
    colours[at * 3] = Math.round(r / w); colours[at * 3 + 1] = Math.round(g / w); colours[at * 3 + 2] = Math.round(b / w);
  });
  const nearest = (bin: number): number => {
    const r = channel(bin, 0) * 8 + 4, g = channel(bin, 1) * 8 + 4, b = channel(bin, 2) * 8 + 4;
    let found = 0, distance = Infinity;
    for (let at = 0; at < boxes.length; at++) {
      const d = (r - (colours[at * 3] ?? 0)) ** 2 * 2 + (g - (colours[at * 3 + 1] ?? 0)) ** 2 * 4 + (b - (colours[at * 3 + 2] ?? 0)) ** 2 * 3;
      if (d < distance) { distance = d; found = at; }
    }
    return found;
  };
  return {colours, index: (r, g, b) => {
    const bin = key(r, g, b);
    let at = lookup[bin] ?? -1;
    if (at === -1) { at = nearest(bin); lookup[bin] = at; }
    return at;
  }};
}
/** An indexed PNG of RGBA pixels (alpha dropped: the map is opaque): 256 colours by median cut, deflated at level 9. Deterministic:
 *  the same pixels give the same bytes. */
export function encodeMapPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const {colours, index} = palette(rgba), raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4; raw[y * (width + 1) + 1 + x] = index(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0);
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 3;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('PLTE', colours), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Area-average RGBA down to `to` px a side (the cell copy), in sRGB bytes: a map, not a photograph. */
export function downscaleMap(rgba: Uint8Array, from: number, to: number): Uint8Array {
  const out = new Uint8Array(to * to * 4), ratio = from / to;
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
    const sx0 = x * ratio, sx1 = (x + 1) * ratio, sy0 = y * ratio, sy1 = (y + 1) * ratio, sum = [0, 0, 0];
    let w = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      const cover = (Math.min(sx + 1, sx1) - Math.max(sx, sx0)) * (Math.min(sy + 1, sy1) - Math.max(sy, sy0)), at = (sy * from + sx) * 4;
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (rgba[at + k] ?? 0) * cover;
      w += cover;
    }
    for (let k = 0; k < 3; k++) out[(y * to + x) * 4 + k] = Math.round((sum[k] ?? 0) / w);
    out[(y * to + x) * 4 + 3] = 255;
  }
  return out;
}

/** Linear mean of an RGBA8 pixel run (sRGB-encoded when `srgb`), weighted by alpha. */
function meanOf(rgba: Uint8Array, srgb: boolean): readonly [number, number, number] | undefined {
  let r = 0, g = 0, b = 0, w = 0;
  const lin = (v: number): number => srgb ? toLinear(v / 255) : v / 255;
  for (let i = 0; i + 3 < rgba.length; i += 4) { const a = (rgba[i + 3] ?? 255) / 255; r += lin(rgba[i] ?? 0) * a; g += lin(rgba[i + 1] ?? 0) * a; b += lin(rgba[i + 2] ?? 0) * a; w += a; }
  return w === 0 ? undefined : [r / w, g / w, b / w];
}
/** A plain RGBA8 KTX2 (vkFormat 37 UNORM / 43 SRGB, raw or Zstandard): its last level's mean, without basisu. Null for any
 *  other KTX2 (UASTC, ETC1S, ASTC), which basisu reads. */
function rawKtx2Mean(bytes: Uint8Array): readonly [number, number, number] | undefined | null {
  if (bytes.length < 104) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), format = view.getUint32(12, true), scheme = view.getUint32(44, true);
  if ((format !== 37 && format !== 43) || (scheme !== 0 && scheme !== 2)) return null;
  const levels = Math.max(1, view.getUint32(40, true)), row = 80 + (levels - 1) * 24;
  const offset = Number(view.getBigUint64(row, true)), length = Number(view.getBigUint64(row + 8, true));
  if (offset + length > bytes.length) return undefined;
  const body = bytes.subarray(offset, offset + length), pixels = scheme === 2 ? new Uint8Array(zstdDecompressSync(body)) : body;
  return meanOf(pixels.length > 4 * 1024 * 1024 ? pixels.subarray(0, 4 * 1024 * 1024) : pixels, format === 43);
}
interface Ktx2File {
  readonly isValid: () => boolean; readonly startTranscoding: () => boolean; readonly getLevels: () => number; readonly close: () => void; readonly delete: () => void;
  readonly getImageLevelInfo: (level: number, layer: number, face: number) => {origWidth: number; origHeight: number};
  readonly getImageTranscodedSizeInBytes: (level: number, layer: number, face: number, format: number) => number;
  readonly transcodeImage: (out: Uint8Array, level: number, layer: number, face: number, format: number, alpha: number, channel0: number, channel1: number) => number;
}
interface BasisModule {readonly initializeBasis: () => void; KTX2File: new (bytes: Uint8Array) => Ktx2File; transcoder_texture_format: {cTFRGBA32: {value: number}}}
type BasisFactory = (options: {wasmBinary: Uint8Array; print: () => void; printErr: () => void}) => Promise<BasisModule>;
/** A colour texture's mean, read from its smallest mip level of at least 4 px with the vendored basisu build (the one the phone
 *  tier encodes with, `astc6Wasm.ts`); undefined when basisu can't load here, so a map still draws with base colours. */
export async function basisuTextureMean(): Promise<TextureMean | undefined> {
  try {
    const require = createRequire(import.meta.url);
    const factory = require('../../scripts/vendor/basisu/basis_encoder.cjs') as BasisFactory;
    const basis = await factory({wasmBinary: new Uint8Array(readFileSync(new URL('../../scripts/vendor/basisu/basis_encoder.wasm', import.meta.url))), print: () => undefined, printErr: () => undefined});
    basis.initializeBasis();
    const rgba32 = basis.transcoder_texture_format.cTFRGBA32.value;
    return bytes => {
      const raw = rawKtx2Mean(bytes);
      if (raw !== null) return raw;
      const file = new basis.KTX2File(bytes);
      try {
        if (!file.isValid() || !file.startTranscoding()) return undefined;
        let level = file.getLevels() - 1;
        while (level > 0 && Math.min(file.getImageLevelInfo(level, 0, 0).origWidth, file.getImageLevelInfo(level, 0, 0).origHeight) < 4) level--;
        const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, rgba32));
        if (file.transcodeImage(out, level, 0, 0, rgba32, 0, -1, -1) === 0) return undefined;
        return meanOf(out, true);
      } finally { file.close(); file.delete(); }
    };
  } catch { return undefined; }
}

/** MAP-NEXT MN5: which drawing a cooked map is. `world` is the full render; `terrain` the terrain's heights, hillshaded, with the
 *  declared water (the world's GLBs broke the full render); `plain` the ground colour with the zone's outline and name. */
export type MapDrawn = 'world' | 'terrain' | 'plain';

/** A 5 by 7 capital font for the plain map's name: seven rows of five bits a glyph, the high bit leftmost. */
const GLYPHS: Readonly<Record<string, string>> = {
  A: '0e11111f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1e11111111111e', E: '1f10101e10101f', F: '1f10101e101010',
  G: '0e11101711110f', H: '1111111f111111', I: '0e04040404040e', J: '0702020202120c', K: '11121418141211',
  L: '1010101010101f', M: '111b1515111111', N: '11111915131111', O: '0e11111111110e', P: '1e11111e101010', Q: '0e11111115120d',
  R: '1e11111e141211', S: '0f10100e01011e', T: '1f040404040404', U: '1111111111110e', V: '11111111110a04', W: '1111111515150a',
  X: '11110a040a1111', Y: '1111110a040404', Z: '1f01020408101f', '0': '0e11131519110e', '1': '040c040404040e',
  '2': '0e11010204081f', '3': '1f02040201110e', '4': '02060a121f0202', '5': '1f101e0101110e', '6': '0608101e11110e', '7': '1f010204080808',
  '8': '0e11110e11110e', '9': '0e11110f01020c', '-': '0000000e000000', '.': '00000000000c0c', "'": '04040800000000', ' ': '00000000000000',
};
const glyphRows = (char: string): readonly number[] => {
  const hex = GLYPHS[char] ?? GLYPHS[' '] ?? '';
  return Array.from({length: 7}, (_, row) => Number.parseInt(hex.slice(row * 2, row * 2 + 2), 16) || 0);
};

/** MAP-NEXT MN5, the last fallback: the zone's ground colour, its 62.5 m plot grid, its outline and its name, as RGBA. Needs no
 *  file of the shard, so it cannot fail on one. */
export function renderPlainMap(name: string, size: number = COOKED_MAP_SIZE): CookedMap {
  const out = new Uint8Array(size * size * 4), mpp = METRES / size;
  const GROUND_SRGB = [74, 92, 46], GRID_SRGB = [64, 80, 40], EDGE = [200, 207, 174], INK = [18, 22, 14], LETTER = [242, 240, 224];
  const paint = (x: number, y: number, rgb: readonly number[]): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (y * size + x) * 4; out[at] = rgb[0] ?? 0; out[at + 1] = rgb[1] ?? 0; out[at + 2] = rgb[2] ?? 0; out[at + 3] = 255;
  };
  const edge = Math.max(2, Math.round(size / 128)), line = (v: number): boolean => Math.abs(((v * mpp) % 62.5 + 62.5) % 62.5) < mpp * 1.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const border = x < edge || y < edge || x >= size - edge || y >= size - edge;
    paint(x, y, border ? EDGE : line(x) || line(y) ? GRID_SRGB : GROUND_SRGB);
  }
  // the name in capitals, wrapped by word to 80% of the width, each line centred, with a dark shadow so it reads on the ground
  const words = name.toUpperCase().replaceAll(/[^A-Z0-9 .'-]+/gu, ' ').trim().split(/\s+/u).filter(word => word !== '');
  const longest = Math.max(1, ...words.map(word => word.length)), whole = words.join(' ').length;
  const scale = Math.max(1, Math.min(Math.floor(size / 40), Math.floor(size * 0.8 / (Math.min(whole, Math.max(longest, 14)) * 6))));
  const perLine = Math.max(longest, Math.floor(size * 0.8 / (6 * scale)));
  const lines: string[] = [];
  for (const word of words) { const last = lines.at(-1); if (last !== undefined && last.length + 1 + word.length <= perLine) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word); }
  const lineHeight = 9 * scale, top = Math.round((size - lines.length * lineHeight + 2 * scale) / 2);
  for (const [index, letters] of lines.entries()) {
    const left = Math.round((size - (letters.length * 6 - 1) * scale) / 2), y0 = top + index * lineHeight;
    for (const pass of [INK, LETTER]) {
      const shift = pass === INK ? Math.max(1, Math.round(scale / 2)) : 0;
      for (const [i, char] of letters.split('').entries()) for (const [row, bits] of glyphRows(char).entries()) for (let column = 0; column < 5; column++) {
        if ((bits & (0x10 >> column)) === 0) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) paint(left + (i * 6 + column) * scale + dx + shift, y0 + row * scale + dy + shift, pass);
      }
    }
  }
  return {size, rgba: out, stats: {terrainTiles: 0, glbs: 0, triangles: 0, water: 0, skipped: 0, covered: 0}};
}

/** MAP-NEXT MN5: what draws a map and what it is called. `world` and `terrain` replace the two renders (a test's seam to prove the
 *  fallbacks); `warn` hears each fallback and why. */
export interface CookedMapOptions {
  readonly name?: string;
  readonly warn?: (line: string) => void;
  readonly world?: (source: MapSource) => CookedMap | Promise<CookedMap>;
  readonly terrain?: (source: MapSource) => CookedMap;
}
const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The cook's map for a product: the full PNG (the home cell's minimap), the cell copy (every other cell, the Bag map) and what
 *  drew them. MAP-NEXT MN5: it always returns both. A world render that throws falls back to the terrain map; a terrain map that
 *  throws, or that covers nothing, falls back to the plain map, which reads no file. */
export async function cookedMapPngs(source: MapSource, texture?: TextureMean, options: CookedMapOptions = {}): Promise<{readonly full: Uint8Array; readonly cell: Uint8Array; readonly stats: CookedMapStats & {readonly drawn: MapDrawn}}> {
  const pngs = (map: CookedMap, drawn: MapDrawn): {readonly full: Uint8Array; readonly cell: Uint8Array; readonly stats: CookedMapStats & {readonly drawn: MapDrawn}} =>
    ({full: encodeMapPng(map.rgba, map.size, map.size), cell: encodeMapPng(downscaleMap(map.rgba, map.size, COOKED_CELL_SIZE), COOKED_CELL_SIZE, COOKED_CELL_SIZE), stats: {...map.stats, drawn}});
  const world = options.world ?? (async (from: MapSource): Promise<CookedMap> => { await prepareGlbBuffers(); return renderCookedMap(from, {texture: texture ?? await basisuTextureMean()}); });
  try { return pngs(await world(source), 'world'); } catch (error) { options.warn?.(`cooked map: the world render failed (${reason(error)}); drawing the terrain map`); }
  try {
    const map = (options.terrain ?? ((from: MapSource): CookedMap => renderCookedMap(from, {objects: false})))(source);
    if (map.stats.covered > 0.01) return pngs(map, 'terrain');
    options.warn?.('cooked map: the terrain map covers nothing; drawing the plain map');
  } catch (error) { options.warn?.(`cooked map: the terrain render failed (${reason(error)}); drawing the plain map`); }
  return pngs(renderPlainMap(options.name ?? ''), 'plain');
}
