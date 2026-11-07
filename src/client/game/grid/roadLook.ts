/**
 * The boulevard's look (SHARD-PLATFORM SF17b look, G80 / G81 / G93): the asphalt the deck's road band wears, its
 * markings, kerbs, turn-ins, roundabouts, streetlights and green distance signs, drawn over the generator's deck in the
 * home frame. A handful of draws for the whole grid: one asphalt mesh (one canvas texture), one junction mesh (one
 * canvas), one sign mesh (one canvas atlas); the kerbs, islands and
 * streetlights join the road system's one solid material (`roadSolid.ts`). No shadow casters (the 80 m rule) and no colliders: the deck's own trimesh stays the ground.
 *
 * The layout is `roadLayout.ts`; sign text comes from the catalogue's slugs through the shard registry.
 */
import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh,
  MeshLambertMaterial, NoColorSpace, type Object3D, Quaternion, RepeatWrapping, RGFormat, SRGBColorSpace, type Texture, UnsignedByteType, Vector3,
} from 'three';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { putRoadGrain, roadGrainSteps, type RoadGrainSource } from './roadGrain';
import { packRoadSignPixels } from './roadSignPixels';
import { paintRoadSignCanvas, roadSignPaintLayout, roadSignLineKey as lineKey, SIGN_LINE_W as LINE_W, SIGN_LINE_H as LINE_H, type RoadSignSource } from './roadSignPaint';
import { ownRoadMesh } from './roadResources';
import { ROAD_SKY } from './frameModel';
import { coverageMaterial, coverageTable, gpuOnlyTextureBytes, uniformPart, type CoverageColours, type SolidPart } from './roadSolid';
import { bytePlan, cullIntoSteps, gpuOnlyRoad, meshBytesSteps, type CullSource, type RoadCuller } from './roadCull';
import { allocateRenderSteps, type PlatformRenderAdmission } from './renderResidency';
import {
  ENTRY_ASPHALT, GAP_HALF, RING_ISLAND, RING_OUTER, ROAD_HALF, SEGMENT_HALF, TURN_IN_HALF, segmentPoint,
  type ArmSide, type LookScope, type RoadJunction, type RoadLayout, type RoadSign, type SignLine,
} from '../../../shared/game/grid/roadLayout';

/** What the look draws into and how it hands its meshes to the frame (SF19a's neutral highway slot). */
export interface RoadLookInput {
  readonly layout: RoadLayout;
  readonly home: GridCell;
  readonly scene: Object3D;
  readonly scope: LookScope;
  /** Optional scoped worker pixels; absent planes use the identical original paint steps. */
  readonly grain?: RoadGrainSource;
  /** Scoped initial-ring coverage; mismatched rows retain the original painter. */
  readonly signs?: RoadSignSource;
  /** the road system's one solid material takes the kerbs, islands and streetlights (SF17b per-view budget) */
  readonly solid: (part: SolidPart) => void;
  /** the per-view cull for each textured mesh (`roadCull.ts`); a bare hook is the pre-G144 call (no admission with it) */
  readonly cull?: RoadCuller | ((mesh: Mesh) => void);
  /** G144: admit each textured mesh's byte plan before building it (absent: the unchanged build) */
  readonly admission?: PlatformRenderAdmission;
  /** G103: the asphalt and junction overlays keep the road's light where a cell's own light owns the frame */
  readonly overlayLight?: RoadOverlayLight;
  /** Bind a source's shrink-only charge after its backing is durable. */
  readonly retireGeometry?: (mesh: Mesh, id: string, retainedBytes: number) => void;
}

/**
 * The road's light on its own flat asphalt (G165's fixed "grid dawn" key at its elevation, plus its hemisphere sky), as
 * the Lambert term the overlay reflects under it: (key · sin(elevation) + hemisphere sky) / π, linear RGB.
 */
export const ROAD_OVERLAY_LIGHT: readonly [number, number, number] = (() => {
  const { sun, hemi } = ROAD_SKY, up = Math.sin(sun.elevation * Math.PI / 180);
  const at = (k: 0 | 1 | 2): number => (sun.colour[k] * sun.intensity * up + hemi.sky[k] * hemi.intensity) / Math.PI;
  return [at(0), at(1), at(2)] as const;
})();

/**
 * G103: the 15 m of road asphalt forced into every shard is the platform's style, so it keeps the road's light inside the
 * cell too. Under a cell's own light (Signal Dunes' dusk key and grade) the dark asphalt read as a black hole at each entry
 * (W1 grid-ready check, 2026-10-14). The frame tells this the road's weight each frame: at 1 (on the road) the overlays are
 * lit exactly as before; toward 0 (inside a cell) their lit share fades and the same map, as emissive, shows the road's own
 * light on it (`ROAD_OVERLAY_LIGHT`). Uniforms only: the emissive map is part of the program from the build, so nothing
 * compiles at a crossing.
 */
