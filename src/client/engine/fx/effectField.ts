import { BufferGeometry, CircleGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Points, Vector3, type Material } from 'three';

/**
 * Seeded effect fields (SHARD-PLATFORM W1 C3, effect rows): many copies of one small shape in one draw (a fire's embers,
 * a gust's streaks and petals, an updraft's leaves), every copy placed and moved by the effect's own material graph on
 * the GPU, never by the CPU. Each copy carries `aIndex` (0 … count − 1) and `aSeed` (its golden-ratio fraction, 0 … 1),
 * and, with a `palette`, its colour `aTint` (linear RGB; the palette's sRGB hex in turn). A field stands in its parent's
 * frame where `place` puts it (local −z along the aim). A burst field (`life` seconds) stays hidden until `burst`: placed
 * there, it counts its age up in `aBurst` (x: seconds since the burst, y: the burst's own salt, 0 … 1, so each burst
 * scatters differently) and hides once `life` has passed. Nothing here knows a shard: the shapes are generic, the motion
 * is the shard's graph.
 */

/**
 * The copied shape: a point; a streak (a crossed pair of quads along local −z, length 1 and width 1, uv.x along it and
 * uv.y across); a flake (a five-sided disc 1 wide and 0.55 tall in local xy).
 */
export type EffectShape = 'point' | 'streak' | 'flake';

/** One field: its mesh name, shape and copy count, the copies' colours (sRGB hex, in turn) and a burst's life (s). */
export interface EffectFieldRow {
  readonly name: string;
  readonly shape: EffectShape;
  readonly count: number;
  readonly palette?: readonly number[];
  readonly life?: number;
}

/** A built field: its one draw, its geometry (the caller's scope owns it), its placement, its burst and its tick. */
export interface EffectField {
  readonly object: Mesh<BufferGeometry, Material> | Points<BufferGeometry, Material>;
  readonly geometry: BufferGeometry;
  /** stand the field at `at` with its local −z along `aim` (in its parent's frame) */
  readonly place: (at: Vector3, aim: Vector3) => void;
  /** a burst field: placed, shown, its age back to 0 and `salt` (0 … 1) its scatter */
  readonly burst: (at: Vector3, aim: Vector3, salt: number) => void;
  /** a burst field's clock (seconds since the last tick) */
  readonly update: (dt: number) => void;
}

const FORWARD = new Vector3(0, 0, -1), aimed = new Vector3();

/** The shape's own vertices (position, uv and the triangle list), before any copy. */
function shapeOf(shape: 'streak' | 'flake'): BufferGeometry {
  if (shape === 'flake') return new CircleGeometry(0.5, 5).scale(1, 0.55, 1);
  const position: number[] = [], uv: number[] = [];
  for (const [ax, ay] of [[0.5, 0], [0, 0.5]] as const) {
    for (const [s, z, u, v] of [[-1, 0, 0, 0], [1, 0, 0, 1], [1, -1, 1, 1], [-1, 0, 0, 0], [1, -1, 1, 1], [-1, -1, 1, 0]] as const) { position.push(ax * s, ay * s, z); uv.push(u, v); }
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(position, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); return g;
}

/** A seeded effect field from its row, drawn in the caller's `material` (a graph that moves the copies). */
export function effectField(row: EffectFieldRow, material: Material): EffectField {
  const n = row.count, index = new Float32Array(n), seed = new Float32Array(n), tint = new Float32Array(n * 3), colour = new Color();
  for (let i = 0; i < n; i++) {
    index[i] = i; seed[i] = (i * 0.618034) % 1;
    const hex = row.palette?.[i % row.palette.length];
    if (hex !== undefined) { colour.setHex(hex); tint.set([colour.r, colour.g, colour.b], i * 3); }
  }
  let geometry: BufferGeometry, object: EffectField['object'];
  if (row.shape === 'point') {
    geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('aIndex', new Float32BufferAttribute(index, 1)); geometry.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
    object = new Points(geometry, material);
  } else {
    const base = shapeOf(row.shape), g = new InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    g.setAttribute('aIndex', new InstancedBufferAttribute(index, 1)); g.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
    if (row.palette !== undefined) g.setAttribute('aTint', new InstancedBufferAttribute(tint, 3));
    g.instanceCount = n; geometry = g; object = new Mesh(g, material);
  }
  object.name = row.name; object.frustumCulled = false;
  const life = row.life, clock = life === undefined ? null : new InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(DynamicDrawUsage);
  if (clock !== null) { geometry.setAttribute('aBurst', clock); object.visible = false; }
  let age = 0;
  const place = (at: Vector3, aim: Vector3): void => { object.position.copy(at); object.quaternion.setFromUnitVectors(FORWARD, aimed.copy(aim).normalize()); };
  return { object, geometry, place,
    burst: (at, aim, salt) => {
      if (clock === null) return;
      place(at, aim); age = 0; object.visible = true;
      for (let i = 0; i < n; i++) clock.setXY(i, 0, salt);
      clock.needsUpdate = true;
    },
    update: (dt) => {
      if (clock === null || life === undefined || !object.visible) return;
      age += dt; if (age > life) { object.visible = false; return; }
      for (let i = 0; i < n; i++) clock.setX(i, age);
      clock.needsUpdate = true;
    } };
}
