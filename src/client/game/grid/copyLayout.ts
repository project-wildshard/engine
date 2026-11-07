/**
 * A shared product's copy layout (SHARD-PLATFORM SF52 / G220 pass 2). The copies of one admitted product share its bytes,
 * so before this they differed only in their accent and number (copyIdentity.ts) and the agent playtest found "all four
 * look the same". A copy's catalogue identity may now also declare a `layout`: a seed and the cell-local plots its
 * product leaves for it (clear, level pads). The seed picks, per plot, one landmark from a small dev-map vocabulary (a
 * banded tower, an arch you ride through, a launch deck, twin towers with a skybridge, a stepped stack with a ramp, a
 * gantry with a top deck), its quarter turn and its sizes, so each copy's plots carry different landmarks.
 *
 * Data only and generic (E405): no shard is named here. The same boxes are drawn (one instanced mesh per copy, the
 * structures in the copy's accent and the trim grey: one merged mesh, one draw, ≈ 0.75 KB a box) and collide (one extra declared
 * collider row in that copy's region, `withCopyLayout`), so what you see is what the board hits.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { ACCENTS } from '@wildshard/format/accent';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { CopyIdentity } from '../../../shared/game/grid/catalogue';

/** a copy's declared layout (catalogue.ts) */
export type CopyLayout = NonNullable<CopyIdentity['layout']>;
type Dir = '+u' | '-u' | '+v' | '-v';
/** one landmark box in its plot's frame (u across, v along, metres from the plot centre); `accent` paints it the copy's colour */
interface LocalBox { readonly u: number; readonly y0: number; readonly v: number; readonly w: number; readonly h: number; readonly d: number; readonly accent: boolean }
/** a rideable 0.3 m slab `w` wide climbing `rise` over `run` along `dir` from its low end at (u, v) */
interface LocalRamp { readonly u: number; readonly y0: number; readonly v: number; readonly w: number; readonly run: number; readonly rise: number; readonly dir: Dir }
/** one landmark box in the cell: centre, half extents, rotation (unit quaternion) and paint */
export interface LayoutBox { readonly x: number; readonly y: number; readonly z: number; readonly hx: number; readonly hy: number; readonly hz: number; readonly rot: { x: number; y: number; z: number; w: number } | null; readonly accent: boolean }

