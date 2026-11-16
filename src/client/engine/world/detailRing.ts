/**
 * The camera-ring scatter behind a shard's detail layers (meta SHARD-SOURCE AP32b; format `look.details`, AP32a).
 *
 * `Grass.ts`'s toroidal cell ring, made general: a layer's clumps live in a square of `side × side` ring cells of
 * `RING_CELL` metres round the camera, `slots` instances per cell, in one flat matrix + colour table (one InstancedMesh,
 * one draw). When the camera crosses a cell boundary only the cells that came into the window are reseeded, each from a
 * hash of its coordinates and the layer id, so the same square metre always grows the same clumps. A clump is kept with
 * the probability its mask cell gives (0 grows nothing, 255 grows `clumps` per mask cell), stands on the baked height of
 * that mask cell, and takes a seeded yaw, lean, scale and tint. Outside the layer's region nothing grows.
 *
 * The phone grows half the radius and half the slots (`ringShape`). Pure arithmetic over typed arrays and three's math:
 * no renderer, so a unit test drives it (`detail-ring.test.ts`); `detailLayer.ts` hands the tables to an InstancedMesh.
 */
import * as THREE from 'three';

/** The format's `look.details` row, as the engine reads it (format `LookDetail`; its files are binary, by hash). */
export interface DetailLayerSource {
  readonly id: string;
  readonly material: string;
  readonly mesh: { readonly file: string; readonly vertices: number; readonly triangles: number };
  readonly region: { readonly corner: readonly [number, number]; readonly cell: number; readonly columns: number; readonly rows: number; readonly span: readonly [number, number] };
  readonly mask: string;
  readonly heights: string;
  readonly clumps: number;
  readonly scale: readonly [number, number];
  readonly tilt: number;
  readonly tint: readonly [readonly [number, number, number], readonly [number, number, number]];
  readonly sway?: { readonly amount: number; readonly rate: number };
  readonly radius: number;
  readonly shadow: boolean;
}

/** A layer's three files' bytes (the shard file's binaries the row names). */
export interface DetailLayerFiles {
  readonly mesh: Uint8Array;
  readonly mask: Uint8Array;
  readonly heights: Uint8Array;
}

/** A layer with its mask and heights decoded, ready to scatter. */
export interface DetailField {
  readonly id: string;
  readonly seed: number;
  readonly cornerX: number;
  readonly cornerZ: number;
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly low: number;
  readonly high: number;
  readonly mask: Uint8Array;
  readonly heights: Uint16Array;
  readonly clumps: number;
  readonly scale: readonly [number, number];
  readonly tilt: number;
  readonly tint: readonly [readonly [number, number, number], readonly [number, number, number]];
}

/** The ring's size for a layer on a tier. */
export interface RingShape { readonly radius: number; readonly side: number; readonly slots: number }

/** Metres per ring cell (Grass.ts's). */
export const RING_CELL = 4;
/** At most this many instances in one ring cell on desktop (the phone gets half). */
export const RING_SLOTS_MAX = 96;
/** the most instances one layer's ring holds (about 3 MB of matrices): a radius-200 ring grows fewer slots a cell */
export const RING_INSTANCES_MAX = 49_152;
const EMPTY = 0x7fffffff;
const U16 = 65535;
const U8 = 255;

/** FNV-1a of the layer id: the layer's part of every cell's seed. */
export function layerSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (const char of id) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  return hash >>> 0;
}

/** Decode a layer's mask and heights. */
export function detailField(source: DetailLayerSource, files: DetailLayerFiles): DetailField {
  const heights = files.heights.slice();
  return {
    id: source.id, seed: layerSeed(source.id),
    cornerX: source.region.corner[0], cornerZ: source.region.corner[1], cell: source.region.cell,
    columns: source.region.columns, rows: source.region.rows, low: source.region.span[0], high: source.region.span[1],
    mask: files.mask, heights: new Uint16Array(heights.buffer, 0, heights.byteLength >> 1),
    clumps: source.clumps, scale: source.scale, tilt: source.tilt, tint: source.tint,
  };
}

/** The ring for a layer: the desktop grows `radius` metres and up to `RING_SLOTS_MAX` slots a cell; the phone half of each. */
export function ringShape(field: Pick<DetailField, 'cell' | 'clumps'>, radius: number, phone: boolean): RingShape {
  const reach = phone ? radius / 2 : radius;
  const full = Math.ceil(field.clumps * (RING_CELL / field.cell) ** 2);
  const desktop = Math.max(1, Math.min(RING_SLOTS_MAX, full)), side = Math.ceil((reach * 2) / RING_CELL);
  // a wide, dense ring keeps at most RING_INSTANCES_MAX instances (its tables and draw stay bounded): fewer slots a cell
  const tier = phone ? Math.max(1, Math.ceil(desktop / 2)) : desktop;
  return { radius: reach, side, slots: Math.max(1, Math.min(tier, Math.floor(RING_INSTANCES_MAX / (side * side)))) };
}

