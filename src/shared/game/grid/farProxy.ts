/**
 * The far view (SHARD-PLATFORM SF23): one baked low-poly proxy per shard, drawn in the render rings' bounded far ring
 * (`RenderRings`, at most `CONTENT_CAPS.farCount` proxies, charged through the one `ResidencyAllocator` as category `far`).
 * The drawn 7 × 7 grid's longest sightline is ≈ 5.6 km (`GRID_SIGHTLINE`, from `DRAWN_GRID_RADIUS`, SA34); every cell keeps
 * its proxy across it (SF88c).
 *
 * A proxy is the shard's baked terrain (its `terrain.bin` heights and splat) resampled onto 4 × 4 regions, one per L1
 * footprint (125 m), each a 12 × 12 quad lattice with skirts on all four sides, plus a water sheet where the ground dips
 * under the shard's water level. Every vertex carries its region (0..15, x + 4z from the cell's −x −z corner, the rings'
 * mask numbering), so the renderer hides a refined region in the same single draw (`farView.ts`). Colour comes from the
 * shard's own far look (`src/shards/<slug>/look/far.ts`): its palette by height, slope and splat, an optional canopy
 * lift (a forest reads as a dark mass above the ground, not painted on it) and its haze. The cell's outer skirt is its
 * exposed boundary seen from the road (G222): a rocky cliff in the look's declared `cliff` palette, its own vertices with
 * outward (faceted) normals and flagged in TEXCOORD_0.y (1 lip, 2 foot), so the renderer draws strata on it; the short inner skirts that
 * hide the cracks between regions keep the ground's colour. Node-safe; no three.js.
 */
import { Color } from 'three';
import { CHUNK_HALF, CONTENT_CAPS } from '@wildshard/engine/core/config';
import { DRAWN_GRID_RADIUS } from './catalogue';

/** Linear RGB, 0..1. */
export type FarRgb = readonly [number, number, number];
/** The material family a proxy draws with; each shard keeps its own style. */
export type FarFamily = 'toon' | 'painterly' | 'pbr';
/** A shard's declared air: the colour the one frame's fog takes while the shard owns it. */
export interface FarHaze { readonly colour: FarRgb }
/**
 * G631 (Jake, on G607's render-everything): one mild distance haze over the whole grid. Every far proxy, near view and
 * impostor fades toward the frame's air from `near` to `far` metres of view depth, at most `max`; tuned on the shipped
 * 10-13 hero (public/assets/title/main-crossroads-square.jpg), every cell still drawn to the 6 km far plane. `colour` is
 * the air in sRGB (mixed after the output conversion), one uniform every far material shares, written by the grid frame.
 */
export const GRID_HAZE: { readonly near: 600; readonly far: 4500; readonly max: 0.35; readonly colour: { readonly value: Color; }; } = { near: 600, far: 4500, max: 0.35, colour: { value: new Color(1, 1, 1) } } as const;
/**
 * A shard's far look, authored in its folder and read only at bake time. `colourAt` gets cell-local metres, the height,
 * the slope (1 − n.y) and the normalised splat weights (the shard's own four channels).
 */
export interface FarLookSource {
  readonly family: FarFamily;
  readonly colourAt: (x: number, z: number, h: number, slope: number, splat: readonly [number, number, number, number]) => FarRgb;
  /** metres of canopy above the ground (forests), 0 for open ground */
  readonly canopyAt?: (x: number, z: number, h: number, slope: number, splat: readonly [number, number, number, number]) => number;
  readonly water?: { readonly level: number; readonly colour: FarRgb };
  /** the rock its exposed cell boundary shows (G222), from its own terrain's rock, never its snow or grass */
  readonly cliff: FarCliff;
  readonly haze: FarHaze;
  /**
   * quads per region side in its terrain lattice (default `FAR_QUADS`): a shard whose ground is one sheet (a cloud sea
   * over a void, its land all models) spends 1 and gives its triangles to its parts instead (SF49)
   */
  readonly quads?: number;
  /** its grade under the one frame while it owns the frame (SF19a / SF19b, G158) */
  readonly grade?: FarGrade;
  /** a haze band at its border under the one frame (SF19b, G94) */
  readonly band?: FarBand;
}
/**
 * G222: the rock palette of a shard's exposed boundary face (linear RGB): `lip` at the true edge height, easing to `foot`
 * at the edge floor. The far material lays strata over it (`farView.ts`, `FAR_STRATA`), so the face reads as the same
 * banded rock family as the seam's cliffs in front of it instead of a smooth wall of the lip's ground colour.
 */
