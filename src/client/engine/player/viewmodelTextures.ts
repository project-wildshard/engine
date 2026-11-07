import { smoothstep } from '../../../shared/engine/core/noise';
/**
 * The weapon viewmodels' procedural texture sets as plain pixels — no three.js, no DOM (a 2D canvas comes from the
 * caller), so the same code runs in a worker (viewmodelTextures.worker.ts) or on the main thread. Drawing them is
 * the crossbow's and the rifle's whole construction cost (~290 + 180 ms of main thread at 4× CPU); Crossbow.ts
 * starts the worker at boot (`startViewmodelTextures`) and wraps the pixels as DataTextures when the weapons are
 * built. Byte-identical either way: the worker runs these very functions.
 *
 *   const p = makePixels('walnut');   // { w, h, col, nrm, arm } — RGBA8 rows, row 0 = v 0 (DataTexture order)
 */
export interface Noise { hash: (x: number, y: number) => number; n: (x: number, y: number) => number; fbm: (x: number, y: number, oct?: number) => number }
export type SetName = 'walnut' | 'brushed-steel' | 'leather' | 'cord' | 'bolt' | 'anodised' | 'polymer' | 'gunmetal';
/** the procedural material sets by kind: wood, brushed steel, leather, cord and fletching; anodised aluminium, polymer and
 *  gunmetal (a weapon names the sets it wears: viewmodelTexSet) */
export const CLASSIC_SETS: readonly SetName[] = ['walnut', 'brushed-steel', 'leather', 'cord', 'bolt'];
export const MODERN_SETS: readonly SetName[] = ['anodised', 'polymer', 'gunmetal'];
/**
 * G187 cut 3 (E435): the name a set plane's baked KTX2 is keyed by in a level's KTX2 table (scripts/bake-viewmodel-sets.mjs
 * writes it; combat/view/ranged.ts startViewmodelTextures adopts it on the KTX2 path): a name, not a file — only its `/assets/gpu/`
 * stand-in exists. The `procedural:` key cannot be mistaken for a fetchable PNG. `col` / `nrm` / `arm` are the Pixels planes.
 */
export function viewmodelBakeUrl(slug: string, name: SetName, plane: 'col' | 'nrm' | 'arm'): string {
  return `procedural:/assets/baked/${slug}/viewmodel/${name}.${plane}.png`;
}
/** RGBA8 colour (sRGB), normal and ARM (ao · roughness · metalness; absent for the cord) planes, `w × h` */
export interface Pixels { w: number; h: number; col: Uint8Array; nrm: Uint8Array; arm: Uint8Array | null }

/** the 2D-context surface makeSteel draws with — a CanvasRenderingContext2D or an OffscreenCanvasRenderingContext2D */
export interface Ctx2D {
  createImageData: (w: number, h: number) => ImageData;
  putImageData: (data: ImageData, x: number, y: number) => void;
  getImageData: (x: number, y: number, w: number, h: number) => ImageData;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  arc: (x: number, y: number, r: number, a0: number, a1: number) => void;
  stroke: () => void;
  fill: () => void;
}

export function makeNoise(seed: number): Noise {
  const hash = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const n = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  const fbm = (x: number, y: number, oct = 4) => {
    let s = 0, a = 0.5, f = 1, sum = 0;
    for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * a; sum += a; a *= 0.5; f *= 2.03; }
    return s / sum;
  };
  return { hash, n, fbm };
}
export const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v));
export const sstep: (a: number, b: number, x: number) => number = smoothstep;   // the one smoothstep (E357 X5)