/** mulberry32: the seed's deterministic stream */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type Archetype = (half: number, r: () => number) => { boxes: LocalBox[]; ramps: LocalRamp[] };
const box = (u: number, y0: number, v: number, w: number, h: number, d: number, accent: boolean): LocalBox => ({ u, y0, v, w, h, d, accent });
/** the vocabulary: each fits a square plot of `half` metres (≥ 16) */
const ARCHETYPES: readonly Archetype[] = [
  // a banded tower on a plinth
  (_half, r) => {
    const h = 22 + Math.floor(r() * 18), boxes = [box(0, 0, 0, 10, 1, 10, false), box(0, 1, 0, 6, h, 6, true), box(0, h + 1, 0, 4, 3, 4, false)];
    for (let y = 6; y < h; y += 6) boxes.push(box(0, y, 0, 7, 0.5, 7, false));
    return { boxes, ramps: [] };
  },
  // an arch you ride through, with two marker blocks
  (_half, r) => {
    const h = 10 + Math.floor(r() * 6);
    return { boxes: [box(-8, 0, 0, 3, h, 3, true), box(8, 0, 0, 3, h, 3, true), box(0, h, 0, 19, 2.5, 3, true), box(0, h + 2.5, 0, 20, 0.5, 4, false), box(-12, 0, 8, 2, 1.2, 2, false), box(12, 0, -8, 2, 1.2, 2, false)], ramps: [] };
  },
  // a launch deck: up, across, down
  (_half, r) => {
    const rise = 2 + Math.floor(r() * 2);
    return { boxes: [box(2, 0, 0, 10, rise, 10, true), box(2, rise, 0, 10.5, 0.2, 10.5, false), box(2, 0, -8, 0.5, 6, 0.5, false), box(2, 6, -8, 3, 2, 0.4, true)],
      ramps: [{ u: -15, y0: 0, v: 0, w: 6, run: 12, rise, dir: '+u' }, { u: 7, y0: rise, v: 0, w: 6, run: 10, rise: -rise, dir: '+u' }] };
  },
  // twin towers joined by a skybridge
  (_half, r) => {
    const a = 16 + Math.floor(r() * 10), b = 12 + Math.floor(r() * 8), y = Math.min(a, b) - 4;
    return { boxes: [box(0, 0, -9, 6, a, 6, true), box(0, 0, 9, 6, b, 6, true), box(0, a, -9, 7, 0.5, 7, false), box(0, b, 9, 7, 0.5, 7, false), box(0, y, 0, 3, 2, 12, false)], ramps: [] };
  },
  // a stepped stack with a ramp onto its first tier
  (_half, r) => {
    const t = 3 + Math.floor(r() * 2);
    return { boxes: [box(2, 0, 0, 16, t, 16, true), box(2, t, 0, 11, t, 11, false), box(2, 2 * t, 0, 6, t, 6, true)], ramps: [{ u: -18, y0: 0, v: 0, w: 5, run: 12, rise: t, dir: '+u' }] };
  },
  // a gantry: four legs, two beams and a top deck carrying a block
  (_half, r) => {
    const h = 8 + Math.floor(r() * 5), boxes = [box(0, h, 0, 18, 0.5, 18, false), box(0, h + 0.5, 0, 6, 3, 6, true)];
    for (const u of [-8, 8]) { for (const v of [-8, 8]) boxes.push(box(u, 0, v, 1, h, 1, true)); boxes.push(box(u, h - 1.2, 0, 1.2, 1.2, 17, true)); }
    return { boxes, ramps: [] };
  },
];

/** the plot frame's quarter turn: local (u, v) → cell (x, z) offsets */
const turn = (q: number, u: number, v: number): [number, number] => (q === 0 ? [u, v] : q === 1 ? [v, -u] : q === 2 ? [-u, -v] : [-v, u]);
const axis = new Vector3(), quat = new Quaternion();

/** Every landmark box of a copy's layout, in cell-local metres (deterministic in the seed). */
export function copyLayoutBoxes(layout: CopyLayout): LayoutBox[] {
  const r = stream(layout.seed), order = ARCHETYPES.map((_, i) => i);
  // a seeded shuffle, so the first plots of two seeds rarely share a landmark
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), a = order[i] ?? 0; order[i] = order[j] ?? 0; order[j] = a; }
  const out: LayoutBox[] = [];
  layout.plots.forEach((plot, index) => {
    const make = ARCHETYPES[order[index % order.length] ?? 0]; if (make === undefined) return;
    const q = Math.floor(r() * 4), { boxes, ramps } = make(plot.half, r);
    for (const b of boxes) {
      const [dx, dz] = turn(q, b.u, b.v), odd = q % 2 === 1;
      out.push({ x: plot.x + dx, y: b.y0 + b.h / 2, z: plot.z + dz, hx: (odd ? b.d : b.w) / 2, hy: b.h / 2, hz: (odd ? b.w : b.d) / 2, rot: null, accent: b.accent });
    }
    for (const ramp of ramps) {
      const t = 0.3, length = Math.hypot(ramp.run, ramp.rise), angle = Math.atan2(ramp.rise, ramp.run);
      const along = ramp.dir === '+u' || ramp.dir === '+v' ? 1 : -1, onU = ramp.dir === '+u' || ramp.dir === '-u';
      const cu = onU ? ramp.u + along * ramp.run / 2 : ramp.u, cv = onU ? ramp.v : ramp.v + along * ramp.run / 2;
      // the climb direction in the cell: the frame's +u / +v unit turned, then a tilt about the horizontal axis across it
      const [fx, fz] = turn(q, onU ? along : 0, onU ? 0 : along), [dx, dz] = turn(q, cu, cv);
      axis.set(-fz, 0, fx); quat.setFromAxisAngle(axis, angle);
      const alongX = Math.abs(fx) > 0.5;
      out.push({ x: plot.x + dx, y: ramp.y0 + ramp.rise / 2 - (t / 2) * Math.cos(angle), z: plot.z + dz, hx: (alongX ? length : ramp.w) / 2, hy: t / 2, hz: (alongX ? ramp.w : length) / 2,
        rot: { x: quat.x, y: quat.y, z: quat.z, w: quat.w }, accent: false });
    }
  });
  return out;
}

