/**
 * One frame for the grid (SHARD-PLATFORM SF19a, re-aimed by G158), the pure model: who owns the frame where the player
 * stands, and how the owners' looks blend across the cell edge. Node-safe; no three.js.
 *
 * - **The owner** (G158, Jake: "once you enter a shard, that shard has a lot of control over the graphics … once you
 *   leave a shard, it goes back to the neutral no man's road network's art style"): inside a cell its shard owns the
 *   whole frame (its sky, sun, air, exposure and grade apply to everything on screen, neighbours included); on the road
 *   and strips the neutral road look does. There is no per-pixel region any more: one look per frame.
 * - **The blend**: the owner changes at the cell edge (§3.3's crossing line, the 500 m cell boundary). A cell's weight
 *   is 1 more than `band / 2` inside its edge, 0 more than `band / 2` outside it, and a smoothstep across the band
 *   between (`FRAME_BAND`, 16 m centred on the line). It is a pure function of position, so standing on the line holds
 *   a steady half-and-half blend and never flickers. The strip is 55 m wide, so two cells never share a frame: the road
 *   look holds the whole deck (the road band is 20–35 m out).
 * - **Time**: one world clock; an owner may declare a fixed time of day, blended in by its weight along the shortest
 *   way round the day.
 */

/** How wide (m) the frame's blend is at the cell edge, centred on the line: 8 m in, 8 m out. */
export const FRAME_BAND = 16;

/**
 * A look's grade after the camera's tone mapping: exposure in stops, saturation and contrast as factors, and an optional
 * linear RGB tint multiplied in last (absent: white).
 */
export interface RegionGrade { readonly exposure: number; readonly saturation: number; readonly contrast: number; readonly tint?: readonly [number, number, number] | undefined }
/** The grade that changes nothing (any shard that declares none). */
export const NEUTRAL_GRADE: RegionGrade = { exposure: 0, saturation: 1, contrast: 1 };
/**
 * G75 (Jake: "C Identity + neutral road"): the road and strips take a neutral grey-blue grade, a fifth of their colour
 * out and a cool tint (under G158 the road look owns the whole frame while the player is on the road).
 */
export const HIGHWAY_GRADE: RegionGrade = { exposure: 0, saturation: 0.8, contrast: 1, tint: [0.95, 0.99, 1.07] };
/** The neutral road look: its grey-blue grade, and its air is the home horizon with half its colour taken out. */
export const HIGHWAY_LOOK: { readonly grade: RegionGrade; readonly fogDesaturate: 0.5; } = { grade: HIGHWAY_GRADE, fogDesaturate: 0.5 } as const;
/**
 * G165 (Jake: "A, road light over everything") and G242 (Jake's pick B, "grid dawn", `art/grid/round-26-road-sky/B-grid-dawn.jpg`):
 * the road's own sky and key light, which replace the page's while the player is on the road (`roadSky.ts`). One shader
 * dome, no textures: a dawn gradient (a peach horizon, a lavender band, a clear blue zenith), a thin cyan horizon line and a
 * faint cyan grid round the horizon echoing the HUD and the VR void; a low warm dawn sun. Colours are linear RGB.
 * - `air`: the road's air (the frame's fog colour on the road, which the far proxies haze into) and the dome's horizon;
 * - `mid` / `zenith`: the dome's lavender band and its zenith;
 * - `line` / `grid`: the cyan horizon line and grid, `gridStrength` the grid's opacity at the horizon;
 * - `void`: G630, the blue-violet past the grid floor (the dome below the horizon, the grid page's background), on the road
 *   and with a cell entered alike (the shipped 10-13 hero's);
 * - `sun`: the key light (compass degrees, its colour, its intensity) and the glow it puts in the dome;
 * - `hemi`, `env`, `fogSun`: the fill, the environment's intensity and the fog's in-scatter colour under it.
 */
export const ROAD_SKY = {
  air: [0.95, 0.56, 0.44] as const, mid: [0.58, 0.46, 0.8] as const, zenith: [0.1, 0.24, 0.72] as const,
  line: [0.25, 1.1, 1.4] as const, grid: [0.3, 0.85, 1.1] as const, gridStrength: 0.3, void: [0.17, 0.17, 0.27] as const,
  sun: { azimuth: 70, elevation: 13, colour: [1, 0.8, 0.66] as const, intensity: 2.4, glow: [1, 0.62, 0.42] as const },
  hemi: { sky: [0.6, 0.62, 0.86] as const, ground: [0.42, 0.36, 0.34] as const, intensity: 1.1 },
  env: 0.7, fogSun: [1, 0.72, 0.56] as const,
} as const;