export class RoadOverlayLight {
  private readonly materials = new Set<MeshLambertMaterial>();
  private w = 1;
  /** Hold an overlay material until its owner scope disposes. */
  add(material: MeshLambertMaterial, owner: LookScope): void {
    this.materials.add(material); this.apply(material);
    owner.onDispose(() => { this.materials.delete(material); });
  }
  /** The road's weight (0..1) this frame. */
  weight(w: number): void {
    const next = Math.max(0, Math.min(1, w));
    if (next === this.w) return;
    this.w = next;
    for (const material of this.materials) this.apply(material);
  }
  /** The readout: the road weight last applied. */
  applied(): number { return this.w; }
  private apply(material: MeshLambertMaterial): void {
    const glow = 1 - this.w;
    material.color.setScalar(this.w);
    material.emissive.setRGB(ROAD_OVERLAY_LIGHT[0] * glow, ROAD_OVERLAY_LIGHT[1] * glow, ROAD_OVERLAY_LIGHT[2] * glow);
  }
}
/** The readout (tests, the board). */
export interface RoadLookState { readonly segments: number; readonly junctions: number; readonly roundabouts: number; readonly signs: number; readonly lights: number; readonly draws: number }

const LIFT = 0.02; // the overlay's height over the deck's road band (polygon offset does the rest)
const YELLOW = '#e0b23a', WHITE = '#e9ebe6', KERB = new Color(0x9a9c98), ISLAND = new Color(0x4f6a35), SIGN_GREEN = '#0d6b3c';

/** A tiny triangle builder: positions, normals, uvs, colours, one index buffer. */
class Mesher {
  readonly p: number[] = []; readonly n: number[] = []; readonly uv: number[] = []; readonly c: number[] = []; readonly i: number[] = [];
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0, colour?: Color): number {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(colour?.r ?? 1, colour?.g ?? 1, colour?.b ?? 1);
    return this.p.length / 3 - 1;
  }
  /** A triangle, wound so its face looks along vertex `a`'s normal (callers never think about winding). */
  tri(a: number, b: number, c: number): void {
    const p = this.p, at = (k: number, o: number): number => p[k * 3 + o] ?? 0;
    const ux = at(b, 0) - at(a, 0), uy = at(b, 1) - at(a, 1), uz = at(b, 2) - at(a, 2), vx = at(c, 0) - at(a, 0), vy = at(c, 1) - at(a, 1), vz = at(c, 2) - at(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, n = this.n;
    if (nx * (n[a * 3] ?? 0) + ny * (n[a * 3 + 1] ?? 0) + nz * (n[a * 3 + 2] ?? 0) < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
  /** A quad a-b-c-d in order round its edge (either way round). */
  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }
  /** The triangles as a solid part's arrays (vertex colours, uv, no layer yet). */
  part(): { positions: Float32Array; normals: Float32Array; colours: Float32Array; uvs: Float32Array; indices: Uint32Array } {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), colours: new Float32Array(this.c), uvs: new Float32Array(this.uv), indices: new Uint32Array(this.i) };
  }
  geometry(colours = false): BufferGeometry {
    const g = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3)).setAttribute('normal', new BufferAttribute(new Float32Array(this.n), 3))
      .setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2)).setIndex(new BufferAttribute(new Uint32Array(this.i), 1));
    if (colours) g.setAttribute('color', new BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    return g;
  }
  /** A box from foot `a` to foot `b` on the ground at `y0`, `width` across and `height` tall (sides and top; no bottom). */
  beam(a: { x: number; z: number }, b: { x: number; z: number }, y0: number, width: number, height: number, colour: Color, uv?: readonly [number, number]): void {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const ox = (-dz / len) * width / 2, oz = (dx / len) * width / 2, y1 = y0 + height, [u, v] = uv ?? [0, 0];
    const top = [this.vertex(a.x - ox, y1, a.z - oz, 0, 1, 0, u, v, colour), this.vertex(b.x - ox, y1, b.z - oz, 0, 1, 0, u, v, colour), this.vertex(b.x + ox, y1, b.z + oz, 0, 1, 0, u, v, colour), this.vertex(a.x + ox, y1, a.z + oz, 0, 1, 0, u, v, colour)] as const;
    this.quad(top[0], top[1], top[2], top[3]);
    const side = (p: { x: number; z: number }, q: { x: number; z: number }, nx: number, nz: number): void => {
      const s = [this.vertex(p.x, y0, p.z, nx, 0, nz, u, v, colour), this.vertex(q.x, y0, q.z, nx, 0, nz, u, v, colour), this.vertex(q.x, y1, q.z, nx, 0, nz, u, v, colour), this.vertex(p.x, y1, p.z, nx, 0, nz, u, v, colour)] as const;
      this.quad(s[0], s[1], s[2], s[3]);
    };
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    side({ x: a.x + ox, z: a.z + oz }, { x: b.x + ox, z: b.z + oz }, nx, nz);
    side({ x: b.x - ox, z: b.z - oz }, { x: a.x - ox, z: a.z - oz }, -nx, -nz);
    side({ x: a.x - ox, z: a.z - oz }, { x: a.x + ox, z: a.z + oz }, -ux, -uz);
    side({ x: b.x + ox, z: b.z + oz }, { x: b.x - ox, z: b.z - oz }, ux, uz);
  }
}