export interface FarCliff { readonly lip: FarRgb; readonly foot: FarRgb }
/**
 * A shard's declared grade under SF19a's one frame, applied to the whole frame while the player stands in its cell (G158;
 * after the camera's tone mapping; neutral when absent):
 * exposure in stops, saturation and contrast as factors, an optional linear RGB tint.
 */
export interface FarGrade { readonly exposure: number; readonly saturation: number; readonly contrast: number; readonly tint?: FarRgb | undefined }
/**
 * SF19b (G94 / G95): a shard keeps its own mood inside the one frame without a second sky, through a band of its own
 * haze rising at its border (a dusk dust haze, a border fog). `own` (0..1) was how much of its declared haze its proxy
 * kept against the camera's air under the per-pixel frame; G158 retired that (the owner's air hazes every proxy), so the
 * frame no longer reads it.
 */
export interface FarBand { readonly colour: FarRgb; readonly height: number; readonly opacity: number; readonly own: number }
/** What the runtime needs beside the proxy's mesh (stored in `far.json`). */
export interface FarLookRuntime { readonly family: FarFamily; readonly haze: FarHaze; readonly grade?: FarGrade | undefined; readonly band?: FarBand | undefined }
/** A baked grid as `terrain.bin` holds it: res² heights over size metres, 4 splat bytes per vertex. */
export interface FarGrid { readonly res: number; readonly size: number; readonly heights: Float32Array; readonly splat: Uint8Array | null }
/**
 * A baked model merged into the proxy (SF49: a shard whose land is models, not a heightfield: floating islands, a skyline):
 * cell-local metres and linear RGB per vertex, indexed. The whole part rides the region its centre stands over, so the
 * rings hide it with that region; normals come from its faces.
 */
export interface FarPart { readonly positions: Float32Array; readonly colours: Float32Array; readonly index: Uint32Array }
/**
 * An indexed proxy mesh; `region` and `cliff` are per vertex. `cliff` marks the outer boundary face (G222): 1 on its lip,
 * 2 on its foot (the renderer steps the foot in, `FAR_SKIRT_INSET`), 0 elsewhere.
 */
export interface FarProxyMesh { positions: Float32Array; normals: Float32Array; colours: Float32Array; region: Float32Array; cliff: Float32Array; index: Uint32Array; triangles: number }

/** Regions per side (one per L1 tile) and quads per region side. */
export const FAR_REGIONS = 4, FAR_QUADS = 12;
/** Skirt depth (m) under every region edge: hides the cracks against L1 tiles and neighbouring regions. */
export const FAR_SKIRT = 8;
/**
 * The cell's outer edge drops to this height (m) instead: a shard whose border stands high (Pine Hollow's north ridge,
 * Nalati's snow-ring berm) reads as a solid cliff down past road level from a neighbour, never as ground over a void.
 */
export const FAR_EDGE_FLOOR = -20;
/** SF88c (G526): the platform's corner-to-corner sightline across its outer road (`DRAWN_GRID_RADIUS`, the 7 × 7: ≈ 5.6 km). */
export const GRID_SIGHTLINE: number = 2 * (DRAWN_GRID_RADIUS + 0.5) * CONTENT_CAPS.pitch * Math.SQRT2;
/**
 * The far ring (SF23 owns its parameters; SF18b's `RenderRings` owns the scheduler). SF88c: the ring wants a proxy for
 * every cell within `reach` (the grid's whole sightline, so no cell of the 7 × 7 pops in or out while you drive the
 * outer road), nearest first while the proxies' own bytes fit `count` charges of `CONTENT_CAPS.far.resident` (14.4 MB;
 * a baked proxy is ≈ 0.48–0.71 MB, so every cell fits). `viewDistance` (1.5 pitches) is still what the loader waits for.
 * `drawDistance` is the grid camera's far plane (G607, Jake's round-36 D: 6 km, every cell drawn near and unhazed) and
 * `domeRadius` the road sky's camera-kept dome: past the sightline (the far corner's rail) and inside the far plane, so
 * nothing on the platform is clipped or drawn behind the sky.
 */