/** A grade with every field present (the frame's blended grade). */
export interface FullGrade { readonly exposure: number; readonly saturation: number; readonly contrast: number; readonly tint: readonly [number, number, number] }

/** A cell as the frame sees it: its instance and origin (grid metres). */
export interface FrameCell { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }
/** The frame's owners: each cell's weight (only cells over 0) and the road's; they sum to 1. */
export interface RegionWeights { readonly cells: ReadonlyMap<string, number>; readonly highway: number }

/** Signed distance (m) from (x, z) to a cell's square edge: negative inside, positive outside. */
export function edgeDistance(cell: FrameCell, x: number, z: number, half: number): number {
  const ax = Math.abs(x - cell.origin.x) - half, az = Math.abs(z - cell.origin.z) - half;
  return ax <= 0 && az <= 0 ? Math.max(ax, az) : Math.hypot(Math.max(0, ax), Math.max(0, az));
}

/** The frame's owners at the player's (x, z) in grid metres. */
export function frameOwners(cells: readonly FrameCell[], x: number, z: number, half: number, band: number = FRAME_BAND): RegionWeights {
  if (!(half > 0) || !(band > 0)) throw new RangeError('A grid frame needs a positive cell half-size and band');
  const raw = new Map<string, number>();
  let sum = 0;
  for (const cell of cells) {
    const t = Math.min(1, Math.max(0, (edgeDistance(cell, x, z, half) + band / 2) / band));
    const w = 1 - t * t * (3 - 2 * t);
    if (w > 0) { raw.set(cell.instance, w); sum += w; }
  }
  // inside a square the cell owns the whole frame; on the road the road look takes what the cells leave
  const scale = sum > 1 ? 1 / sum : 1, out = new Map<string, number>();
  for (const [instance, w] of raw) out.set(instance, w * scale);
  return { cells: out, highway: Math.max(0, 1 - sum * scale) };
}

/** The owner that holds most of the frame (null: the road look). */
export function dominantOwner(weights: RegionWeights): string | null {
  let best: string | null = null, top = weights.highway;
  for (const [instance, w] of weights.cells) if (w > top) { best = instance; top = w; }
  return best;
}


type Rgb = readonly [number, number, number];
/**
 * The frame's air colour: the home's live fog, a neighbour owner's declared haze and the road's air, by weight. The road's
 * air is `road` (G242: its own dawn air, `ROAD_SKY.air`), else the home horizon with half its colour taken out (G158).
 */
export function frameFog(weights: RegionWeights, home: { readonly instance: string | null; readonly fog: Rgb }, hazes: ReadonlyMap<string, Rgb>, road?: Rgb): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const add = (c: Rgb, w: number): void => { out[0] += c[0] * w; out[1] += c[1] * w; out[2] += c[2] * w; };
  let left = 1;
  for (const [instance, w] of weights.cells) {
    const colour = instance === home.instance ? home.fog : hazes.get(instance) ?? home.fog;
    add(colour, w); left -= w;
  }
  const grey = (home.fog[0] + home.fog[1] + home.fog[2]) / 3, d = HIGHWAY_LOOK.fogDesaturate;
  add(road ?? [home.fog[0] + (grey - home.fog[0]) * d, home.fog[1] + (grey - home.fog[1]) * d, home.fog[2] + (grey - home.fog[2]) * d], Math.max(0, left));
  return out;
}

/**
 * The frame's one grade on top of the home's own chain: the home contributes the neutral grade (its own grade effects
 * fade with its weight instead), a neighbour owner its declared grade, the road the G75 grey-blue grade, by weight.
 */
export function frameGrade(weights: RegionWeights, home: string | null, grades: ReadonlyMap<string, RegionGrade>): FullGrade {
  let exposure = 0, saturation = 0, contrast = 0, r = 0, g = 0, b = 0, left = 1;
  const add = (grade: RegionGrade, w: number): void => {
    const tint = grade.tint ?? [1, 1, 1];
    exposure += grade.exposure * w; saturation += grade.saturation * w; contrast += grade.contrast * w;
    r += tint[0] * w; g += tint[1] * w; b += tint[2] * w;
  };
  for (const [instance, w] of weights.cells) { add(instance === home ? NEUTRAL_GRADE : grades.get(instance) ?? NEUTRAL_GRADE, w); left -= w; }
  add(HIGHWAY_GRADE, Math.max(0, left));
  return { exposure, saturation, contrast, tint: [r, g, b] };
}
