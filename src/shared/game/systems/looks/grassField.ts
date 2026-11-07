import type { Scope } from '@wildshard/engine/app/scope';
import { SEED, CHUNK_HALF } from '@wildshard/engine/core/config';
import { Noise2D, smoothstep, lerp } from '@wildshard/engine/core/noise';
import { activeLevel, onLevelChange } from '@wildshard/engine/level/selection';
import { normalAt, splatAt, trailDistance, cabinMask, pondMask, waterLevel } from '@wildshard/engine/world/Heightfield';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { PopulationFieldSchema } from '@wildshard/format/populationEnvironment';
import { parse, type InferOutput } from 'valibot';

/**
 * The painterly grass *field*: how tall the grass stands, how golden it is and which flowers grow, as pure
 * functions of (x, z). The GPU blade rings (src/shards/level/look/grass.ts bakes this field into its textures) and the senses
 * (stealth, wolf AI through `grassHeightAt` in GrassTrample.ts) read the same numbers, so the CPU knows the height the
 * GPU draws without any readback.
 *
 *   grassBaseHeightAt(x, z)  metres (0 = bare: water, trail bed, rock, snow, yurt floor) — before trampling
 *   flowerPatchAt(x, z)      0..1 flower-drift strength (GrassField.sample channels: 1 tone, 3 species, 7 bloom)
 *
 * The field is sampled on a 4 m lattice (cached per chunk) and bilinearly interpolated, so it is smooth, cheap
 * to query many times a frame, and identical for the grass and the senses.
 *
 * the authored meadow (`docs/design/nalati/stealth-and-storms.md`, `geography-and-map.md` §3): short trodden grass only in the
 * camp yard, the corral, the bridge heads, the summer hearth and inside the balbal circle; bare yurt floors and road
 * beds with a lush verge right up to the dirt; a knee-high 0.66–0.72 m meadow everywhere else (look pass: the
 * mockups carry lush grass and flower drifts everywhere); **1.0–1.25 m feather-grass stealth fields** — hand-placed
 * (river banks, the wolf spur by the east gully, five plateau fields) plus elongated E–W bands in the plateau's
 * folds. Other shards get a plain meadow with noise bands.
 */

const LATTICE = 4;

/** tall-grass height of the stealth fields (m) */
const TALL_GRASS = 1.12;

interface Zone { x: number; z: number; r: number; h: number }

/** Authored meadow geography is supplied by the level plugin. */
interface GrassFieldLayout {
  short: readonly Zone[]; tall: readonly Zone[]; bare: readonly Zone[];
  valley: number; plateau: number;
  riverZ: (x: number) => number; riverHalf: (x: number) => number;
}

/**
 * The samplers a grass field reads (SF72): the page binds the installed terrain (the baked grid's height, normal and splat, the
 * level's trails, pads and water) and the level's paint; a renderer-free host binds the same grid and terrain field directly.
 */
export interface GrassFieldPorts {
  /** the noise seed (the page's level SEED) and the chunk's half-size (m) */
  readonly seed: number; readonly half: number;
  readonly heightAt: (x: number, z: number) => number;
  readonly normalAt: (x: number, z: number, eps: number) => readonly [number, number, number];
  readonly splatAt: (x: number, z: number) => readonly [number, number, number, number];
  readonly trailDistance: (x: number, z: number) => number;
  readonly cabinMask: (x: number, z: number) => number;
  readonly pondMask: (x: number, z: number) => number;
  readonly waterLevel: () => number;
  /** the ground colour under the grass (the level's `groundColor`) into `out`, false when the level paints none */
  readonly paint: (x: number, z: number, y: number, slope: number, out: [number, number, number]) => boolean;
  /** the authored meadow, or null (a plain meadow with noise bands) */
  readonly layout: GrassFieldLayout | null;
}

const STRIDE = 8; // per corner: height, tone, flower drift, drift species, ground r, g, b, grass bloom