export const FAR_RING: { readonly count: 9; readonly viewDistance: number; readonly farPrefetch: 435; readonly reach: number; readonly drawDistance: 6000; readonly domeRadius: number; } = { count: CONTENT_CAPS.farCount, viewDistance: 1.5 * CONTENT_CAPS.pitch, farPrefetch: 435, reach: GRID_SIGHTLINE,
  drawDistance: 6000, domeRadius: Math.ceil(GRID_SIGHTLINE / 100) * 100 + 200 } as const;

/**
 * G342 near round 5 (sp-o67's open row 1: the tall grey cliff where Nalati's mountains meet its cell edge): how a near
 * placeholder's ground leans back from the cell border instead of standing there as a 60–120 m boundary face. Over `top`
 * metres (the seam's tallest face, `SEAM_FACE_TOP`, so the seam's own cliff carries the ground up to it) the surface may
 * rise at most `grade` metres per metre in from each border, that grade varied ±`jitter` along the border (two octaves of
 * hashed value noise) so a flank breaks into buttresses and gullies. A height under the cap is untouched, so a low shore or
 * a road-level edge does not change, and nothing 60 m or more inside the border moves. Slope and colour come from the
 * leaned surface, so the flank shades and colours as the shard's own steep ground. Bake-time only.
 */
export interface FarEdgeLean { readonly top: number; readonly grade: number; readonly jitter: number }

