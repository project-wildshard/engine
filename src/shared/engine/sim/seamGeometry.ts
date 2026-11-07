import { CHUNK_SIZE, CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { edgeSample, edgeSampleLocations } from './edgeProfiles';
import { seamLatticeSteps, type SeamLatticePlans } from './seamLattice';
import { SHORE_DEPTH, SHORE_REVETMENT_INNER_FACE } from './shore';
import type { StripCorner, StripMesh, StripProfile } from './strips';

/** Collision and rendering share these ordered triangle ranges; materials never reconstruct seam geometry. */
export type SeamFeatureKind = 'deck' | 'neutral-buffer' | 'gradient' | 'overlap' | 'retaining-wall' | 'cliff' | 'talus' | 'parapet' | 'dike' | 'culvert' | 'guard-rail' | 'road-wall' | 'turn-in' | 'revetment';
/** Index offsets refer directly to the returned mesh, including every physical wall and rail face. */
export interface SeamFeature { readonly kind: SeamFeatureKind; readonly firstIndex: number; readonly indexCount: number; readonly side: -1 | 0 | 1; readonly from: number; readonly to: number; readonly bottom: number; readonly top: number; readonly sourceSurface?: string }
/** Admitted edge observations, with an explicit absence of blendable ground instead of an invented terrain height. */
export interface SeamEdge { readonly profile: StripProfile; readonly entryWidth: number; readonly geometry?: 'ground' | 'void'; readonly waterSurface?: number; readonly sourceSurface?: string; readonly outflows?: readonly { readonly from: number; readonly to: number }[] }
/** One midpoint turn-in per road segment; each present side supplies its admitted opening width. */
export interface SeamTurnIn { readonly at: 0; readonly widths: readonly [number, number] }
/** The exact physical mesh and its surface descriptions, without renderer or Rapier objects. */
export interface SeamGeometry { readonly mesh: StripMesh; readonly features: readonly SeamFeature[]; readonly turnIn: SeamTurnIn }
const gapHalf = (CONTENT_CAPS.pitch - CHUNK_SIZE) / 2;
const vergeWidth = gapHalf - 7.5;
const gradientWidth = gapHalf - 11.5;
const vergeOffsets = [...Array.from({ length: Math.ceil(vergeWidth / 2) }, (_, i) => 7.5 + i * 2), gapHalf];
/** Every gradient has a vertex at most 2 m apart; road edges and the 6/10 m re-frame lines remain explicit vertices. */
export const SEAM_OFFSETS: readonly number[] = Object.freeze([...vergeOffsets.map(u => -u).reverse(), ...vergeOffsets]);
const neutral = [0.25, 0.25, 0.25] as const;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const bounded = (h: number): number => Math.max(-1.5, Math.min(6, h));
/** G134 / G149: an edge whose observed sea is at exactly 0 (and has ground) is a shore: its seabed gets the shore rule. */
const shoreEdge = (edge: SeamEdge): boolean => edge.waterSurface === 0 && edge.geometry !== 'void';
/** An edge sample's floor height B: G90's clamp, held at 0 or above on a shore (B = max(0, clamp(H, −1.5, 6))). */
const edgeFloor = (edge: SeamEdge, h: number): number => (shoreEdge(edge) ? Math.max(0, bounded(h)) : bounded(h));
/** The revetment's section (G149), metres from the cell edge (positive into the cell) and up from the road: the landward
 *  toe, the crest (+0.6 m: the +0.4 m swell plus freeboard) across the cell edge to the inner face, then a 1 : 1.4 rip-rap
 *  slope down to 0.4 m below the seabed. Runs that reach a cell corner carry on past it so the two edges' crests meet. */
const REVETMENT = { toe: -1.8, crest: 0.6, crestIn: -0.8, slope: 1.4, bury: 0.4, station: 3.9, corner: 1.8 } as const;
/** A deterministic 0..1 value per station and channel (integer hash: the same bytes on every engine, unlike Math.sin). */
function rubble(at: number, side: number, channel: number): number {
  let h = Math.imul(Math.round(at * 1000) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(side + 3, 0xc2b2ae35) ^ Math.imul(channel + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** A corner's floor height: B, held at 0 or above for a shore corner (the §3.2 shore rule: B = max(0, clamp(H, −1.5, 6))). */
const cornerFloor = (corner: StripCorner): number => (corner.shore === true ? Math.max(0, bounded(corner.height)) : bounded(corner.height));
const blend = (u: number): number => smooth(Math.max(0, Math.min(1, (Math.abs(u) - 11.5) / gradientWidth)));
const tan85 = Math.tan(85 * Math.PI / 180);
/**
 * G222 (agent playtest round 1): the tallest face the seam builds, G90's own band (retaining walls run 6–14 m). A cliff or
 * a short-run retaining face never climbs past it to the neighbour's raw edge height (Nalati's edges reach 100 m, Pine's
 * 62 m), so no 60–100 m wall towers over the road; above it the shard's own edge (its terrain, its far proxy's skirt)
 * is the silhouette. The boundary row and its overlap apron keep the exact native heights.
 */
export const SEAM_FACE_TOP = 14;
const faceTop = (h: number): number => Math.min(h, SEAM_FACE_TOP);
// G101: single jump + autostep stays below this obstacle; double jump clears it.
const roadWallTop = 1.85, guardRailTop = 2;
type Point = readonly [number, number, number];

class MeshWriter {
  readonly positions: number[] = [];
  readonly colours: number[] = [];
  readonly indices: number[] = [];
  readonly features: SeamFeature[] = [];
  readonly axis: 'x' | 'z';
  constructor(axis: 'x' | 'z') { this.axis = axis; }
  vertex(u: number, y: number, v: number, colour: readonly number[] = neutral): number {
    const index = this.positions.length / 3;
    if (this.axis === 'x') this.positions.push(u, y, v); else this.positions.push(v, y, u);
    this.colours.push(...colour); return index;
  }
  quad(points: readonly [Point, Point, Point, Point], feature: Omit<SeamFeature, 'firstIndex' | 'indexCount'>, recordFeature = true): void {
    const firstIndex = this.indices.length;
    const a = this.vertex(...points[0]), b = this.vertex(...points[1]), c = this.vertex(...points[2]), d = this.vertex(...points[3]);
    if (this.axis === 'x') this.indices.push(a, b, c, b, d, c); else this.indices.push(a, c, b, b, c, d);
    if (recordFeature) this.features.push({ ...feature, firstIndex, indexCount: 6 });
  }
  box(u: number, v0: number, v1: number, bottom: number, top: number, thickness: number, feature: Omit<SeamFeature, 'firstIndex' | 'indexCount'>): void {
    const firstIndex = this.indices.length, left = u - thickness / 2, right = u + thickness / 2;
    const a: Point = [left, bottom, v0], b: Point = [right, bottom, v0], c: Point = [left, top, v0], d: Point = [right, top, v0];
    const e: Point = [left, bottom, v1], f: Point = [right, bottom, v1], g: Point = [left, top, v1], h: Point = [right, top, v1];
    for (const points of [[a, b, c, d], [e, g, f, h], [a, c, e, g], [b, f, d, h], [c, d, g, h], [a, e, b, f]] as const) this.quad(points, feature, false);
    this.features.push({ ...feature, firstIndex, indexCount: this.indices.length - firstIndex });
  }
  mesh(origin: { readonly x: number; readonly z: number }): StripMesh { return { origin: { ...origin }, positions: new Float32Array(this.positions), colours: new Float32Array(this.colours), indices: new Uint32Array(this.indices) }; }
}

function validateEdge(edge: SeamEdge): void {
  if (!Number.isFinite(edge.entryWidth) || edge.entryWidth < 0 || edge.entryWidth > 15
    || (edge.waterSurface !== undefined && (!Number.isFinite(edge.waterSurface) || Math.abs(edge.waterSurface) > 250))
    || edge.outflows?.some((row) => !Number.isFinite(row.from) || !Number.isFinite(row.to) || row.from < -250 || row.to > 250 || row.from >= row.to)) throw new RangeError('Invalid seam edge observations');
  if (edge.entryWidth > 0) {
    const locations = [...edgeSampleLocations([edge.profile]).filter((at) => Math.abs(at) <= edge.entryWidth / 2), -edge.entryWidth / 2, 0, edge.entryWidth / 2];
    if (locations.some((at) => Math.abs(edgeSample(edge.profile, at).height) > 0.02)) throw new RangeError('Midpoint entry boundary must meet road height zero');
  }
}
/** The 85° cliff (its top capped at `SEAM_FACE_TOP`) and its 4 m talus fit inside the verge beyond its 4 m neutral buffer, whatever the edge's height. */
function cliffFoot(edgeHeight: number, cornerWeight = 1): { u: number; bottom: number } {
  const height = faceTop(edgeHeight), base = (w: number): number => bounded(edgeHeight) * smooth((w - 4) / gradientWidth) * cornerWeight + 1.5;
  let low = 8, high = vergeWidth;
  for (let i = 0; i < 48; i++) { const mid = (low + high) / 2; if (height - base(mid) > (vergeWidth - mid) * tan85) high = mid; else low = mid; }
  const w = (low + high) / 2; return { u: 7.5 + w, bottom: base(w) };
}

/** Build the G90 corridor, preserving all native sample locations and using the same triangles for every world and the renderer. */
export function seamGeometry(input: { readonly id: string; readonly axis: 'x' | 'z'; readonly origin: { readonly x: number; readonly z: number }; readonly edges: readonly [SeamEdge, SeamEdge] }): SeamGeometry {
  const steps = seamGeometrySteps(input);
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
}

/** Ordered seam construction with paint opportunities inside its native lattice certification. */
export function* seamGeometrySteps(input: { readonly id: string; readonly axis: 'x' | 'z'; readonly origin: { readonly x: number; readonly z: number }; readonly edges: readonly [SeamEdge, SeamEdge] }, plans?: SeamLatticePlans): Generator<void, SeamGeometry> {
  input.edges.forEach(validateEdge);
  const native = edgeSampleLocations(input.edges.map((edge) => edge.profile));
  const along = [...new Set([...native, 0, ...input.edges.flatMap((edge) => [-edge.entryWidth / 2, edge.entryWidth / 2]), ...input.edges.flatMap((edge) => edge.outflows?.flatMap((row) => [row.from, row.to]) ?? [])])].sort((a, b) => a - b);
  const writer = new MeshWriter(input.axis), count = SEAM_OFFSETS.length;
  const floorGroups = new Map<string, { kind: SeamFeatureKind; side: -1 | 0 | 1; indices: number[] }>();
  const columnsInput = SEAM_OFFSETS.map(u => ({ u, weight: blend(u), left: u < 0 }));
  const colour = [0, 0, 0];
  for (const v of along) {
    const left = edgeSample(input.edges[0].profile, v), right = edgeSample(input.edges[1].profile, v);
    const leftFloor = edgeFloor(input.edges[0], left.height), rightFloor = edgeFloor(input.edges[1], right.height);
    for (const column of columnsInput) {
      const sample = column.left ? left : right, weight = column.weight;
      for (let channel = 0; channel < neutral.length; channel++) {
        const c = neutral[channel] ?? 0;
        colour[channel] = c + ((sample.colour[channel] ?? c) - c) * weight;
      }
      writer.vertex(column.u, weight === 0 ? 0 : (column.left ? leftFloor : rightFloor) * weight, v, colour);
    }
  }
  const retained = yield* seamLatticeSteps({ positions: writer.positions, colours: writer.colours, columns: count, along }, plans);
  const columns = Array.from({ length: count }, (_, col) => col);
  for (let band = 1; band < columns.length; band++) {
    const col = columns[band], previous = columns[band - 1];
    if (col === undefined || previous === undefined) throw new Error('Missing seam band');
    const u0 = SEAM_OFFSETS[previous] ?? 0, u1 = SEAM_OFFSETS[col] ?? 0;
    const side = u1 <= -7.5 ? -1 : u0 >= 7.5 ? 1 : 0;
    const kind = side === 0 ? 'deck' : Math.max(Math.abs(u0), Math.abs(u1)) <= 11.5 ? 'neutral-buffer' : 'gradient';
    const key = `${kind}/${side}`, group = floorGroups.get(key) ?? { kind, side, indices: [] };
    const left = retained[previous], right = retained[col];
    if (left === undefined || right === undefined) throw new Error('Missing seam column');
    let l = 0, r = 0;
    const triangle = (a: number, b: number, c: number): void => {
      if (input.axis === 'x') group.indices.push(a, b, c);
      else group.indices.push(a, c, b);
    };
    while (l < left.length - 1 || r < right.length - 1) {
      const a = (left[l] ?? 0) * count + previous, b = (right[r] ?? 0) * count + col;
      const nextLeft = left[l + 1] ?? Infinity, nextRight = right[r + 1] ?? Infinity;
      if (nextLeft === nextRight) {
        const c = nextLeft * count + previous, d = nextRight * count + col;
        triangle(a, c, d); triangle(a, d, b); l++; r++;
      } else if (nextLeft < nextRight) { triangle(a, nextLeft * count + previous, b); l++; }
      else { triangle(a, nextRight * count + col, b); r++; }
    }
    floorGroups.set(key, group);
  }
  for (const group of floorGroups.values()) {
    const firstIndex = writer.indices.length; writer.indices.push(...group.indices);
    writer.features.push({ kind: group.kind, side: group.side, firstIndex, indexCount: group.indices.length, from: -250, to: 250, bottom: -1.5, top: 6 });
  }
  for (const [edgeIndex, edge] of input.edges.entries()) {
    const side = edgeIndex === 0 ? -1 : 1;
    const runs = new Map<number, number>(); let start = -1;
    for (let row = 0; row < along.length; row++) {
      const at = along[row] ?? 0, high = edgeSample(edge.profile, at).height > 14;
      if (high && start < 0) start = row;
      if ((!high || row === along.length - 1) && start >= 0) {
        const end = high ? row : row - 1, length = (along[end] ?? 0) - (along[start] ?? 0);
        for (let i = start; i < end; i++) runs.set(i, length); start = -1;
      }
    }
    // Keep the full native apron lattice, even when the adjacent bands are flat.
    for (let row = 0; row < along.length - 1; row++) {
      const from = along[row] ?? 0, to = along[row + 1] ?? 0;
      const a = edgeSample(edge.profile, from).height, b = edgeSample(edge.profile, to).height, min = Math.min(a, b), max = Math.max(a, b);
      // The shared native row stays at the cell boundary. A quarter-metre same-mesh apron
      // continues its upper surface under regional terrain so KCC never meets an open seam edge.
      const ia: Point = [side * gapHalf, a, from], ib: Point = [side * gapHalf, b, to], oa: Point = [side * (gapHalf + 0.25), a, from], ob: Point = [side * (gapHalf + 0.25), b, to];
      writer.quad(side < 0 ? [ia, oa, ib, ob] : [ia, ib, oa, ob], { kind: 'overlap', side, from, to, bottom: min, top: max,
        ...(edge.sourceSurface === undefined ? {} : { sourceSurface: edge.sourceSurface }) });
    }
    const guarded = (row: number): boolean => {
      const from = along[row] ?? 0, to = along[row + 1] ?? 0;
      if (Math.abs((from + to) / 2) < edge.entryWidth / 2) return false;
      const a = edgeSample(edge.profile, from).height, b = edgeSample(edge.profile, to).height;
      // a shore's seabed is not a drop: its revetment closes it, and no cyan drop wall crosses a shoreline (G149)
      return Math.max(a, b) > 14 || (Math.min(a, b) < -1.5 && !shoreEdge(edge)) || edge.geometry === 'void';
    };
    // Guard heights do not follow H: one continuous solid replaces the old
    // coplanar boxes even when the protected cliff changes at every native sample.
    for (let row = 0; row < along.length - 1;) {
      if (!guarded(row)) { row++; continue; }
      let end = row + 1;
      while (end < along.length - 1 && guarded(end)) end++;
      const from = along[row] ?? 0, to = along[end] ?? 0;
      const feature = (kind: SeamFeatureKind, bottom: number, top: number): Omit<SeamFeature, 'firstIndex' | 'indexCount'> => ({ kind, side, from, to, bottom, top,
        ...(edge.sourceSurface === undefined ? {} : { sourceSurface: edge.sourceSurface }) });
      writer.box(side * 7.5, from, to, 0, roadWallTop, 0.25, feature('road-wall', 0, roadWallTop));
      writer.box(side * 7.5, from, to, roadWallTop, guardRailTop, 0.15, feature('guard-rail', roadWallTop, guardRailTop));
      row = end;
    }
    const classification = (row: number): string => {
      const middle = ((along[row] ?? 0) + (along[row + 1] ?? 0)) / 2;
      return `${Math.abs(middle) < edge.entryWidth / 2}/${(runs.get(row) ?? 0) >= 30}/${edge.outflows?.some(flow => middle >= flow.from && middle <= flow.to) ?? false}`;
    };
    for (let row = 0; row < along.length - 1;) {
      let end = row + 1;
      const from = along[row] ?? 0, a = edgeSample(edge.profile, from).height;
      // Merge only identical-height physical faces, never across an opening,
      // outflow, changing profile or cliff/retaining-treatment boundary.
      if (edgeSample(edge.profile, along[end] ?? 0).height === a) {
        while (end < along.length - 1 && classification(end) === classification(row)
          && edgeSample(edge.profile, along[end + 1] ?? 0).height === a) end++;
      }
      const to = along[end] ?? 0, middle = (from + to) / 2;
      const b = edgeSample(edge.profile, to).height, min = Math.min(a, b), max = Math.max(a, b);
      const cliff = max > 14 && (runs.get(row) ?? 0) >= 30;
      row = end;
      const feature = (kind: SeamFeatureKind, bottom: number, top: number): Omit<SeamFeature, 'firstIndex' | 'indexCount'> => ({ kind, side, from, to, bottom, top, ...(edge.sourceSurface === undefined ? {} : { sourceSurface: edge.sourceSurface }) });
      if (Math.abs(middle) < edge.entryWidth / 2) continue;
      if (cliff) {
        const fa = cliffFoot(a), fb = cliffFoot(b);
        writer.quad([[side * fa.u, fa.bottom, from], [side * fb.u, fb.bottom, to], [side * gapHalf, faceTop(a), from], [side * gapHalf, faceTop(b), to]], feature('cliff', Math.min(fa.bottom, fb.bottom), faceTop(max)));
        writer.quad([[side * (fa.u - 4), edgeFloor(edge, a) * blend(fa.u - 4), from], [side * (fb.u - 4), edgeFloor(edge, b) * blend(fb.u - 4), to], [side * fa.u, fa.bottom, from], [side * fb.u, fb.bottom, to]], feature('talus', Math.min(fa.bottom, fb.bottom) - 1.5, Math.max(fa.bottom, fb.bottom)));
      } else if (max > 6 || min < -1.5 || (shoreEdge(edge) && min < -SHORE_DEPTH)) {
        // Coordinator G90 gap decision: isolated >14 m runs shorter than30 m retain a face; never widen them over a legal entry.
        // On a shore the face drops from the held floor (0) to the seabed, under the revetment.
        writer.quad([[side * gapHalf, edgeFloor(edge, a), from], [side * gapHalf, edgeFloor(edge, b), to], [side * gapHalf, faceTop(a), from], [side * gapHalf, faceTop(b), to]], feature(max > 6 ? 'retaining-wall' : 'parapet', min, faceTop(max)));
      }
      const outflow = edge.outflows?.some((flow) => middle >= flow.from && middle <= flow.to) ?? false;
      if (edge.waterSurface !== undefined && edge.waterSurface > 0 && !outflow) writer.box(side * (gapHalf - 0.1), from, to, Math.min(bounded(a), bounded(b)), Math.max(1.3, edge.waterSurface + 0.5), 0.2, feature('dike', min, Math.max(1.3, edge.waterSurface + 0.5)));
      if (outflow) writer.quad([[side * gapHalf, edgeFloor(edge, a), from], [side * gapHalf, edgeFloor(edge, b), to], [side * 7.5, -1.5, from], [side * 7.5, -1.5, to]], feature('culvert', -1.5, 0));
    }
    if (shoreEdge(edge)) revetment(writer, edge, side, along);
  }
  return { mesh: writer.mesh(input.origin), features: writer.features, turnIn: { at: 0, widths: [input.edges[0].entryWidth, input.edges[1].entryWidth] } };
}

/**
 * G149's rip-rap revetment along one shore edge: wherever its boundary row is seabed (below −SHORE_DEPTH) outside the
 * midpoint entry and any outflow, a low stone mound straddles the cell edge (`REVETMENT`), its crest covering
 * `SHORE_REVETMENT_INNER_FACE` so the shard's clipped sea ends under it. A station every ~4 m with a small deterministic
 * rubble jitter; the same triangles collide (they are the strip's mesh) and draw in the retaining walls' stone.
 */
function revetment(writer: MeshWriter, edge: SeamEdge, side: -1 | 1, along: readonly number[]): void {
  const seabed = (row: number): boolean => {
    const from = along[row] ?? 0, to = along[row + 1] ?? 0, middle = (from + to) / 2;
    if (Math.abs(middle) < edge.entryWidth / 2 || (edge.outflows?.some((flow) => middle >= flow.from && middle <= flow.to) ?? false)) return false;
    return Math.min(edgeSample(edge.profile, from).height, edgeSample(edge.profile, to).height) < -SHORE_DEPTH;
  };
  const first = along[0] ?? -250, last = along[along.length - 1] ?? 250;
  for (let row = 0; row < along.length - 1;) {
    if (!seabed(row)) { row++; continue; }
    let end = row + 1;
    while (end < along.length - 1 && seabed(end)) end++;
    const stations: number[] = [along[row] ?? 0];
    for (let k = row + 1; k < end; k++) { const at = along[k] ?? 0; if (at - (stations[stations.length - 1] ?? at) >= REVETMENT.station && (along[end] ?? 0) - at >= REVETMENT.station / 2) stations.push(at); }
    stations.push(along[end] ?? 0);
    if (row === 0) stations.unshift(first - REVETMENT.corner);
    if (end === along.length - 1) stations.push(last + REVETMENT.corner);
    row = end;
    const firstIndex = writer.indices.length, u = (d: number): number => side * (gapHalf + d);
    let bottom = Infinity, top = -Infinity;
    // the section at each station: landward toe, landward crest, inner crest, seabed toe (its rubble jitter never lowers
    // the crest below +0.54 m or pulls the inner crest edge nearer the cell edge than the inner face)
    const sections = stations.map((at): readonly (readonly [number, number])[] => {
      const h = edgeSample(edge.profile, Math.max(first, Math.min(last, at))).height, toe = Math.min(0, h) - REVETMENT.bury;
      const landY = REVETMENT.crest - 0.04 + rubble(at, side, 0) * 0.12, seaY = REVETMENT.crest - 0.04 + rubble(at, side, 1) * 0.12;
      const seaD = SHORE_REVETMENT_INNER_FACE + rubble(at, side, 2) * 0.25;
      bottom = Math.min(bottom, toe); top = Math.max(top, landY, seaY);
      return [[REVETMENT.toe, -0.05], [REVETMENT.crestIn - rubble(at, side, 3) * 0.15, landY], [seaD, seaY], [seaD + REVETMENT.slope * (seaY - toe), toe]];
    });
    const vertex = (at: number, [d, y]: readonly [number, number]): number => writer.vertex(u(d), y, at);
    const world = (n: number): readonly [number, number, number] => [writer.positions[n * 3] ?? 0, writer.positions[n * 3 + 1] ?? 0, writer.positions[n * 3 + 2] ?? 0];
    const along3 = (x: number): readonly [number, number, number] => (writer.axis === 'x' ? [0, 0, x] : [x, 0, 0]);
    const across3 = (x: number): readonly [number, number, number] => (writer.axis === 'x' ? [x, 0, 0] : [0, 0, x]);
    // wind each triangle so its normal faces `out` (world frame), whatever the strip's axis mirroring does
    const triangle = (a: number, b: number, c: number, out: readonly [number, number, number]): void => {
      const pa = world(a), pb = world(b), pc = world(c), e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [(e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0), (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0), (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0)];
      writer.indices.push(...((n[0] ?? 0) * out[0] + (n[1] ?? 0) * out[1] + (n[2] ?? 0) * out[2] >= 0 ? [a, b, c] : [a, c, b]));
    };
    const rows = stations.map((at, k) => (sections[k] ?? []).map((point) => vertex(at, point)));
    const faceOut = [[-side * 0.5, 1], [0, 1], [side, 0.6]] as const;
    for (let k = 1; k < rows.length; k++) for (let f = 0; f < 3; f++) {
      const p = rows[k - 1], q = rows[k], o = faceOut[f];
      if (p === undefined || q === undefined || o === undefined) throw new Error('Missing revetment station');
      const a = p[f] ?? 0, b = p[f + 1] ?? 0, c = q[f] ?? 0, d = q[f + 1] ?? 0, out = [across3(o[0])[0], o[1], across3(o[0])[2]] as const;
      triangle(a, b, d, out); triangle(a, d, c, out);
    }
    // the run's two ends, each its own vertices (a flat cap, not smoothed into the slopes)
    for (const [k, direction] of [[0, -1], [stations.length - 1, 1]] as const) {
      const at = stations[k] ?? 0, section = sections[k] ?? [], cap = section.map((point) => vertex(at, point)), out = along3(direction);
      const [c0 = 0, c1 = 0, c2 = 0, c3 = 0] = cap;
      triangle(c0, c1, c2, out); triangle(c0, c2, c3, out);
    }
    writer.features.push({ kind: 'revetment', side, from: stations[0] ?? 0, to: stations[stations.length - 1] ?? 0, bottom, top, firstIndex, indexCount: writer.indices.length - firstIndex,
      ...(edge.sourceSurface === undefined ? {} : { sourceSurface: edge.sourceSurface }) });
  }
}

/** Four B-clamped corner fields join the corridors; physical faces turn10m around each corner, outside both road lanes. */
export function cornerSeamGeometry(input: { readonly id: string; readonly origin: { readonly x: number; readonly z: number }; readonly corners: readonly [StripCorner, StripCorner, StripCorner, StripCorner] }): { readonly mesh: StripMesh; readonly features: readonly SeamFeature[] } {
  const steps = cornerSeamGeometrySteps(input);
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
}

/** Ordered seam construction with paint opportunities inside its native lattice certification. */
export function* cornerSeamGeometrySteps(input: { readonly id: string; readonly origin: { readonly x: number; readonly z: number }; readonly corners: readonly [StripCorner, StripCorner, StripCorner, StripCorner] }, plans?: SeamLatticePlans): Generator<void, { readonly mesh: StripMesh; readonly features: readonly SeamFeature[] }> {
  if (input.corners.some((c) => !Number.isFinite(c.height) || Math.abs(c.height) > 250 || c.colour.some((n) => !Number.isFinite(n) || n < 0 || n > 1))) throw new RangeError('Invalid seam corner');
  const writer = new MeshWriter('x'), count = SEAM_OFFSETS.length;
  for (const z of SEAM_OFFSETS) for (const x of SEAM_OFFSETS) {
    const corner = input.corners[(z < 0 ? 0 : 2) + (x < 0 ? 0 : 1)];
    if (corner === undefined) throw new Error('Missing seam corner');
    const weight = blend(x) * blend(z);
    writer.vertex(x, weight === 0 ? 0 : cornerFloor(corner) * weight, z, neutral.map((c, i) => c + ((corner.colour[i] ?? c) - c) * weight));
  }
  const retained = yield* seamLatticeSteps({ positions: writer.positions, colours: writer.colours, columns: count, along: SEAM_OFFSETS, corner: true }, plans);
  for (let col = 1; col < count; col++) {
    const left = retained[col - 1], right = retained[col];
    if (left === undefined || right === undefined) throw new Error('Missing corner column');
    let l = 0, r = 0;
    while (l < left.length - 1 || r < right.length - 1) {
      const a = (left[l] ?? 0) * count + col - 1, b = (right[r] ?? 0) * count + col;
      const nextLeft = left[l + 1] ?? Infinity, nextRight = right[r + 1] ?? Infinity;
      if (nextLeft === nextRight) {
        const c = nextLeft * count + col - 1, d = nextRight * count + col;
        writer.indices.push(a, c, b, b, c, d); l++; r++;
      } else if (nextLeft < nextRight) { writer.indices.push(a, nextLeft * count + col - 1, b); l++; }
      else { writer.indices.push(a, nextRight * count + col, b); r++; }
    }
  }
  writer.features.push({ kind: 'gradient', firstIndex: 0, indexCount: writer.indices.length, side: 0, from: -gapHalf, to: gapHalf, bottom: -1.5, top: 6 });
  for (const [index, corner] of input.corners.entries()) {
    const sx = index % 2 === 0 ? -1 : 1, sz = index < 2 ? -1 : 1;
    for (const axis of ['x', 'z'] as const) {
      const across = axis === 'x' ? sx : sz, along = axis === 'x' ? sz : sx;
      const start = writer.positions.length / 3, before = writer.features.length;
      const from = along * gapHalf, to = along * (gapHalf - 10);
      const feature = (kind: SeamFeatureKind, bottom: number, top: number): Omit<SeamFeature, 'firstIndex' | 'indexCount'> => ({ kind, side: across, from: Math.min(from, to), to: Math.max(from, to), bottom, top });
      // G149: a shore corner's field stays at 0 (cornerFloor) and needs neither the drop face nor the road wall: the
      // strips' revetments close the shoreline and no cyan drop wall crosses it
      const h = corner.height, a = cornerFloor(corner), b = a * blend(to), shore = corner.shore === true;
      if (h > 14) {
        const fa = cliffFoot(h), fb = cliffFoot(h, blend(to)), top = faceTop(h);
        writer.quad([[across * fa.u, fa.bottom, from], [across * fb.u, fb.bottom, to], [across * gapHalf, top, from], [across * gapHalf, top, to]], feature('cliff', Math.min(fa.bottom, fb.bottom), top));
        writer.quad([[across * (fa.u - 4), bounded(h) * blend(fa.u - 4), from], [across * (fb.u - 4), bounded(h) * blend(fb.u - 4) * blend(to), to], [across * fa.u, fa.bottom, from], [across * fb.u, fb.bottom, to]], feature('talus', Math.min(a, b), Math.max(fa.bottom, fb.bottom)));
      } else if (h > 6 || (h < -1.5 && !shore)) writer.quad([[across * gapHalf, a, from], [across * gapHalf, b, to], [across * gapHalf, h, from], [across * gapHalf, h, to]], feature(h > 6 ? 'retaining-wall' : 'parapet', Math.min(h, a, b), Math.max(h, a, b)));
      if (h > 14 || (h < -1.5 && !shore)) {
        writer.box(across * 7.5, Math.min(from, to), Math.max(from, to), 0, roadWallTop, 0.25, feature('road-wall', 0, roadWallTop));
        writer.box(across * 7.5, Math.min(from, to), Math.max(from, to), roadWallTop, guardRailTop, 0.15, feature('guard-rail', roadWallTop, guardRailTop));
      }
      if (axis === 'z') {
        for (let vertex = start; vertex < writer.positions.length / 3; vertex++) {
          const x = writer.positions[vertex * 3] ?? 0; writer.positions[vertex * 3] = writer.positions[vertex * 3 + 2] ?? 0; writer.positions[vertex * 3 + 2] = x;
        }
        for (let f = before; f < writer.features.length; f++) {
          const range = writer.features[f]; if (range === undefined) continue;
          for (let i = range.firstIndex; i < range.firstIndex + range.indexCount; i += 3) {
            const aIndex = writer.indices[i]; writer.indices[i] = writer.indices[i + 1] ?? 0; writer.indices[i + 1] = aIndex ?? 0;
          }
        }
      }
    }
  }
  return { mesh: writer.mesh(input.origin), features: writer.features };
}