function zoneWeight(z: Zone, x: number, zz: number, falloff: number): number {
  const d = Math.hypot(x - z.x, zz - z.z);
  return 1 - smoothstep(z.r, z.r * (1 + falloff), d);
}

/**
 * One grass field over its samplers: the 4 m lattice (126 corners a side over a 500 m chunk), filled lazily and bilinearly
 * sampled. The page's module functions below read the one it binds to the installed terrain; a renderer-free host builds
 * its own over the same baked grid (SF72), so its senses read the numbers the page's do.
 */
export class GrassField {
  private readonly noise: Noise2D;
  private readonly noise2: Noise2D;
  private readonly ln: number;
  private readonly lattice: Float32Array;
  private readonly rgb: [number, number, number] = [0, 0, 0];
  private readonly ports: GrassFieldPorts;

  constructor(ports: GrassFieldPorts) {
    this.ports = ports;
    this.noise = new Noise2D(ports.seed + 911); this.noise2 = new Noise2D(ports.seed + 912);
    this.ln = Math.ceil((ports.half * 2) / LATTICE) + 1;
    this.lattice = new Float32Array(this.ln * this.ln * STRIDE).fill(Number.NaN);
  }

  private inChunk(x: number, z: number, margin: number): boolean {
    const half = this.ports.half;
    return Math.abs(x) <= half - margin && Math.abs(z) <= half - margin;
  }