function canvas(w: number, h: number): { el: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const el = document.createElement('canvas'); el.width = w; el.height = h;
  const g = el.getContext('2d'); if (g === null) throw new Error('No 2D canvas for the road look');
  return { el, g };
}
function texture(el: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const t = new CanvasTexture(el); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; t.minFilter = LinearMipmapLinearFilter;
  if (repeat) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  return t;
}

/** The road canvas: u [0, 0.5) the normal section, [0.5, 1) the turn-in section; v one 12 m period of dashes. */
const ROAD_PERIOD = 12;
function* roadTextureSteps(grain?: RoadGrainSource): Generator<void, CanvasTexture> {
  const W = 1024, H = 512, { el, g } = canvas(W, H);
  const plane = grain?.('asphalt');
  if (plane === undefined) yield* roadGrainSteps(g, W, H, 1); else putRoadGrain(g, 'asphalt', plane);
  const half = W / 2, px = (t: number, base: number): number => base + (t + ROAD_HALF) / (2 * ROAD_HALF) * half, pm = half / (2 * ROAD_HALF);
  for (const base of [0, half]) {
    const turnIn = base > 0;
    // wheel paths: faint darker wear in each lane
    g.fillStyle = 'rgba(20,22,26,0.07)';
    for (const t of [-5.9, -4.3, -2.6, -1.0, 1.0, 2.6, 4.3, 5.9]) g.fillRect(px(t, base) - 0.45 * pm, 0, 0.9 * pm, H);
    g.fillStyle = YELLOW; // the double yellow centre line (G80)
    for (const t of [-0.17, 0.17]) g.fillRect(px(t, base) - 0.06 * pm, 0, 0.12 * pm, H);
    g.fillStyle = WHITE; // lane dividers: 3 m dash in a 12 m period
    for (const t of [-3.55, 3.55]) g.fillRect(px(t, base) - 0.06 * pm, 0, 0.12 * pm, H * 3 / ROAD_PERIOD);
    for (const t of [-7.0, 7.0]) { // edge lines; at a turn-in, short dashes so the opening reads
      if (!turnIn) g.fillRect(px(t, base) - 0.075 * pm, 0, 0.15 * pm, H);
      else for (let k = 0; k < 6; k++) g.fillRect(px(t, base) - 0.075 * pm, k * H / 6, 0.15 * pm, H / 12);
    }
  }
  return texture(el, true);
}