const GREY = new Color(0x9aa0a6);
/**
 * The copy's landmarks as one merged mesh (one draw: every box's 24 corners transformed into one buffer, its paint per
 * vertex; ≈ 0.75 KB a box with 8-bit colours), or null without a layout.
 */
export function copyLayoutMesh(identity: CopyIdentity | undefined): { mesh: Mesh; dispose: () => void } | null {
  if (identity?.layout === undefined) return null;
  const boxes = copyLayoutBoxes(identity.layout); if (boxes.length === 0) return null;
  const unit = new BoxGeometry(1, 1, 1), up = unit.getAttribute('position'), un = unit.getAttribute('normal'), index = unit.getIndex();
  if (index === null) throw new Error('copy layout: an indexed unit box');
  const corners = up.count, count = boxes.length * corners;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colours = new Uint8Array(count * 4), indices = new Uint16Array(boxes.length * index.count);
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), v = new Vector3(), accent = new Color(ACCENTS[identity.accent]);
  boxes.forEach((b, i) => {
    q.set(b.rot?.x ?? 0, b.rot?.y ?? 0, b.rot?.z ?? 0, b.rot?.w ?? 1);
    m.compose(p.set(b.x, b.y, b.z), q, s.set(b.hx * 2, b.hy * 2, b.hz * 2));
    const paint = b.accent ? accent : GREY, base = i * corners;
    for (let k = 0; k < corners; k++) {
      const o = base + k;
      v.fromBufferAttribute(up, k).applyMatrix4(m); positions.set([v.x, v.y, v.z], o * 3);
      v.fromBufferAttribute(un, k).applyQuaternion(q); normals.set([v.x, v.y, v.z], o * 3);
      colours.set([Math.round(paint.r * 255), Math.round(paint.g * 255), Math.round(paint.b * 255), 255], o * 4);
    }
    for (let k = 0; k < index.count; k++) indices[i * index.count + k] = base + index.getX(k);
  });
  unit.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setAttribute('normal', new BufferAttribute(normals, 3)); geometry.setAttribute('color', new BufferAttribute(colours, 4, true));
  geometry.setIndex(new BufferAttribute(indices, 1)); geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.85 }), mesh = new Mesh(geometry, material);
  mesh.name = 'copy-layout'; mesh.castShadow = true; mesh.receiveShadow = true;
  return { mesh, dispose: () => { geometry.dispose(); material.dispose(); mesh.removeFromParent(); } };
}

/**
 * The copy's region source: the shared product's declaration with one more collider row, `copy.layout`, holding its
 * landmarks' boxes (always active). A placement without a layout, or a product without props, is returned unchanged.
 */
export function withCopyLayout<T extends { readonly props: Shardfile['props'] }>(source: T, identity: CopyIdentity | undefined): T {
  if (identity?.layout === undefined || source.props === null) return source;
  // JSON numbers only (declared props refuse −0)
  const n = (value: number): number => (value === 0 ? 0 : value);
  const shapes = copyLayoutBoxes(identity.layout).map((b) => {
    const shape = { kind: 'box' as const, x: n(b.x), y: n(b.y), z: n(b.z), hx: b.hx, hy: b.hy, hz: b.hz, surface: 'stone' as const };
    return b.rot === null ? shape : Object.assign(shape, { rot: { x: n(b.rot.x), y: n(b.rot.y), z: n(b.rot.z), w: n(b.rot.w) } });
  });
  if (shapes.length === 0) return source;
  return { ...source, props: { ...source.props, colliders: [...source.props.colliders, { id: 'copy.layout', panel: null, initialActive: true, shapes }] } };
}
