/** The seams' pure geometry (`seamLook.ts` is their look): one home-frame mesh grouped by material, in plain arrays, so the
 *  cook (`gridStripPages.ts`) and the page build the same bytes. Normals and the sphere are three's arithmetic, in steps. */
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { GAP_HALF } from './roadLayout';

/** The material a feature kind wears. */
export type SeamBucket = 'ground' | 'stone' | 'rock' | 'dike' | 'curtain' | 'rail';
/** Draw order: opaque first, the additive curtain last. */
export const SEAM_BUCKETS: readonly SeamBucket[] = ['ground', 'stone', 'rock', 'dike', 'rail', 'curtain'];
const BUCKET_OF: Readonly<Record<string, SeamBucket>> = {
  'deck': 'ground', 'neutral-buffer': 'ground', 'gradient': 'ground', 'overlap': 'ground', 'turn-in': 'ground',
  'retaining-wall': 'stone', 'parapet': 'stone', 'culvert': 'stone', 'revetment': 'stone', 'cliff': 'rock', 'talus': 'rock', 'dike': 'dike',
  'road-wall': 'curtain', 'guard-rail': 'rail',
};
/** A feature kind's material; an unknown kind (a newer generator) draws as ground rather than vanishing. */
export function seamBucket(kind: string): SeamBucket { return BUCKET_OF[kind] ?? 'ground'; }
/** A `sourceSurface` name to a linear colour (the reader's terrain palette); undefined: sample the shard's edge colour. */
export type SeamSurfaces = (name: string) => readonly [number, number, number] | undefined;
/** The readout: triangles and draws per material (the road's tight budget, G101). */
export interface SeamLookState { readonly triangles: number; readonly draws: number; readonly buckets: Readonly<Partial<Record<SeamBucket, number>>> }

/** Exact author-built channels for these ordered strips (ZE4: frame-free, so one bake serves every home; the uv and the
 *  bounding sphere are the home frame's and are made on the page). Colours remain runtime-owned under a surface resolver. */
export interface SeamGeometryChannels {
  readonly pitch: number;
  /** Each strip's own vertex normals (`stripNormalSteps`), in strip order. */
  readonly normals: Float32Array;
  /** Default palette only; an explicit runtime surface resolver still builds its own colours. */
  readonly colours?: Float32Array;
}
/** three's bounding sphere, as the seam mesh carries it. */
export interface SeamSphere { readonly centre: readonly [number, number, number]; readonly radius: number }

/** One home-frame mesh in plain arrays, its index grouped by material. */
export interface SeamMesh {
  readonly position: Float32Array; readonly colour: Float32Array; readonly normal: Float32Array; readonly uv: Float32Array; readonly index: Uint32Array;
  readonly groups: readonly { readonly start: number; readonly count: number; readonly bucket: SeamBucket }[];
  readonly sphere: SeamSphere; readonly state: SeamLookState;
}

/** What the look reads from a generated strip (`GeneratedStrip` fits it): its mesh and its ordered feature ranges. */
export interface SeamPiece {
  readonly mesh: { readonly origin: { readonly x: number; readonly z: number }; readonly positions: Float32Array; readonly colours: Float32Array; readonly indices: Uint32Array };
  readonly features: readonly { readonly kind: string; readonly firstIndex: number; readonly indexCount: number; readonly sourceSurface?: string }[];
}
const ROCK_GREY: readonly [number, number, number] = [0.32, 0.3, 0.28];
/** The generator's neutral platform grey (linear) and how much darker the look draws it. */
const NEUTRAL = 0.25, VERGE = 0.45, BUFFER = 11.5;
/** Distance from the nearest road centre line on one axis (centre lines at k·pitch + pitch/2, grid metres). */
const fromRoad = (v: number, pitch: number): number => Math.abs(v - (Math.round((v - pitch / 2) / pitch) * pitch + pitch / 2));

/**
 * Merge every strip into one home-frame geometry whose index buffer is grouped by material. Pure (no GPU): the vertices are
 * the generator's own, translated; `uv` is world-planar (top faces xz, walls along × height) so textures tile across strips.
 * In steps (D12: the whole merge was one 104 ms task of the road's sliced install on the phone tier): a step a strip, then
 * three's vertex normals on each strip's own mesh (`stripNormalSteps`) and three's bounding sphere, so the same bytes.
 */