/** tangent-space normal map (RGBA8) from a wrapping height field */
export function normalPixels(h: Float32Array, w: number, hgt: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * hgt * 4);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const l = h[y * w + ((x + w - 1) % w)] ?? 0, r = h[y * w + ((x + 1) % w)] ?? 0;
    const d = h[((y + hgt - 1) % hgt) * w + x] ?? 0, u = h[((y + 1) % hgt) * w + x] ?? 0;
    let nx = -(r - l) * strength, ny = -(u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

/** Dark walnut: fine ring bands, streaks along the grain, oil smudges. Grain runs along U. 1 UV unit ≈ 1 m × 0.25 m. */
function walnut(seed: number): Pixels {
  const W = 1024, H = 256;
  const { fbm, hash } = makeNoise(seed);
  const col = new Uint8Array(W * H * 4), arm = new Uint8Array(W * H * 4), hgt = new Float32Array(W * H);
  const dark = [22, 12, 6], light = [72, 46, 26];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const warp = fbm(u * 3 + 7, v * 2, 4);
    const ringCoord = v * 26 + u * 1.3 + warp * 3.2 + fbm(u * 40, v * 6, 2) * 0.7;
    const ring = ringCoord - Math.floor(ringCoord);
    const band = sstep(0.5, 0.8, ring) * (1 - sstep(0.9, 1.0, ring)); // late wood
    const fine = fbm(u * 160, v * 24 + 3, 3);
    const smudge = fbm(u * 4 + 40, v * 3 + 9, 3);
    const fleck = hash(x, y);
    const lum = (1 - band * 0.55) * (0.72 + fine * 0.5) * (0.82 + smudge * 0.32) * (0.96 + fleck * 0.08);
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) { const dk = dark[c] ?? 0, lt = light[c] ?? 0; col[i + c] = clamp01((dk + (lt - dk) * lum) / 255) * 255; }
    col[i + 3] = 255;
    const rough = clamp01(0.74 + band * 0.12 + (fine - 0.5) * 0.14 - smudge * 0.08);
    arm[i] = (1 - band * 0.1) * 255; arm[i + 1] = rough * 255; arm[i + 2] = 0; arm[i + 3] = 255;
    hgt[y * W + x] = (1 - band) * 0.45 + fine * 0.3 + fleck * 0.02;
  }
  return { w: W, h: H, col, nrm: normalPixels(hgt, W, H, 1.6), arm };
}

/** Forged steel: mottled grey, brushed scratches, pits with a rust tint. */
function steel(seed: number, canvas2d: (w: number, h: number) => Ctx2D): Pixels {
  const S = 512;
  const { fbm, hash } = makeNoise(seed);
  const ctx = canvas2d(S, S);
  const img = ctx.createImageData(S, S);
  const roughBase = new Float32Array(S * S), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const mottle = fbm(u * 6, v * 6, 4), grain = fbm(u * 120, v * 4, 2);
    const g = 128 + (mottle - 0.5) * 50 + (grain - 0.5) * 18;
    const i = (y * S + x) * 4;
    img.data[i] = g * 0.98; img.data[i + 1] = g; img.data[i + 2] = g * 1.04; img.data[i + 3] = 255;
    roughBase[y * S + x] = 0.3 + (mottle - 0.5) * 0.2 + (grain - 0.5) * 0.12;
    hgt[y * S + x] = mottle * 0.3 + grain * 0.15;
  }
  ctx.putImageData(img, 0, 0);
  // scratches (brushed, mostly horizontal) + pits
  const rnd = (i: number) => hash(i, 77);
  for (let k = 0; k < 220; k++) {
    const x0 = rnd(k) * S, y0 = rnd(k + 1000) * S, len = 20 + rnd(k + 2000) * 120, ang = (rnd(k + 3000) - 0.5) * 0.5 + (rnd(k + 4000) > 0.85 ? 1.2 : 0);
    ctx.strokeStyle = `rgba(${200 + rnd(k + 5000) * 55},${205 + rnd(k + 5000) * 50},${215 + rnd(k + 5000) * 40},${0.12 + rnd(k + 6000) * 0.25})`;
    ctx.lineWidth = 0.6 + rnd(k + 7000) * 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); ctx.stroke();
  }
  for (let k = 0; k < 90; k++) {
    const x0 = rnd(k + 9000) * S, y0 = rnd(k + 9500) * S, r = 1 + rnd(k + 9800) * 3.5;
    ctx.fillStyle = `rgba(${70 + rnd(k) * 40},${45 + rnd(k) * 25},28,${0.35 + rnd(k + 300) * 0.4})`;
    ctx.beginPath(); ctx.arc(x0, y0, r, 0, Math.PI * 2); ctx.fill();
  }
  const final = ctx.getImageData(0, 0, S, S).data;
  const col = new Uint8Array(S * S * 4), arm = new Uint8Array(S * S * 4);
  for (let p = 0; p < S * S; p++) {
    const i = p * 4;
    const fr = final[i] ?? 0, fg = final[i + 1] ?? 0, fb = final[i + 2] ?? 0;
    col[i] = fr; col[i + 1] = fg; col[i + 2] = fb; col[i + 3] = 255;
    const bright = (fr + fg + fb) / (3 * 128); // scratches are bright, pits dark
    const rusty = fr > fb + 12 ? 1 : 0;
    const rough = clamp01((roughBase[p] ?? 0) + Math.max(0, bright - 1.05) * 0.5 + rusty * 0.45);
    arm[i] = (1 - rusty * 0.35) * 255; arm[i + 1] = rough * 255; arm[i + 2] = (1 - rusty * 0.6) * 255; arm[i + 3] = 255;
    hgt[p] = (hgt[p] ?? 0) + (bright - 1) * 0.6 - rusty * 0.8;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 1.4), arm };
}