/** A deterministic 0..1 value per integer lattice point (integer hash: the same bytes on every engine). */
function leanHash(i: number, side: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(side + 7, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Smooth 1-D value noise, 0..1, two octaves (31 m and 11 m along the border). */
function leanNoise(t: number, side: number): number {
  const octave = (u: number, salt: number): number => { const i = Math.floor(u), f = u - i, k = f * f * (3 - 2 * f), a = leanHash(i, side * 4 + salt), b = leanHash(i + 1, side * 4 + salt); return a + (b - a) * k; };
  return 0.65 * octave(t / 31, 0) + 0.35 * octave(t / 11 + 17.3, 1);
}
/** The leaned surface's cap at (x, z): the lowest of the four borders' rising caps. */
export function edgeLeanCap(lean: FarEdgeLean, x: number, z: number): number {
  const cap = (d: number, along: number, side: number): number => lean.top + Math.max(0, d) * lean.grade * (1 + lean.jitter * (2 * leanNoise(along, side) - 1));
  return Math.min(cap(z + CHUNK_HALF, x, 0), cap(CHUNK_HALF - x, z, 1), cap(CHUNK_HALF - z, x, 2), cap(x + CHUNK_HALF, z, 3));
}

/** How far (m) the lean lowers the ground at (x, z): a prop or tree standing there sinks by it to stay on the flank. */
export function edgeLeanDrop(grid: FarGrid, lean: FarEdgeLean): (x: number, z: number) => number {
  const { height } = sampler(grid);
  return (x, z) => Math.max(0, height(x, z) - edgeLeanCap(lean, x, z));
}

/** Bilinear height / splat over the baked grid, clamped to the cell. */
function sampler(grid: FarGrid): { height: (x: number, z: number) => number; splat: (x: number, z: number) => [number, number, number, number] } {
  const { res, size, heights, splat } = grid, half = size / 2, inv = (res - 1) / size, last = res - 2;
  if (!Number.isInteger(res) || res < 2 || heights.length !== res * res || (splat !== null && splat.length !== res * res * 4)) throw new RangeError('Invalid far grid');
  const at = (x: number, z: number): { i: number; fx: number; fz: number } => {
    const ux = Math.min(res - 1, Math.max(0, (x + half) * inv)), uz = Math.min(res - 1, Math.max(0, (z + half) * inv));
    const ix = Math.min(last, Math.floor(ux)), iz = Math.min(last, Math.floor(uz));
    return { i: iz * res + ix, fx: ux - ix, fz: uz - iz };
  };
  const mix = (a: number, b: number, c: number, d: number, fx: number, fz: number): number => { const top = a + (b - a) * fx; return top + (c + (d - c) * fx - top) * fz; };
  return {
    height: (x, z) => { const { i, fx, fz } = at(x, z); return mix(heights[i] ?? 0, heights[i + 1] ?? 0, heights[i + res] ?? 0, heights[i + res + 1] ?? 0, fx, fz); },
    splat: (x, z) => {
      if (splat === null) return [1, 0, 0, 0];
      const { i, fx, fz } = at(x, z), w: [number, number, number, number] = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) w[c] = mix(splat[i * 4 + c] ?? 0, splat[(i + 1) * 4 + c] ?? 0, splat[(i + res) * 4 + c] ?? 0, splat[(i + res + 1) * 4 + c] ?? 0, fx, fz);
      const sum = w[0] + w[1] + w[2] + w[3]; return sum > 0 ? [w[0] / sum, w[1] / sum, w[2] / sum, w[3] / sum] : [1, 0, 0, 0];
    },
  };
}

/**
 * Bake one shard's proxy mesh from its grid, far look and model parts. Deterministic; refuses output over the far triangle
 * cap (G342's near placeholder passes its own) and a part outside the cell.
 * `reduce` (G342 round 3, the near placeholder's dense ground): each region's ground lattice (region-local positions and
 * index) goes through it before its skirts; it returns a reduced index over the same vertices that keeps the lattice's
 * border vertices (the skirts hang from them). Vertices no triangle uses are dropped at the end.
 * `lean` (G342 round 5, the near placeholder): the ground leans back from the cell border over the seam's face top.
 */
export function buildFarProxy(grid: FarGrid, look: FarLookSource, parts: readonly FarPart[] = [], cap: number = CONTENT_CAPS.far.triangles,
  reduce?: (positions: Float32Array, index: Uint32Array, attributes: Float32Array) => Uint32Array, lean?: FarEdgeLean): FarProxyMesh {
  const quads = look.quads ?? FAR_QUADS;
  if (!Number.isInteger(quads) || quads < 1) throw new RangeError('Invalid far lattice');
  if (lean !== undefined && (!Number.isFinite(lean.top) || !(lean.grade > 0) || !Number.isFinite(lean.grade) || !(lean.jitter >= 0 && lean.jitter < 1))) throw new RangeError('Invalid edge lean');
  const raw = sampler(grid), sample = lean === undefined ? raw : { splat: raw.splat, height: (x: number, z: number): number => Math.min(raw.height(x, z), edgeLeanCap(lean, x, z)) };
  const regionSize = (CHUNK_HALF * 2) / FAR_REGIONS, step = regionSize / quads, n = quads + 1;
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], region: number[] = [], cliff: number[] = [], index: number[] = [];
  const clamp = (c: number): number => Math.min(1, Math.max(0, c));
  // the surface the proxy shows: ground + canopy, its slope from the ground alone (a canopy is not a cliff)
  const ground = (x: number, z: number): { h: number; top: number; slope: number; normal: [number, number, number]; rgb: FarRgb } => {
    const h = sample.height(x, z), hx = sample.height(x + step, z) - sample.height(x - step, z), hz = sample.height(x, z + step) - sample.height(x, z - step);
    const len = Math.hypot(hx, 2 * step, hz), normal: [number, number, number] = [-hx / len, (2 * step) / len, -hz / len], slope = 1 - normal[1], splat = sample.splat(x, z);
    const canopy = Math.max(0, look.canopyAt?.(x, z, h, slope, splat) ?? 0), rgb = look.colourAt(x, z, h, slope, splat);
    if (!Number.isFinite(h) || !Number.isFinite(canopy) || rgb.some((c) => !Number.isFinite(c))) throw new RangeError('Invalid far look sample');
    return { h, top: h + canopy, slope, normal, rgb: [clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2])] };
  };
  const vertex = (x: number, y: number, z: number, normal: readonly number[], rgb: FarRgb, r: number, face = 0): number => {
    positions.push(x, y, z); normals.push(normal[0] ?? 0, normal[1] ?? 1, normal[2] ?? 0); colours.push(...rgb); region.push(r); cliff.push(face);
    return region.length - 1;
  };
  const { lip, foot } = look.cliff;
  if ([...lip, ...foot].some((c) => !Number.isFinite(c) || c < 0 || c > 1)) throw new RangeError('Invalid far cliff palette');
  // G222: the boundary face's rock by height, from the lip (at the true edge, up to the cell's tallest ~105 m) to the foot
  const rock = (y: number, top: number): FarRgb => { const t = top - FAR_EDGE_FLOOR > 0 ? Math.min(1, Math.max(0, (top - y) / (top - FAR_EDGE_FLOOR))) : 1; return [lip[0] + (foot[0] - lip[0]) * t, lip[1] + (foot[1] - lip[1]) * t, lip[2] + (foot[2] - lip[2]) * t]; };
  for (let rz = 0; rz < FAR_REGIONS; rz++) for (let rx = 0; rx < FAR_REGIONS; rx++) {
    const r = rx + rz * FAR_REGIONS, x0 = -CHUNK_HALF + rx * regionSize, z0 = -CHUNK_HALF + rz * regionSize, base = region.length, edge: number[][] = [[], [], [], []];
    let low = Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step, g = ground(x, z), id = vertex(x, g.top, z, g.normal, g.rgb, r); low = Math.min(low, g.h);
      if (j === 0) edge[0]?.push(id); if (i === n - 1) edge[1]?.push(id); if (j === n - 1) edge[2]?.push(id); if (i === 0) edge[3]?.push(id);
    }
    const lattice: number[] = [];
    for (let j = 0; j < quads; j++) for (let i = 0; i < quads; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      lattice.push(a, c, b, b, c, d);
    }
    // the reducer also sees each lattice vertex's colour and normal (6 floats), so painted detail keeps its vertices
    const attributes = (): Float32Array => {
      const out = new Float32Array(n * n * 6);
      for (let v = 0; v < n * n; v++) for (let k = 0; k < 3; k++) { out[v * 6 + k] = colours[(base + v) * 3 + k] ?? 0; out[v * 6 + 3 + k] = normals[(base + v) * 3 + k] ?? 0; }
      return out;
    };
    const kept = reduce === undefined ? lattice : reduce(Float32Array.from(positions.slice(base * 3, (base + n * n) * 3)), Uint32Array.from(lattice), attributes());
    for (const i of kept) { if (!Number.isInteger(i) || i < 0 || i >= n * n) throw new RangeError('Invalid reduced far lattice'); index.push(base + i); }
    // skirts: each edge vertex drops FAR_SKIRT, darkened; wound outward (south edge faces −z, east +x, north +z, west −x).
    // On the cell's border the skirt is the exposed boundary face (G222): it drops to FAR_EDGE_FLOOR as a rock cliff, with
    // its own lip vertices (the outward normal, not the ground's smooth one, and the cliff palette, not the snow or grass
    // of the lip) flagged as cliff for the renderer's strata. Same triangles either way.
    const border = [rz === 0, rx === FAR_REGIONS - 1, rz === FAR_REGIONS - 1, rx === 0];
    const outward = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]] as const;
    edge.forEach((ids, side) => {
      const normal = outward[side] ?? [0, 1, 0], at = (id: number, k: number): number => positions[id * 3 + k] ?? 0;
      let top: number[], bottom: number[];
      if (border[side] === true) {
        top = ids.map((id) => vertex(at(id, 0), at(id, 1), at(id, 2), normal, rock(at(id, 1), at(id, 1)), r, 1));
        bottom = ids.map((id) => { const y = Math.min(at(id, 1) - FAR_SKIRT, FAR_EDGE_FLOOR); return vertex(at(id, 0), y, at(id, 2), normal, rock(y, at(id, 1)), r, 2); });
      } else {
        top = ids;
        bottom = ids.map((id) => vertex(at(id, 0), at(id, 1) - FAR_SKIRT, at(id, 2), normal, [(colours[id * 3] ?? 0) * 0.7, (colours[id * 3 + 1] ?? 0) * 0.7, (colours[id * 3 + 2] ?? 0) * 0.7], r));
      }
      for (let k = 0; k + 1 < ids.length; k++) {
        const a = top[k] ?? 0, b = top[k + 1] ?? 0, c = bottom[k] ?? 0, d = bottom[k + 1] ?? 0;
        // south / east run with +x / +z along the edge, north / west too: flip the winding for the sides facing −
        if (side === 0 || side === 1) index.push(a, b, c, b, d, c); else index.push(a, c, b, b, c, d);
      }
    });
    // water: one sheet over the region where any ground lies under the water level
    if (look.water !== undefined && low < look.water.level) {
      const y = look.water.level, up = [0, 1, 0], rgb = look.water.colour;
      const a = vertex(x0, y, z0, up, rgb, r), b = vertex(x0 + regionSize, y, z0, up, rgb, r), c = vertex(x0, y, z0 + regionSize, up, rgb, r), d = vertex(x0 + regionSize, y, z0 + regionSize, up, rgb, r);
      index.push(a, c, b, b, c, d);
    }
  }
  for (const part of parts) addPart(part, regionSize, { positions, normals, colours, region, cliff, index });
  const triangles = index.length / 3;
  if (triangles > cap) throw new RangeError(`Far proxy has ${triangles} triangles, over the ${cap} cap`);
  const mesh = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colours: Float32Array.from(colours), region: Float32Array.from(region), cliff: Float32Array.from(cliff), index: Uint32Array.from(index), triangles };
  return reduce === undefined ? mesh : compact(mesh);
}