export function* seamMeshSteps(pieces: readonly SeamPiece[], home: { readonly origin: { readonly x: number; readonly z: number } }, surfaces?: SeamSurfaces, pitch: number = CONTENT_CAPS.pitch, channels?: SeamGeometryChannels): Generator<void, SeamMesh> {
  let vertices = 0;
  for (const { mesh } of pieces) vertices += mesh.positions.length / 3;
  if (channels !== undefined && (channels.pitch !== pitch || channels.normals.length !== vertices * 3
    || channels.colours !== undefined && channels.colours.length !== vertices * 3)) throw new Error('Baked seam channels differ from these strips');
  const bakedColours = surfaces === undefined ? channels?.colours : undefined;
  const position = new Float32Array(vertices * 3), colour = bakedColours ?? new Float32Array(vertices * 3), bucketOf = new Int8Array(vertices).fill(-1);
  const lists = new Map<SeamBucket, number[]>(SEAM_BUCKETS.map((b) => [b, []]));
  let base = 0;
  for (const { mesh, features } of pieces) {
    const dx = mesh.origin.x - home.origin.x, dz = mesh.origin.z - home.origin.z, count = mesh.positions.length / 3;
    let previousX = Number.NaN, previousZ = Number.NaN, roadX = Number.NaN, roadZ = Number.NaN;
    for (let k = 0; k < count; k++) {
      position[(base + k) * 3] = (mesh.positions[k * 3] ?? 0) + dx; position[(base + k) * 3 + 1] = mesh.positions[k * 3 + 1] ?? 0; position[(base + k) * 3 + 2] = (mesh.positions[k * 3 + 2] ?? 0) + dz;
      if (bakedColours !== undefined) continue;
      // the platform's neutral grey reads as a dark gravel verge; the shard's own colour at the gradient's far edge is kept
      const r = mesh.colours[k * 3] ?? 0, g = mesh.colours[k * 3 + 1] ?? 0, b = mesh.colours[k * 3 + 2] ?? 0;
      // only near the road: the darkening fades out across the gradient, so the cell edge keeps the shard's exact colour
      const wx = (mesh.positions[k * 3] ?? 0) + mesh.origin.x, wz = (mesh.positions[k * 3 + 2] ?? 0) + mesh.origin.z;
      // A lattice row repeats one coordinate. Reuse only that scalar result;
      // arbitrary meshes and every change of coordinate take the same formula.
      if (wx !== previousX) { roadX = fromRoad(wx, pitch); previousX = wx; }
      if (wz !== previousZ) { roadZ = fromRoad(wz, pitch); previousZ = wz; }
      const road = Math.max(0, Math.min(1, (GAP_HALF - Math.min(roadX, roadZ)) / (GAP_HALF - BUFFER)));
      const shade = 1 - VERGE * road * Math.max(0, 1 - (Math.abs(r - NEUTRAL) + Math.abs(g - NEUTRAL) + Math.abs(b - NEUTRAL)) / 0.15);
      colour[(base + k) * 3] = r * shade; colour[(base + k) * 3 + 1] = g * shade; colour[(base + k) * 3 + 2] = b * shade;
    }
    // every index in a feature range goes to its material's list; triangles no range names draw as ground
    const named = new Uint8Array(mesh.indices.length);
    const rockSurface = new Map<number, readonly [number, number, number] | undefined>();
    for (const feature of features) {
      const bucket = seamBucket(feature.kind), list = lists.get(bucket) ?? [], bi = SEAM_BUCKETS.indexOf(bucket);
      const surface = feature.sourceSurface === undefined ? undefined : surfaces?.(feature.sourceSurface);
      for (let i = feature.firstIndex; i < feature.firstIndex + feature.indexCount; i++) {
        const n = mesh.indices[i]; if (n === undefined || named[i] === 1) continue;
        named[i] = 1; list.push(n + base); bucketOf[n + base] = bi;
        if (bucket === 'rock' && bakedColours === undefined) rockSurface.set(n, surface);
      }
    }
    const ground = lists.get('ground') ?? [];
    for (let i = 0; i < mesh.indices.length; i++) if (named[i] !== 1) { const n = mesh.indices[i] ?? 0; ground.push(n + base); if (bucketOf[n + base] === -1) bucketOf[n + base] = 0; }
    if (bakedColours === undefined) rockColours(mesh.positions, mesh.colours, bucketOf.subarray(base, base + count), rockSurface, colour.subarray(base * 3, (base + count) * 3));
    base += count;
    yield;
  }
  // Bucket lists already establish the exact feature/triangle order. Copy
  // them directly into the final native index, without a second boxed list
  // and a scalar append loop over every corner.
  let indices = 0;
  for (const list of lists.values()) indices += list.length;
  const index = new Uint32Array(indices), groups: { start: number; count: number; bucket: SeamBucket }[] = [];
  let cursor = 0;
  for (const bucket of SEAM_BUCKETS) {
    const list = lists.get(bucket) ?? [];
    if (list.length === 0) continue;
    groups.push({ start: cursor, count: list.length, bucket });
    index.set(list, cursor); cursor += list.length;
  }
  // the zeroed normal three's computeVertexNormals makes, then its arithmetic in steps, strip by strip
  const normal = channels?.normals ?? new Float32Array(vertices * 3);
  yield;
  if (channels === undefined) yield* stripNormalSteps(pieces, normal);
  yield;
  const uv = planarUv(position, normal, bucketOf);
  yield;
  const sphere = boundingSphere(position);
  const buckets: Partial<Record<SeamBucket, number>> = {};
  for (const g of groups) buckets[g.bucket] = g.count / 3;
  return { position, colour, normal, uv, index, groups, sphere, state: { triangles: index.length / 3, draws: groups.length, buckets } };
}