/** The junction canvas: 62.5 m square; the roundabout's markings in the middle, plain asphalt in the corners. */
function* junctionTextureSteps(grain?: RoadGrainSource): Generator<void, CanvasTexture> {
  const W = 1024, { el, g } = canvas(W, W), k = W / (2 * GAP_HALF);
  const plane = grain?.('junction');
  if (plane === undefined) yield* roadGrainSteps(g, W, W, 2); else putRoadGrain(g, 'junction', plane);
  const P = (x: number, z: number): [number, number] => [(x + GAP_HALF) * k, (GAP_HALF - z) * k];
  const arc = (r: number, a0: number, a1: number, width: number, colour: string, dash?: readonly [number, number]): void => {
    g.strokeStyle = colour; g.lineWidth = width * k; g.setLineDash(dash === undefined ? [] : [dash[0] * k, dash[1] * k]);
    const [cx, cy] = P(0, 0); g.beginPath(); g.arc(cx, cy, r * k, -a1, -a0); g.stroke(); g.setLineDash([]);
  };
  const open = Math.asin((ROAD_HALF + 0.3) / (RING_OUTER - 0.5));
  for (let q = 0; q < 4; q++) arc(RING_OUTER - 0.5, q * Math.PI / 2 + open, (q + 1) * Math.PI / 2 - open, 0.15, WHITE); // outer edge line between the arms
  arc(RING_ISLAND + 0.45, 0, Math.PI * 2, 0.15, WHITE); // inner edge line
  arc((RING_ISLAND + RING_OUTER) / 2, 0, Math.PI * 2, 0.12, WHITE, [3, 3]); // the circulating lane divider
  const sides: readonly { x: number; z: number }[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
  for (const d of sides) {
    const rx = -d.z, rz = d.x; // the across unit
    const line = (t: number, r0: number, r1: number, width: number, colour: string, dash = 0): void => {
      g.fillStyle = colour;
      for (let r = r0; r < r1; r += dash > 0 ? dash * 4 : r1 - r0) {
        const e = Math.min(r1, r + (dash > 0 ? dash : r1 - r0)), [ax, ay] = P(d.x * r + rx * (t - width / 2), d.z * r + rz * (t - width / 2)), [bx, by] = P(d.x * e + rx * (t + width / 2), d.z * e + rz * (t + width / 2));
        g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      }
    };
    for (const t of [-0.17, 0.17]) line(t, RING_OUTER + 3, GAP_HALF, 0.12, YELLOW);
    for (const t of [-3.55, 3.55]) line(t, RING_OUTER + 3, GAP_HALF, 0.12, WHITE, 3);
    for (const t of [-7.0, 7.0]) line(t, RING_OUTER + 0.5, GAP_HALF, 0.15, WHITE);
    // give way: the entry half is on the inbound traveller's right (three's mirrored frame: −across), dashed, a triangle per lane
    const entry = -1;
    for (let t = 0.4; t < 6.9; t += 0.9) line(entry * (t + 0.3), RING_OUTER + 0.9, RING_OUTER + 1.2, 0.6, WHITE);
    for (const t of [1.8, 5.3]) {
      const tip = RING_OUTER + 2.2, base = tip + 2.6, [ax, ay] = P(d.x * tip + rx * t * entry, d.z * tip + rz * t * entry);
      const [bx, by] = P(d.x * base + rx * (t * entry + 0.7), d.z * base + rz * (t * entry + 0.7)), [cx, cy] = P(d.x * base + rx * (t * entry - 0.7), d.z * base + rz * (t * entry - 0.7));
      g.strokeStyle = WHITE; g.lineWidth = 0.15 * k; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.closePath(); g.stroke();
    }
  }
  return texture(el, false);
}

/** The asphalt over every segment: three quads each (the middle one the turn-in section), UVs into the road canvas. */
function asphalt(layout: RoadLayout, home: GridCell): Mesher {
  const m = new Mesher();
  for (const segment of layout.segments) {
    for (const [s0, s1, base] of [[-SEGMENT_HALF, -TURN_IN_HALF, 0], [-TURN_IN_HALF, TURN_IN_HALF, 0.5], [TURN_IN_HALF, SEGMENT_HALF, 0]] as const) {
      const corner = (s: number, t: number): number => {
        const p = segmentPoint(segment, s, t);
        return m.vertex(p.x - home.origin.x, LIFT, p.z - home.origin.z, 0, 1, 0, base + (t + ROAD_HALF) / (2 * ROAD_HALF) * 0.5 * 0.998 + 0.0005, s / ROAD_PERIOD);
      };
      const a = corner(s0, -ROAD_HALF), b = corner(s1, -ROAD_HALF), c = corner(s1, ROAD_HALF), d = corner(s0, ROAD_HALF);
      m.quad(a, b, c, d);
    }
    // turn-in aprons (G93 / G103): asphalt from the road edge across the strip and 15 m INTO the shard past its cell edge
    // (the platform's style is forced into the shard: the entry is at road height, G99), edge lines down both sides
    for (const [cell, t] of [[segment.low, -1], [segment.high, 1]] as const) {
      if (cell === undefined) continue;
      const v = (s: number, tt: number, u: number): number => { const p = segmentPoint(segment, s, tt); return m.vertex(p.x - home.origin.x, LIFT, p.z - home.origin.z, 0, 1, 0, u, tt / ROAD_PERIOD); };
      // the plain turn-in section for the floor; the normal section's solid edge line (t = 7) for the two edge strips
      const far = t * (GAP_HALF + ENTRY_ASPHALT), plain = 0.5 + 0.0005, line = (7.0 + ROAD_HALF) / (2 * ROAD_HALF) * 0.5;
      for (const [s0, s1, u] of [[-TURN_IN_HALF, -TURN_IN_HALF + 0.15, line], [-TURN_IN_HALF + 0.15, TURN_IN_HALF - 0.15, plain], [TURN_IN_HALF - 0.15, TURN_IN_HALF, line]] as const) {
        m.quad(v(s0, t * ROAD_HALF, u), v(s1, t * ROAD_HALF, u), v(s1, far, u), v(s0, far, u));
      }
    }
  }
  return m;
}

const RETURN = 6; // a plain junction's kerb-return radius
const ARM_UNIT: Readonly<Record<ArmSide, { x: number; z: number }>> = { east: { x: 1, z: 0 }, west: { x: -1, z: 0 }, north: { x: 0, z: 1 }, south: { x: 0, z: -1 } };
/** The junctions' asphalt: a roundabout's disc and arms with planar UVs into the junction canvas; a plain junction's square,
 *  arms and kerb-return fillets mapped into the canvas's plain corner. */
function junctionAsphalt(layout: RoadLayout, home: GridCell): Mesher {
  const m = new Mesher(), span = 2 * GAP_HALF;
  for (const j of layout.junctions) {
    const ox = j.centre.x - home.origin.x, oz = j.centre.z - home.origin.z;
    const ring = j.roundabout;
    const uvOf = (x: number, z: number): [number, number] => ring ? [(x + GAP_HALF) / span, (z + GAP_HALF) / span] : [(2 + (x + GAP_HALF) * 0.45) / span, (2 + (z + GAP_HALF) * 0.45) / span];
    const v = (x: number, z: number): number => { const [u, w] = uvOf(x, z); return m.vertex(ox + x, LIFT, oz + z, 0, 1, 0, u, w); };
    const rect = (x0: number, z0: number, x1: number, z1: number): void => { m.quad(v(x0, z0), v(x0, z1), v(x1, z1), v(x1, z0)); };
    if (ring) { // the disc
      const centre = v(0, 0), n = 48, rim: number[] = [];
      for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2; rim.push(v(Math.cos(a) * RING_OUTER, Math.sin(a) * RING_OUTER)); }
      for (let k = 0; k < n; k++) m.tri(centre, rim[k] ?? centre, rim[k + 1] ?? centre);
    } else rect(-ROAD_HALF, -ROAD_HALF, ROAD_HALF, ROAD_HALF);
    for (const side of ['east', 'west', 'north', 'south'] as const) {
      if (!j.arms[side]) continue;
      const d = ARM_UNIT[side], r0 = ring ? RING_OUTER - 2 : ROAD_HALF;
      const xs = [d.x * r0, d.x * GAP_HALF], zs = [d.z * r0, d.z * GAP_HALF];
      if (d.x !== 0) rect(Math.min(xs[0] ?? 0, xs[1] ?? 0), -ROAD_HALF, Math.max(xs[0] ?? 0, xs[1] ?? 0), ROAD_HALF);
      else rect(-ROAD_HALF, Math.min(zs[0] ?? 0, zs[1] ?? 0), ROAD_HALF, Math.max(zs[0] ?? 0, zs[1] ?? 0));
    }
    if (!ring) for (const [qx, qz, a, b] of quadrants(j)) if (a && b) { // kerb-return fillets
      const cx = qx * (ROAD_HALF + RETURN), cz = qz * (ROAD_HALF + RETURN), corner = v(qx * ROAD_HALF, qz * ROAD_HALF), pts: number[] = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI / 2; pts.push(v(cx - qx * RETURN * Math.cos(t), cz - qz * RETURN * Math.sin(t))); }
      for (let k = 0; k < 8; k++) m.tri(corner, pts[k] ?? corner, pts[k + 1] ?? corner);
    }
  }
  return m;
}
/** Each quadrant (qx, qz) with whether its x-arm and z-arm exist. */
function quadrants(j: RoadJunction): [1 | -1, 1 | -1, boolean, boolean][] {
  const out: [1 | -1, 1 | -1, boolean, boolean][] = [];
  for (const qx of [1, -1] as const) for (const qz of [1, -1] as const) out.push([qx, qz, qx > 0 ? j.arms.east : j.arms.west, qz > 0 ? j.arms.north : j.arms.south]);
  return out;
}