/** Oiled leather wrap: pebbled grain + strap seams. */
function leather(seed: number): Pixels {
  const S = 256;
  const { fbm } = makeNoise(seed);
  const col = new Uint8Array(S * S * 4), arm = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const pebble = fbm(u * 40, v * 40, 3), big = fbm(u * 4, v * 4, 3);
    const seam = Math.abs(((v * 6) % 1) - 0.5) < 0.04 ? 1 : 0;
    const lum = 0.55 + (pebble - 0.5) * 0.5 + (big - 0.5) * 0.4 - seam * 0.35;
    const i = (y * S + x) * 4;
    col[i] = clamp01(lum * 0.4) * 255; col[i + 1] = clamp01(lum * 0.26) * 255; col[i + 2] = clamp01(lum * 0.16) * 255; col[i + 3] = 255;
    arm[i] = (1 - seam * 0.3) * 255; arm[i + 1] = clamp01(0.62 + (pebble - 0.5) * 0.3 + seam * 0.2) * 255; arm[i + 2] = 0; arm[i + 3] = 255;
    hgt[y * S + x] = pebble * 0.5 - seam * 0.8;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 2.5), arm };
}

/** Twisted hemp cord: diagonal stripes for both colour and bump (no ARM plane — the cord uses a flat one). */
function cord(): Pixels {
  const S = 64;
  const { fbm } = makeNoise(5);
  const col = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const twist = Math.sin((u * 2 + v * 6) * Math.PI * 2);
    const f = fbm(u * 8, v * 8, 2);
    const lum = 0.62 + twist * 0.2 + (f - 0.5) * 0.15;
    const i = (y * S + x) * 4;
    col[i] = clamp01(lum * 0.46) * 255; col[i + 1] = clamp01(lum * 0.36) * 255; col[i + 2] = clamp01(lum * 0.22) * 255; col[i + 3] = 255;
    hgt[y * S + x] = twist * 0.5;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 3), arm: null };
}

/** Bolt atlas: bottom half iron shaft, top-left steel head, top-right feather vane (alpha). */
function bolt(seed: number): Pixels {
  const S = 512;
  const { fbm, hash } = makeNoise(seed);
  const col = new Uint8Array(S * S * 4), arm = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    let r: number, g: number, b: number, a = 255, rough: number, metal = 0, h: number; const ao = 1;
    if (v < 0.5) { // iron shaft: drawn/forged steel, fine longitudinal scratches, a little bluing
      const grain = fbm(u * 80, v * 4, 3), scratch = fbm(u * 260, v * 3, 2), mottle = fbm(u * 6, v * 12, 2);
      const lum = 0.42 + (grain - 0.5) * 0.22 + (scratch - 0.5) * 0.12 + (mottle - 0.5) * 0.1;
      r = 255 * lum * 0.94; g = 255 * lum * 0.97; b = 255 * lum * 1.04; rough = 0.42 + (mottle - 0.5) * 0.25 + (scratch - 0.5) * 0.15; metal = 1; h = grain * 0.4;
    } else if (u < 0.5) { // steel
      const m = fbm(u * 20, v * 20, 4), scratch = fbm(u * 200, v * 6, 2);
      const lum = 0.5 + (m - 0.5) * 0.35 + (scratch - 0.5) * 0.15;
      r = 255 * lum * 0.97; g = 255 * lum; b = 255 * lum * 1.03; rough = 0.28 + (m - 0.5) * 0.25 + (scratch - 0.5) * 0.2; metal = 1; h = m * 0.5;
    } else { // feather: vane shape centred, barbs
      const lu = (u - 0.5) * 2, lv = (v - 0.5) * 2; // 0..1 each
      const edge = 0.92 - lu ** 1.6 * 0.75; // trailing edge profile
      const inside = lv < edge && lv > 0.04 && lu > 0.02 && lu < 0.98;
      const barb = Math.sin((lv * 24 + lu * 8) * Math.PI * 2) * 0.5 + 0.5;
      const stripe = lu > 0.35 && lu < 0.55 ? 0.35 : 1;
      const lum = (0.78 + barb * 0.22 + (hash(x, y) - 0.5) * 0.08) * stripe;
      r = 205 * lum; g = 196 * lum; b = 178 * lum; a = inside ? 255 : 0; rough = 0.75; h = barb * 0.3;
    }
    col[i] = clamp01(r / 255) * 255; col[i + 1] = clamp01(g / 255) * 255; col[i + 2] = clamp01(b / 255) * 255; col[i + 3] = a;
    arm[i] = ao * 255; arm[i + 1] = clamp01(rough) * 255; arm[i + 2] = metal * 255; arm[i + 3] = 255;
    hgt[y * S + x] = h;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 1.5), arm };
}