const NORMAL_STEP = 8192;
/**
 * three's `computeVertexNormals` on each strip's own indexed mesh in its own frame, by the numbers: accumulate each face's
 * cross product in float32, then normalise; the same operations in the same order as three, so the same bytes
 * (`vertexNormalSteps` is its page-side twin). A strip's vertices are its own, so its normals read nothing of the other
 * strips or of the home's frame (ZE4): the cook bakes them once per strip and every home that draws it gets these bytes.
 */
export function* stripNormalSteps(pieces: readonly SeamPiece[], n: Float32Array): Generator<void, void, undefined> {
  let base = 0, faces = 0;
  for (const { mesh } of pieces) {
    const p = mesh.positions, index = mesh.indices, at = base * 3;
    for (let i = 0; i < index.length; i += 3) {
      if (++faces % NORMAL_STEP === 0) yield;
      const a = (index[i] ?? 0) * 3, b = (index[i + 1] ?? 0) * 3, c = (index[i + 2] ?? 0) * 3;
      const bx = p[b] ?? Number.NaN, by = p[b + 1] ?? Number.NaN, bz = p[b + 2] ?? Number.NaN;
      const cx = (p[c] ?? Number.NaN) - bx, cy = (p[c + 1] ?? Number.NaN) - by, cz = (p[c + 2] ?? Number.NaN) - bz;
      const ax = (p[a] ?? Number.NaN) - bx, ay = (p[a + 1] ?? Number.NaN) - by, az = (p[a + 2] ?? Number.NaN) - bz;
      const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
      // Read all corners before any write, including a triangle with repeated indices.
      const nax = n[at + a] ?? Number.NaN, nay = n[at + a + 1] ?? Number.NaN, naz = n[at + a + 2] ?? Number.NaN;
      const nbx = n[at + b] ?? Number.NaN, nby = n[at + b + 1] ?? Number.NaN, nbz = n[at + b + 2] ?? Number.NaN;
      const ncx = n[at + c] ?? Number.NaN, ncy = n[at + c + 1] ?? Number.NaN, ncz = n[at + c + 2] ?? Number.NaN;
      n[at + a] = nax + nx; n[at + a + 1] = nay + ny; n[at + a + 2] = naz + nz;
      n[at + b] = nbx + nx; n[at + b + 1] = nby + ny; n[at + b + 2] = nbz + nz;
      n[at + c] = ncx + nx; n[at + c + 1] = ncy + ny; n[at + c + 2] = ncz + nz;
    }
    for (let i = at; i < at + p.length; i += 3) {
      const x = n[i] ?? 0, y = n[i + 1] ?? 0, z = n[i + 2] ?? 0, scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      n[i] = x * scale; n[i + 1] = y * scale; n[i + 2] = z * scale;
    }
    base += p.length / 3;
    yield;
  }
}