/** Kerbs along every segment (open at the turn-ins), round each junction, and the roundabouts' raised islands. */
function kerbs(layout: RoadLayout, home: GridCell): SolidPart {
  const m = new Mesher(), W = 0.25, H = 0.15, at = (p: { x: number; z: number }): { x: number; z: number } => ({ x: p.x - home.origin.x, z: p.z - home.origin.z });
  const kt = ROAD_HALF + W / 2;
  for (const segment of layout.segments) for (const [cell, t] of [[segment.low, -1], [segment.high, 1]] as const) {
    const runs: readonly (readonly [number, number])[] = cell === undefined ? [[-SEGMENT_HALF, SEGMENT_HALF]] : [[-SEGMENT_HALF, -TURN_IN_HALF], [TURN_IN_HALF, SEGMENT_HALF]];
    for (const [s0, s1] of runs) m.beam(at(segmentPoint(segment, s0, t * kt)), at(segmentPoint(segment, s1, t * kt)), 0, W, H, KERB);
    if (cell !== undefined) for (const s of [-TURN_IN_HALF, TURN_IN_HALF]) { // the turn-in's kerbs run out to the cell edge
      m.beam(at(segmentPoint(segment, s, t * kt)), at(segmentPoint(segment, s, t * (GAP_HALF - 0.5))), 0, W, H, KERB);
    }
  }
  const polyline = (o: { x: number; z: number }, pts: readonly { x: number; z: number }[]): void => {
    for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; if (a !== undefined && b !== undefined) m.beam({ x: o.x + a.x, z: o.z + a.z }, { x: o.x + b.x, z: o.z + b.z }, 0, W, H, KERB); }
  };
  const arcPts = (cx: number, cz: number, r: number, a0: number, a1: number, n: number): { x: number; z: number }[] => Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + (a1 - a0) * k / n; return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  });
  for (const j of layout.junctions) {
    const o = at(j.centre);
    for (const [qx, qz, ex, ez] of quadrants(j)) {
      if (j.roundabout) { // the ring's outer kerb between two arms, and each arm's edge out to the corridor
        const r = RING_OUTER + W / 2, a = Math.asin(kt / r), base = Math.atan2(qz, qx) - Math.PI / 4;
        polyline(o, arcPts(0, 0, r, base + a, base + Math.PI / 2 - a, 10));
        const reach = Math.sqrt(r * r - kt * kt);
        polyline(o, [{ x: qx * reach, z: qz * kt }, { x: qx * GAP_HALF, z: qz * kt }]);
        polyline(o, [{ x: qx * kt, z: qz * reach }, { x: qx * kt, z: qz * GAP_HALF }]);
      } else if (ex && ez) { // a kerb return
        const cx = qx * (ROAD_HALF + RETURN), cz = qz * (ROAD_HALF + RETURN), r = RETURN - W / 2, a0 = Math.atan2(-qz, 0), a1 = Math.atan2(0, -qx);
        let turn = a1 - a0; if (turn > Math.PI) turn -= 2 * Math.PI; if (turn < -Math.PI) turn += 2 * Math.PI;
        polyline(o, [{ x: qx * GAP_HALF, z: qz * kt }, ...arcPts(cx, cz, r, a0, a0 + turn, 8), { x: qx * kt, z: qz * GAP_HALF }]);
      } else if (ex) polyline(o, [{ x: 0, z: qz * kt }, { x: qx * GAP_HALF, z: qz * kt }]);
      else if (ez) polyline(o, [{ x: qx * kt, z: 0 }, { x: qx * kt, z: qz * GAP_HALF }]);
      else polyline(o, [{ x: qx * kt, z: 0 }, { x: qx * kt, z: qz * kt }, { x: 0, z: qz * kt }]);
    }
    if (j.roundabout) { // the island: a kerb ring and a planted top
      const ring = arcPts(0, 0, RING_ISLAND - W / 2, 0, Math.PI * 2, 32);
      polyline(o, ring);
      const centre = m.vertex(o.x, H * 1.2, o.z, 0, 1, 0, 0, 0, ISLAND), rim = ring.map((p) => m.vertex(o.x + p.x, H, o.z + p.z, 0, 1, 0, 0, 0, ISLAND));
      for (let k = 0; k < rim.length - 1; k++) m.tri(centre, rim[k] ?? centre, rim[k + 1] ?? centre);
    }
  }
  return uniformPart(m.part(), 'white');
}