  /** the raw field at one point: [height m, tone 0..1, flower drift 0..1, drift species 0..1, ground colour (linear rgb)] */
  private evalField(x: number, z: number, out: Float32Array, o: number): void {
    const P = this.ports, noise = this.noise, noise2 = this.noise2, rgb = this.rgb;
    const y = P.heightAt(x, z);
    const ny = P.normalAt(x, z, 1.5)[1];
    // the painted ground under the grass (the def's own palette): roots and the far carpet fade into it
    if (!P.paint(x, z, y, 1 - ny, rgb)) { rgb[0] = 0.12; rgb[1] = 0.2; rgb[2] = 0.05; }
    out[o + 4] = rgb[0]; out[o + 5] = rgb[1]; out[o + 6] = rgb[2];
    if (!this.inChunk(x, z, 0.5)) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; out[o + 7] = 0; return; }
    const meadow = P.layout;
    const n1 = noise.fbm(x * 0.021, z * 0.021, 3);     // meadow undulation
    const tone0 = meadow !== null ? smoothstep(2, 26, y) : 0.35;
    let tone = Math.min(1, Math.max(0, tone0 + 0.22 * noise2.fbm(x * 0.013, z * 0.013, 2)));
    // base meadow
    let h = (meadow !== null ? lerp(meadow.valley, meadow.plateau, tone0) : 0.55) * (1 + 0.16 * n1);
    if (meadow !== null) {
      // plateau folds: elongated E–W bands of feather grass (x stretched 2.4×)
      if (y > 22) {
        const band = smoothstep(0.18, 0.42, noise.fbm(x * 0.0085 + 17.3, z * 0.021 - 4.1, 3));
        h = lerp(h, TALL_GRASS * (0.94 + 0.1 * n1), band * smoothstep(22, 28, y));
      }
      // river banks: a strip of tall grass just outside the gravel corridor, not at the bridge (camp: short zone)
      const half = meadow.riverHalf(x);
      const dr = Math.abs(z - meadow.riverZ(x));
      const bank = smoothstep(half + 2, half + 5, dr) * (1 - smoothstep(half + 12, half + 18, dr)) * smoothstep(22, 34, Math.abs(x)) * (y < 2 ? 1 : 0);
      h = lerp(h, TALL_GRASS * 0.95, bank);
      for (const zn of meadow.tall) h = lerp(h, zn.h * (0.95 + 0.1 * n1), zoneWeight(zn, x, z, 0.5));
      for (const zn of meadow.short) h = lerp(h, zn.h, zoneWeight(zn, x, z, 0.8));
      // the Crags: short above +45, bare snow / rock above +54
      h *= 1 - smoothstep(38, 48, y) * 0.7;
      if (y > 54) h = 0;
      // the valley by the river is fresh green, the escarpment spurs in between
      const near = 1 - smoothstep(half, half + 30, dr);
      // the chunk's splat is [grass, gravel + dirt, rock, snow]: grass only where the ground is painted grass
      h *= smoothstep(0.3, 0.65, P.splatAt(x, z)[0]);
      tone = Math.max(0, tone - near * 0.25);
    } else {
      const band = smoothstep(0.25, 0.5, noise.fbm(x * 0.012 + 3.1, z * 0.024, 3));
      h = lerp(h, TALL_GRASS, band);
    }
    // slopes too steep for turf; yurt / cabin pads grazed; no grass in water
    h *= smoothstep(0.62, 0.8, ny);
    h *= 1 - 0.85 * P.cabinMask(x, z);
    if (P.pondMask(x, z) > 0.02 || y < P.waterLevel() + 0.15) h = 0;
    out[o] = h; out[o + 1] = tone;
    // flower drifts: blobs 8–25 m across, sharp-edged (a drift, not a sprinkle), each mostly one species (the
    // dressing reads these for its 3D lupins / daisies)
    out[o + 2] = smoothstep(0.22, 0.42, noise2.fbm(x * 0.045 + 40, z * 0.045 - 12, 2));
    // the grass's own bloom: the drifts above plus broad soft meadows of flowers 20–60 m across (only the grass's
    // small heads use it — the dressing's 3D lupins / daisies stay on the tighter drifts)
    out[o + 7] = Math.max(out[o + 2] ?? 0, 0.7 * smoothstep(0.0, 0.35, noise2.fbm(x * 0.02 - 13, z * 0.02 + 57, 2)));
    out[o + 3] = 0.5 + 0.5 * noise.get(x * 0.021 - 71, z * 0.021 + 33);
  }

  private corner(ix: number, iz: number): number {
    const ln = this.ln, cx = Math.min(ln - 1, Math.max(0, ix)), cz = Math.min(ln - 1, Math.max(0, iz));
    const o = (cz * ln + cx) * STRIDE;
    if (Number.isNaN(this.lattice[o] ?? Number.NaN)) this.evalField(cx * LATTICE - this.ports.half, cz * LATTICE - this.ports.half, this.lattice, o);
    return o;
  }

  /** bilinear sample of channel `ch` of the cached lattice */
  sample(x: number, z: number, ch: number): number {
    const half = this.ports.half, lattice = this.lattice;
    const fx = (x + half) / LATTICE, fz = (z + half) / LATTICE;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const a = lattice[this.corner(ix, iz) + ch] ?? 0, b = lattice[this.corner(ix + 1, iz) + ch] ?? 0;
    const c = lattice[this.corner(ix, iz + 1) + ch] ?? 0, d = lattice[this.corner(ix + 1, iz + 1) + ch] ?? 0;
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /** trails: a bare bed (1.6 m half-width, the authored meadow's roads 3.9 m), a grazed verge, the field back ~5 m further — per point, a 4 m
   *  lattice cannot hold a 3 m path */
  trailGrass(h: number, td: number): number {
    // the authored meadow's roads are painted dirt ~3.6–4.4 m either side of the centreline (the def's groundColor)
    // a lush verge right up to the dirt: a short fringe for half a metre, the full meadow a metre and a half out
    const bed = this.ports.layout !== null ? 3.9 : 1.6;
    if (td >= bed + 1.8) return h;
    return td < bed ? 0 : lerp(Math.min(h, 0.22), h, smoothstep(bed + 0.3, bed + 1.8, td)) * smoothstep(bed, bed + 0.35, td);
  }

  /**
   * Grass height before trampling, metres (0 = no grass). `td` = trailDistance(x, z) when the caller has it
   * (the seeder skips it for cells far from any trail: pass Infinity). `exact` also tests the chunk's splat at the
   * point (the seeder does on edge cells; the senses need not).
   */
  baseHeightAt(x: number, z: number, td: number = this.ports.trailDistance(x, z), exact = false): number {
    const P = this.ports;
    if (!this.inChunk(x, z, 0.5)) return 0;
    if (P.heightAt(x, z) < P.waterLevel() + 0.15) return 0;
    const h = this.trailGrass(this.sample(x, z, 0), td);
    const meadow = P.layout;
    if (meadow === null || h <= 0) return h;
    // the yurt floors stay bare
    for (const y of meadow.bare) { const dx = x - y.x, dz = z - y.z; if (dx * dx + dz * dz < (y.r + 0.3) ** 2) return 0; }
    // `exact`: also read the painted ground at the point (a road bed / gravel bar edge the 4 m lattice blurs)
    return exact ? h * smoothstep(0.35, 0.6, P.splatAt(x, z)[0]) : h;
  }
}