/** three's bounding sphere: the box's centre and the farthest point from it. */
function boundingSphere(p: Float32Array): SeamSphere {
  if (p.length === 0) return { centre: [0, 0, 0], radius: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] ?? Number.NaN, y = p[i + 1] ?? Number.NaN, z = p[i + 2] ?? Number.NaN;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  let radiusSq = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = cx - (p[i] ?? Number.NaN), dy = cy - (p[i + 1] ?? Number.NaN), dz = cz - (p[i + 2] ?? Number.NaN);
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  const radius = Math.sqrt(radiusSq);
  if (Number.isNaN(radius)) throw new Error('Seam mesh has no finite bounds');
  return { centre: [cx, cy, cz], radius };
}

/** Texture metres per uv unit for each material (the uv is world metres divided by this). */
const UV_METRES: Readonly<Record<SeamBucket, number>> = { ground: 4, stone: 2.4, rock: 7, dike: 2, curtain: 1, rail: 1 };
function planarUv(position: Float32Array, normal: ArrayLike<number>, bucketOf: Int8Array): Float32Array {
  const uv = new Float32Array((position.length / 3) * 2);
  for (let k = 0; k < position.length / 3; k++) {
    const x = position[k * 3] ?? 0, y = position[k * 3 + 1] ?? 0, z = position[k * 3 + 2] ?? 0, nx = normal[k * 3] ?? 0, ny = normal[k * 3 + 1] ?? 0, nz = normal[k * 3 + 2] ?? 0;
    const metres = UV_METRES[SEAM_BUCKETS[Math.max(0, bucketOf[k] ?? 0)] ?? 'ground'];
    const top = Math.abs(ny) > 0.75, along = Math.abs(nx) > Math.abs(nz) ? z : x;
    uv[k * 2] = (top ? x : along) / metres; uv[k * 2 + 1] = (top ? z : y) / metres;
  }
  return uv;
}

/**
 * A cliff or talus vertex wears the shard's own surface: the resolved `sourceSurface` colour, else the colour of the
 * nearest ground vertex of the same strip (the gradient's outer row is the shard's own edge colour), drawn toward rock.
 */
function rockColours(positions: Float32Array, colours: Float32Array, bucketOf: Int8Array, surface: ReadonlyMap<number, readonly [number, number, number] | undefined>, out: Float32Array): void {
  if (surface.size === 0) return;
  const cell = 2, ground = new Map<number, Map<number, number[]>>();
  for (let k = 0; k < bucketOf.length; k++) if (bucketOf[k] === 0) {
    const x = Math.round((positions[k * 3] ?? 0) / cell), z = Math.round((positions[k * 3 + 2] ?? 0) / cell);
    let column = ground.get(x);
    if (column === undefined) { column = new Map(); ground.set(x, column); }
    let list = column.get(z);
    if (list === undefined) { list = []; column.set(z, list); }
    list.push(k);
  }
  for (const [k, resolved] of surface) {
    let rgb: readonly [number, number, number] | undefined = resolved;
    if (rgb === undefined) {
      const x = positions[k * 3] ?? 0, z = positions[k * 3 + 2] ?? 0, cx = Math.round(x / cell), cz = Math.round(z / cell);
      let best = Infinity, found = -1;
      for (let r = 0; r <= 3 && found < 0; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        for (const g of ground.get(cx + i)?.get(cz + j) ?? []) {
          const d = ((positions[g * 3] ?? 0) - x) ** 2 + ((positions[g * 3 + 2] ?? 0) - z) ** 2 + ((positions[g * 3 + 1] ?? 0) - (positions[k * 3 + 1] ?? 0)) ** 2 * 0.01;
          if (d < best) { best = d; found = g; }
        }
      }
      rgb = found < 0 ? undefined : [colours[found * 3] ?? 0, colours[found * 3 + 1] ?? 0, colours[found * 3 + 2] ?? 0];
    }
    const own = rgb ?? ROCK_GREY;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = ((own[c] ?? 0) * 0.6 + (ROCK_GREY[c] ?? 0) * 0.4) * 0.9;
  }
}