/** Streetlights: a pole + arm and a lamp head per light, merged into the solid material (the head unlit, as it always was). */
function streetlights(layout: RoadLayout, home: GridCell): { poles: SolidPart; heads: SolidPart } {
  const pole = new Mesher(), head = new Mesher(), grey = new Color(0x5d6166);
  const HEIGHT = 8.2, REACH = 1.9;
  // a square-section pole (cheap), an arm toward +x, the head under the arm's tip
  pole.beam({ x: -0.07, z: 0 }, { x: 0.07, z: 0 }, 0, 0.14, HEIGHT, grey);
  pole.beam({ x: 0, z: 0 }, { x: REACH, z: 0 }, HEIGHT - 0.12, 0.09, 0.09, grey);
  head.beam({ x: REACH - 0.45, z: 0 }, { x: REACH + 0.15, z: 0 }, HEIGHT - 0.24, 0.26, 0.14, new Color(0xfff0c8));
  const place = (template: Mesher, unlit: boolean): SolidPart => {
    const out = new Mesher(), matrix = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), pos = new Vector3(), one = new Vector3(1, 1, 1), v = new Vector3(), n = new Vector3();
    for (const light of layout.lights) {
      q.setFromAxisAngle(up, Math.atan2(-light.reach.z, light.reach.x));
      matrix.compose(pos.set(light.at.x - home.origin.x, 0, light.at.z - home.origin.z), q, one);
      const base = out.p.length / 3;
      for (let k = 0; k < template.p.length / 3; k++) {
        v.set(template.p[k * 3] ?? 0, template.p[k * 3 + 1] ?? 0, template.p[k * 3 + 2] ?? 0).applyMatrix4(matrix);
        n.set(template.n[k * 3] ?? 0, template.n[k * 3 + 1] ?? 0, template.n[k * 3 + 2] ?? 0).applyQuaternion(q);
        out.p.push(v.x, v.y, v.z); out.n.push(n.x, n.y, n.z); out.uv.push(0, 0); out.c.push(template.c[k * 3] ?? 1, template.c[k * 3 + 1] ?? 1, template.c[k * 3 + 2] ?? 1);
      }
      for (const i of template.i) out.i.push(i + base);
    }
    return uniformPart(out.part(), 'white', unlit);
  };
  return { poles: place(pole, false), heads: place(head, true) };
}

/**
 * Sign text atlas: one cell per unique line (white on sign green), plus green / white swatches for boards and rims.
 *
 * G227 (platform atlas): every texel the signs sample is SIGN_GREEN, WHITE or the canvas's antialiased blend of the two, so
 * two channels carry it. The atlas was an sRGB RGBA8 canvas: the GPU decodes each texel to linear light, then filters
 * (mips, trilinear, anisotropic) in linear light. It is now an RG8 array (half of RGBA8) of linear-light coverage: per
 * texel the fraction t of the way from green to white of its red channel and of its green channel, in linear light, so
 * every filter the GPU runs on t is the same linear-light filter it ran on the decoded colour (colour = mix(green, white,
 * t) per channel is affine in t). Blue rides on red and green (`SIGN_BLUE_FROM_RED`); a texel lands within 1 LSB of the
 * canvas in green, 1.4 in blue and 4 in red at the dark end. The atlas is exactly as tall as its rows (WebGL2 mips any
 * size), not the next power of two. The grey posts and board backs sample no texel: their uv sits on a sentinel row past
 * v = 1 that the material paints SIGN_GREY (a constant uv always read the swatch's one texel at level 0, so the grey is
 * unchanged). progress/shard-platform/platform-atlas/ holds the before / after captures.
 */