/** Drop the vertices no triangle uses (a reduced lattice's), keeping the survivors' order. */
function compact(mesh: FarProxyMesh): FarProxyMesh {
  const count = mesh.region.length, remap = new Int32Array(count).fill(-1);
  for (const i of mesh.index) remap[i] = 0;
  let kept = 0;
  for (let v = 0; v < count; v++) if (remap[v] === 0) remap[v] = kept++;
  const pick = (source: Float32Array, width: number): Float32Array => {
    const out = new Float32Array(kept * width);
    for (let v = 0; v < count; v++) { const to = remap[v] ?? -1; if (to >= 0) out.set(source.subarray(v * width, v * width + width), to * width); }
    return out;
  };
  return { positions: pick(mesh.positions, 3), normals: pick(mesh.normals, 3), colours: pick(mesh.colours, 3), region: pick(mesh.region, 1), cliff: pick(mesh.cliff, 1),
    index: Uint32Array.from(mesh.index, (i) => remap[i] ?? 0), triangles: mesh.triangles };
}

/** Append a model part: its region from its centre, area-weighted vertex normals from its faces. */
function addPart(part: FarPart, regionSize: number, out: { positions: number[]; normals: number[]; colours: number[]; region: number[]; cliff: number[]; index: number[] }): void {
  const { positions: p, colours: c, index: idx } = part, count = p.length / 3;
  if (!Number.isInteger(count) || c.length !== p.length || idx.length % 3 !== 0) throw new RangeError('Invalid far part');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < count; v++) {
    const x = p[v * 3] ?? Number.NaN, y = p[v * 3 + 1] ?? Number.NaN, z = p[v * 3 + 2] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > CHUNK_HALF || Math.abs(z) > CHUNK_HALF) throw new RangeError('Far part outside the cell');
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cell = (u: number): number => Math.min(FAR_REGIONS - 1, Math.max(0, Math.floor((u + CHUNK_HALF) / regionSize)));
  const r = cell((minX + maxX) / 2) + cell((minZ + maxZ) / 2) * FAR_REGIONS, normal = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] ?? 0, b = idx[t + 1] ?? 0, d = idx[t + 2] ?? 0;
    if (a >= count || b >= count || d >= count) throw new RangeError('Invalid far part index');
    const ux = (p[b * 3] ?? 0) - (p[a * 3] ?? 0), uy = (p[b * 3 + 1] ?? 0) - (p[a * 3 + 1] ?? 0), uz = (p[b * 3 + 2] ?? 0) - (p[a * 3 + 2] ?? 0);
    const vx = (p[d * 3] ?? 0) - (p[a * 3] ?? 0), vy = (p[d * 3 + 1] ?? 0) - (p[a * 3 + 1] ?? 0), vz = (p[d * 3 + 2] ?? 0) - (p[a * 3 + 2] ?? 0);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, d]) { normal[i * 3] = (normal[i * 3] ?? 0) + nx; normal[i * 3 + 1] = (normal[i * 3 + 1] ?? 0) + ny; normal[i * 3 + 2] = (normal[i * 3 + 2] ?? 0) + nz; }
  }
  const base = out.region.length;
  for (let v = 0; v < count; v++) {
    const nx = normal[v * 3] ?? 0, ny = normal[v * 3 + 1] ?? 0, nz = normal[v * 3 + 2] ?? 0, len = Math.hypot(nx, ny, nz);
    out.positions.push(p[v * 3] ?? 0, p[v * 3 + 1] ?? 0, p[v * 3 + 2] ?? 0);
    if (len > 0) out.normals.push(nx / len, ny / len, nz / len); else out.normals.push(0, 1, 0);
    out.colours.push(Math.min(1, Math.max(0, c[v * 3] ?? 0)), Math.min(1, Math.max(0, c[v * 3 + 1] ?? 0)), Math.min(1, Math.max(0, c[v * 3 + 2] ?? 0)));
    out.region.push(r); out.cliff.push(0);
  }
  for (const i of idx) out.index.push(base + i);
}