/** Type III hard-coat anodised aluminium: near-black, a fine machining grain along U, faint mottle, bright wear on the edges of the pattern. */
function anodised(seed: number): Pixels {
  const S = 512;
  const { fbm, hash } = makeNoise(seed);
  const col = new Uint8Array(S * S * 4), arm = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const grain = fbm(u * 260, v * 3, 2), mottle = fbm(u * 5, v * 5, 4), scuff = fbm(u * 14 + 3, v * 14, 3);
    const wear = sstep(0.68, 0.9, scuff) * 0.35; // silver showing through where the coating is rubbed
    const lum = 0.22 + (grain - 0.5) * 0.08 + (mottle - 0.5) * 0.07 + wear * 0.5 + (hash(x, y) - 0.5) * 0.02;
    col[i] = clamp01(lum * 0.96) * 255; col[i + 1] = clamp01(lum * 0.98) * 255; col[i + 2] = clamp01(lum * 1.04) * 255; col[i + 3] = 255;
    const rough = clamp01(0.5 + (mottle - 0.5) * 0.14 + (grain - 0.5) * 0.08 - wear * 0.3);
    arm[i] = 255; arm[i + 1] = rough * 255; arm[i + 2] = (0.85 + wear * 0.15) * 255; arm[i + 3] = 255;
    hgt[y * S + x] = grain * 0.25 + mottle * 0.1;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 0.9), arm };
}

/** Glass-filled nylon (grip, stock, magazine): charcoal, a coarse stipple, faint mould lines. */
function polymer(seed: number): Pixels {
  const S = 256;
  const { fbm, hash } = makeNoise(seed);
  const col = new Uint8Array(S * S * 4), arm = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    const stipple = fbm(u * 90, v * 90, 2), big = fbm(u * 6, v * 6, 3), h = hash(x, y);
    const line = Math.abs(v - 0.5) < 0.004 ? 0.12 : 0; // mould parting line
    const lum = 0.13 + (stipple - 0.5) * 0.06 + (big - 0.5) * 0.04 + (h - 0.5) * 0.02 + line;
    col[i] = clamp01(lum) * 255; col[i + 1] = clamp01(lum * 1.02) * 255; col[i + 2] = clamp01(lum * 1.05) * 255; col[i + 3] = 255;
    arm[i] = 255; arm[i + 1] = clamp01(0.78 + (stipple - 0.5) * 0.2 - line) * 255; arm[i + 2] = 0; arm[i + 3] = 255;
    hgt[y * S + x] = stipple * 0.6 + h * 0.1 + line;
  }
  return { w: S, h: S, col, nrm: normalPixels(hgt, S, S, 2.2), arm };
}

/** One named set, drawn here and now (`canvas2d` only for the steel sets' scratches and pits). */
export function makePixels(name: SetName, canvas2d: (w: number, h: number) => Ctx2D): Pixels {
  const make: Record<SetName, () => Pixels> = {
    'walnut': () => walnut(11), 'brushed-steel': () => steel(23, canvas2d), 'leather': () => leather(31), 'cord': () => cord(), 'bolt': () => bolt(41),
    'anodised': () => anodised(53), 'polymer': () => polymer(59), 'gunmetal': () => steel(61, canvas2d),
  };
  return make[name]();
}