/** The page's field: the installed terrain (live: a baked grid installed later is read from then on) and the active level's paint. */
let layout: GrassFieldLayout | null = null;
function pageField(): GrassField {
  return new GrassField({
    seed: SEED, half: CHUNK_HALF, heightAt, normalAt: (x, z, eps) => normalAt(x, z, eps), splatAt: (x, z) => splatAt(x, z),
    trailDistance: (x, z) => trailDistance(x, z), cabinMask: (x, z) => cabinMask(x, z), pondMask: (x, z) => pondMask(x, z), waterLevel: () => waterLevel(),
    paint: (x, z, y, slope, out) => {
      const level = activeLevel(), paint = level.groundColor, terrain = level.ground.terrain;
      if (!paint || !terrain) return false;
      paint(x, z, y, slope, terrain, out);
      return true;
    },
    layout,
  });
}
let field = pageField();
function reset(): void { field = pageField(); }
export function configureGrassField(next: GrassFieldLayout, scope: Scope): void {
  meadowLayout(); layout = next; reset();
  scope.onDispose(() => { if (layout === next) { layout = null; reset(); } });
}
/** Admit the native meadow's geography on the page without author samplers. */
export function configureGrassFieldData(input:unknown,scope:Scope):GrassFieldLayout{
  const next=populationMeadow(parse(PopulationFieldSchema,input));configureGrassField(next,scope);return next;
}
/** Page and native fields share the admitted meadow and exact clamped river
 * interpolation. This borrows the rows without decoding or installing a field. */
export function populationMeadow(rows:Pick<InferOutput<typeof PopulationFieldSchema>,'river'|'meadow'>):GrassFieldLayout{
  const river=rows.river;
  const profile=(x:number,index:0|1):number=>{
    const at=Math.max(0,Math.min(river.values.length-1,(x-river.from)/river.step)),i=Math.min(river.values.length-2,Math.floor(at));
    const a=river.values[i]?.[index]??0,b=river.values[i+1]?.[index]??a;return a+(b-a)*(at-i);
  };
  return {...rows.meadow,riverZ:(x:number)=>profile(x,0),riverHalf:(x:number)=>profile(x,1)};
}
let listening = false;
function meadowLayout(): GrassFieldLayout | null {
  if (!listening) { listening = true; onLevelChange(() => { layout = null; reset(); }); }
  return layout;
}
/** the page field, the level-change listener installed on first use (as the field always has) */
function page(): GrassField { meadowLayout(); return field; }

/**
 * Grass height before trampling, metres (0 = no grass), on the page's field (GrassField.baseHeightAt). `td` =
 * trailDistance(x, z) when the caller has it (pass Infinity far from any trail); `exact` also tests the splat at the point.
 */
export function grassBaseHeightAt(x: number, z: number, td: number = trailDistance(x, z), exact = false): number {
  return page().baseHeightAt(x, z, td, exact);
}

/** 0..1 flower-drift strength */
export function flowerPatchAt(x: number, z: number): number { return page().sample(x, z, 2); }