const SIGN_GREY = '#6f7378', GREY_V = 2;
/** Blue's coverage as red's and green's blend (least worst over every green-to-white canvas blend: within 1.4 LSB). */
const SIGN_BLUE_FROM_RED = 0.45;
const signCoverage = (): CoverageColours => ({ from: SIGN_GREEN, to: WHITE, blueFromRed: SIGN_BLUE_FROM_RED, sentinel: { v: GREY_V - 0.5, colour: SIGN_GREY } });
/** The atlas's layout, pure (its size and every uv), so the sign mesh and its byte plan never need the canvas. */
interface SignAtlasLayout {
  readonly keys: readonly string[]; readonly lines: ReadonlyMap<string, SignLine>; readonly width: number; readonly height: number;
  readonly slot: (k: number) => [number, number];
  readonly cell: (line: SignLine) => readonly [number, number, number, number];
  readonly swatch: Readonly<Record<'green' | 'grey' | 'white', readonly [number, number]>>;
}
function signAtlasLayout(signs: readonly RoadSign[]): SignAtlasLayout {
  const { keys, lines, width: W, height: H, slot } = roadSignPaintLayout(signs);
  const [sx, sy] = slot(keys.length); // swatches in the last cell
  const uv = (px: number, py: number): readonly [number, number] => [px / W, 1 - py / H];
  const index = new Map(keys.map((k, i) => [k, i]));
  return {
    keys, lines, width: W, height: H, slot,
    cell: (line) => { const [x, y] = slot(index.get(lineKey(line)) ?? 0); return [x / W, 1 - (y + LINE_H) / H, (x + LINE_W) / W, 1 - y / H]; },
    swatch: { green: uv(sx + 32, sy + LINE_H / 2), grey: [0.5, GREY_V], white: uv(sx + 160, sy + LINE_H / 2) },
  };
}
function signAtlasTexture(atlas: SignAtlasLayout, signs?: RoadSignSource): DataTexture {
  const { width: W, height: H } = atlas;
  let data: Uint8Array | undefined = signs?.(atlas);
  if (data === undefined) {
    const { el, g } = canvas(W, H); paintRoadSignCanvas(g, atlas);
    const pixels = g.getImageData(0, 0, W, H).data; el.width = 1; el.height = 1;
    const colours = signCoverage(); data = packRoadSignPixels(pixels, W, H, coverageTable(colours, 0), coverageTable(colours, 1));
  }
  const t = new DataTexture(data, W, H, RGFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace; t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
/** Every sign: two posts, a white-rimmed green board, a quad per line on its face. One mesh, one material. */
function signMesher(signs: readonly RoadSign[], home: GridCell, atlas: SignAtlasLayout): Mesher {
  const m = new Mesher(), BOARD_W = 3.6, LINE = 0.42, BOTTOM = 2.3;
  for (const sign of signs) {
    const fx = sign.facing.x, fz = sign.facing.z, rx = fz, rz = -fx; // the board's right as its reader sees it (they look along −facing)
    const ox = sign.at.x - home.origin.x, oz = sign.at.z - home.origin.z, h = sign.lines.length * LINE + 0.3, top = BOTTOM + h;
    for (const side of [-1, 1]) {
      const px = ox + rx * side * (BOARD_W / 2 - 0.4), pz = oz + rz * side * (BOARD_W / 2 - 0.4);
      m.beam({ x: px - fx * 0.05, z: pz - fz * 0.05 }, { x: px + fx * 0.05, z: pz + fz * 0.05 }, 0, 0.1, top, new Color(1, 1, 1), atlas.swatch.grey);
    }
    const panel = (w: number, y0: number, y1: number, ahead: number, uvRect: readonly [number, number, number, number] | readonly [number, number], back = false): void => {
      const n = back ? -1 : 1, cx = ox + fx * ahead * n, cz = oz + fz * ahead * n, hw = w / 2 * n;
      const [u0, v0, u1, v1] = uvRect.length === 4 ? uvRect : [uvRect[0], uvRect[1], uvRect[0], uvRect[1]];
      const a = m.vertex(cx - rx * hw, y0, cz - rz * hw, fx * n, 0, fz * n, u0, v0), b = m.vertex(cx + rx * hw, y0, cz + rz * hw, fx * n, 0, fz * n, u1, v0);
      const c = m.vertex(cx + rx * hw, y1, cz + rz * hw, fx * n, 0, fz * n, u1, v1), d = m.vertex(cx - rx * hw, y1, cz - rz * hw, fx * n, 0, fz * n, u0, v1);
      m.quad(a, b, c, d);
    };
    panel(BOARD_W + 0.12, BOTTOM - 0.06, top + 0.06, 0.06, atlas.swatch.white);
    panel(BOARD_W, BOTTOM, top, 0.07, atlas.swatch.green);
    panel(BOARD_W + 0.12, BOTTOM - 0.06, top + 0.06, -0.06, atlas.swatch.grey, true);
    sign.lines.forEach((line, k) => { const y1 = top - 0.15 - k * LINE; panel(BOARD_W - 0.2, y1 - LINE, y1, 0.08, atlas.cell(line)); });
  }
  return m;
}

/** Float32 values per textured road vertex (`position`, `normal`, `uv`; `Mesher.geometry()` without colours). */
const ROAD_FLOATS = 8;
/** A mesher's triangles as the cull count reads them (positions exactly as its Float32 geometry will store them). */
function mesherSource(m: Mesher): CullSource { return { vertices: m.p.length / 3, position: (k) => Math.fround(m.p[k] ?? 0), indices: m.i }; }
/** One textured road mesh before it is built: its triangles, its canvas's size and how to paint it. */
interface TexturedSource {
  readonly id: string; readonly name: string; readonly mesher: Mesher; readonly width: number; readonly height: number; readonly paint: () => Generator<void, Texture>;
  readonly overlay: boolean;
  /** GPU bytes per texel (4: an RGBA8 canvas; 2: the sign atlas's RG8 array) and what holds the texels until upload */
  readonly texelBytes: number; readonly source: 'canvas' | 'data';
  readonly material: (map: Texture) => MeshLambertMaterial;
}
// the map is the emissive map too, black until RoadOverlayLight lights it inside a cell (one program either way)
const overlayMaterial = (map: Texture): MeshLambertMaterial => new MeshLambertMaterial({ map, emissiveMap: map, emissive: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
/** A texture painted in one stretch, as a paint step. */
function* paintNow(paint: () => Texture): Generator<void, Texture> { yield; return paint(); }
function texturedSources(layout: RoadLayout, home: GridCell, grain?: RoadGrainSource, signs?: RoadSignSource): TexturedSource[] {
  const atlas = signAtlasLayout(layout.signs);
  return [
    { id: 'road.asphalt', name: 'grid-asphalt', mesher: asphalt(layout, home), width: 1024, height: 512, paint: () => roadTextureSteps(grain), overlay: true, texelBytes: 4, source: 'canvas', material: overlayMaterial },
    { id: 'road.junctions', name: 'grid-junctions', mesher: junctionAsphalt(layout, home), width: 1024, height: 1024, paint: () => junctionTextureSteps(grain), overlay: true, texelBytes: 4, source: 'canvas', material: overlayMaterial },
    { id: 'road.signs', name: 'grid-signs', mesher: signMesher(layout.signs, home, atlas), width: atlas.width, height: atlas.height, paint: () => paintNow(() => signAtlasTexture(atlas, signs)), overlay: false, texelBytes: 2, source: 'data', material: (map) => coverageMaterial(map, signCoverage(), 'g227-grid-sign-cover') },
  ];
}



/** The same admitted road builders, with paint opportunities during their counts and clipped indices. */
export function* installRoadLookSteps(input: RoadLookInput): Generator<void, RoadLookState> {
  const { layout, home, scene, scope, admission } = input, group = new Group(), hook = typeof input.cull === 'function' ? input.cull : undefined, cull = typeof input.cull === 'function' ? undefined : input.cull;
  if (admission !== undefined && hook !== undefined) throw new Error('Road admission needs a RoadCuller (its pitch plans the culled bytes)');
  group.name = 'grid-boulevard';
  const sources = texturedSources(layout, home, input.grain, input.signs);
  const { poles, heads } = streetlights(layout, home);
  for (const part of [kerbs(layout, home), poles, heads]) input.solid(part);
  scene.add(group);
  scope.onDispose(() => { group.removeFromParent(); });
  for (const source of sources) {
    const build = function* build(owner: LookScope): Generator<void, Mesh> {
      yield;
      const map = yield* source.paint(), material = source.material(map);
      const mesh = new Mesh(source.mesher.geometry(), material);
      ownRoadMesh(owner, mesh, [map]);
      mesh.name = source.name; if (source.overlay) { mesh.receiveShadow = true; input.overlayLight?.add(material, owner); }
      mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (cull !== undefined) yield* cullIntoSteps(cull, mesh); else hook?.(mesh);
      group.add(mesh);
      if (admission !== undefined) gpuOnlyRoad(mesh, [map]); // G144: admitted, its vertex arrays and canvas go on upload (nothing repaints it)
      return mesh;
    };
    if (admission === undefined) yield* build(scope);
    else {
      const bytes = yield* meshBytesSteps([mesherSource(source.mesher)], ROAD_FLOATS, cull === undefined ? undefined : { pitch: cull.pitch, ...(cull.tileSize === undefined ? {} : { tileSize: cull.tileSize }) }, true);
      const textures = gpuOnlyTextureBytes(source.width, source.height, 1, source.source, source.texelBytes);
      const plan = bytePlan(source.id, bytes, textures);
      const mesh = yield* allocateRenderSteps(admission, plan, build);
      if (mesh === undefined) throw new Error('Road construction cancelled');
      input.retireGeometry?.(mesh, plan.id, textures.jsBytes + textures.gpuBytes);
    }
  }
  return { segments: layout.segments.length, junctions: layout.junctions.length, roundabouts: layout.junctions.filter((j) => j.roundabout).length, signs: layout.signs.length, lights: layout.lights.length, draws: sources.length };
}