/** mulberry32: a small seeded generator, the same stream on every host. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/** One layer's ring: `matrices` (16 per slot) and `colours` (3 per slot) are the InstancedMesh's tables. */
export class DetailRing {
  readonly shape: RingShape;
  readonly matrices: Float32Array;
  readonly colours: Float32Array;
  /** slots written since the last `take()`: [first slot, count] ranges for addUpdateRange */
  private dirty: [number, number][] = [];
  private readonly keyX: Int32Array;
  private readonly keyZ: Int32Array;
  private queue: [number, number][] = [];
  private cellX = EMPTY;
  private cellZ = EMPTY;
  private readonly keep: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly lean = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  readonly field: DetailField;

  constructor(field: DetailField, shape: RingShape) {
    this.field = field;
    this.shape = shape;
    const cells = shape.side * shape.side;
    this.matrices = new Float32Array(cells * shape.slots * 16);
    this.colours = new Float32Array(cells * shape.slots * 3).fill(1);
    this.keyX = new Int32Array(cells).fill(EMPTY);
    this.keyZ = new Int32Array(cells).fill(EMPTY);
    // a mask cell at 255 grows `clumps`: a ring cell holds (RING_CELL / cell)² mask cells, spread over `slots` tries
    this.keep = Math.min(1, (field.clumps * (RING_CELL / field.cell) ** 2) / shape.slots);
  }

  /** The ring slot (cell index) a world cell lives in. */
  slotOf(cx: number, cz: number): number {
    const n = this.shape.side;
    return (((cx % n) + n) % n) * n + (((cz % n) + n) % n);
  }

  /** Move the ring to the camera at (x, z) and reseed up to `budget` cells (nearest first); returns the cells reseeded. */
  update(x: number, z: number, budget?: number): number {
    const pcx = Math.floor(x / RING_CELL), pcz = Math.floor(z / RING_CELL);
    if (pcx !== this.cellX || pcz !== this.cellZ) {
      this.cellX = pcx; this.cellZ = pcz;
      const half = this.shape.side >> 1, wanted: [number, number][] = [];
      for (let cx = pcx - half; cx < pcx - half + this.shape.side; cx++) {
        for (let cz = pcz - half; cz < pcz - half + this.shape.side; cz++) {
          const slot = this.slotOf(cx, cz);
          if (this.keyX[slot] !== cx || this.keyZ[slot] !== cz) wanted.push([cx, cz]);
        }
      }
      wanted.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
      this.queue = wanted;
    }
    let done = 0;
    const limit = budget ?? Infinity;
    while (done < limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next === undefined) break;
      this.seed(next[0], next[1]);
      done++;
    }
    return done;
  }

  /** The slot ranges written since the last call, then forgets them. */
  take(): [number, number][] {
    const out = this.dirty;
    this.dirty = [];
    return out;
  }

  /** Instances with a non-zero scale (the clumps growing now). */
  live(): number {
    let count = 0;
    for (let i = 0; i < this.matrices.length; i += 16) if (this.matrices[i + 15] !== 0) count++;
    return count;
  }

  /** The mask byte and ground height under world (x, z), or null outside the region. */
  private sample(x: number, z: number): { density: number; y: number } | null {
    const f = this.field, mx = Math.floor((x - f.cornerX) / f.cell), mz = Math.floor((z - f.cornerZ) / f.cell);
    if (mx < 0 || mz < 0 || mx >= f.columns || mz >= f.rows) return null;
    const at = mz * f.columns + mx;
    return { density: (f.mask[at] ?? 0) / U8, y: f.low + ((f.heights[at] ?? 0) / U16) * (f.high - f.low) };
  }

  private seed(cx: number, cz: number): void {
    const f = this.field, slots = this.shape.slots, cell = this.slotOf(cx, cz), base = cell * slots;
    this.keyX[cell] = cx; this.keyZ[cell] = cz;
    const next = stream((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ f.seed) >>> 0);
    for (let k = 0; k < slots; k++) {
      // every slot draws the same seven numbers, kept or not, so a clump never shifts when its neighbour changes
      const x = (cx + next()) * RING_CELL, z = (cz + next()) * RING_CELL;
      const roll = next(), yaw = next() * Math.PI * 2, leanAt = next() * Math.PI * 2, size = next(), tone = next();
      const idx = base + k, ground = this.sample(x, z);
      if (ground === null || roll >= ground.density * this.keep) { this.matrices.fill(0, idx * 16, idx * 16 + 16); continue; }
      const scale = f.scale[0] + (f.scale[1] - f.scale[0]) * size;
      this.axis.set(Math.cos(leanAt), 0, Math.sin(leanAt));
      this.lean.setFromAxisAngle(this.axis, f.tilt * tone);
      this.q.setFromAxisAngle(UP, yaw).premultiply(this.lean);
      this.m.compose(this.p.set(x, ground.y, z), this.q, this.s.set(scale, scale, scale));
      this.m.toArray(this.matrices, idx * 16);
      const [a, b] = f.tint;
      this.colours[idx * 3] = a[0] + (b[0] - a[0]) * tone;
      this.colours[idx * 3 + 1] = a[1] + (b[1] - a[1]) * tone;
      this.colours[idx * 3 + 2] = a[2] + (b[2] - a[2]) * tone;
    }
    this.dirty.push([base, slots]);
  }
}
