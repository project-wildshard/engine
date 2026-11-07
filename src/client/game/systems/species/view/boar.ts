import * as THREE from 'three';
import { smoothstep as sstep } from '@wildshard/engine/core/noise';
import type { Rng } from '@wildshard/engine/core/rng';
import { crestSpikes } from '@wildshard/engine/entities/lowpoly';
import { loft, tube, skinPlain, S, boneIndex, mix, paintNoise, setShag, isLowPoly, paletteColors, srgb, toonPaint, type Paint, type RGB } from '@wildshard/engine/entities/species/loft';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import type { AnimalSpecies, BoneDef, VariantDef } from '@wildshard/engine/entities/species/registry';

/**
 * Wild boar — 0.62 m at the spine, shoulder hump, bristle crest, tusks, held-low wedge head.
 *
 * Variants (traits read by build): tuskScale (length; radius grows as tuskScale^0.6), scar (0/1: a pale
 * ragged stripe across the withers).
 * Palette keys (VariantDef.tint): base grizzle dark black snout tusk hoof eye cheek scar.
 */

export const BOAR_PALETTE: { // exported: pineCoats.ts recolours the rigged hull per variant from it
// dark grey-brown with grizzled pale bristle tips along the spine, pale tusks
base: [number, number, number]; grizzle: [number, number, number]; dark: [number, number, number]; black: [number, number, number]; snout: [number, number, number]; tusk: [number, number, number]; hoof: [number, number, number]; eye: [number, number, number]; cheek: [number, number, number]; scar: [number, number, number]; } = {   // exported: pineCoats.ts recolours the rigged hull per variant from it
  // dark grey-brown with grizzled pale bristle tips along the spine, pale tusks
  base: [0.36, 0.29, 0.225], grizzle: [0.58, 0.50, 0.40], dark: [0.16, 0.13, 0.10], black: [0.06, 0.05, 0.045],
  snout: [0.16, 0.09, 0.08], tusk: [0.90, 0.86, 0.74], hoof: [0.09, 0.075, 0.065], eye: [0.02, 0.015, 0.01], cheek: [0.40, 0.36, 0.30],
  scar: [0.80, 0.62, 0.56],   // bare, healed hide
} satisfies Record<string, RGB>;

/** near-black coat: the grizzle is only a dull sheen, the cheeks barely lighter */
const BLACK_TINT: Record<string, RGB> = {
  base: [0.10, 0.09, 0.085], grizzle: [0.24, 0.22, 0.20], dark: [0.05, 0.045, 0.04], black: [0.03, 0.03, 0.03], cheek: [0.17, 0.15, 0.13], snout: [0.10, 0.07, 0.07],
};

/** grey-brown, heavily grizzled old boar */
const SCARBACK_TINT: Record<string, RGB> = {
  base: [0.34, 0.31, 0.27], grizzle: [0.60, 0.56, 0.50], dark: [0.15, 0.135, 0.12], cheek: [0.46, 0.43, 0.38], tusk: [0.86, 0.80, 0.66],
};

/** Old Ironhide: iron-grey, almost blue in the shade, with steel-pale bristle tips */
const IRONHIDE_TINT: Record<string, RGB> = {
  base: [0.28, 0.29, 0.31], grizzle: [0.52, 0.54, 0.56], dark: [0.12, 0.125, 0.14], black: [0.05, 0.05, 0.06], cheek: [0.40, 0.41, 0.42],
  snout: [0.12, 0.10, 0.10], tusk: [0.80, 0.78, 0.70], hoof: [0.08, 0.08, 0.085],
};

function boarPaint(v: VariantDef): Paint {
  const P = paletteColors(BOAR_PALETTE, v.tint);
  const { base, grizzle, dark, black, snout, tusk, hoof, eye, cheek, scar } = P;
  const tuskRoot = srgb(0.55, 0.48, 0.40);
  const hasScar = Boolean(v.traits?.['scar']);
  return (out, x, y, z, nx, ny, nz, part, t, _a) => {
    const n1 = paintNoise.fbm(x * 4 + 11, z * 4 + y * 3, 3);
    switch (part) {
      case 'body':
        out.copy(base);
        mix(out, out, grizzle, sstep(-0.1, 0.9, ny) * (0.3 + 0.4 * sstep(-0.3, 0.5, n1)));           // grizzled back
        mix(out, out, dark, sstep(-0.3, -0.8, ny) * 0.85);
        break;
      case 'neck': case 'head':
        out.copy(base);
        mix(out, out, cheek, sstep(0.55, 0.85, t) * sstep(0.3, 0.9, Math.abs(nx)) * 0.75);            // pale cheek whiskers
        mix(out, out, grizzle, sstep(0.2, 0.9, ny) * 0.3);
        mix(out, out, dark, sstep(-0.3, -0.8, ny) * 0.75);
        mix(out, out, black, sstep(0.9, 0.98, t));
        break;
      case 'snout': out.copy(snout); break;
      case 'crest': mix(out, dark, grizzle, sstep(0.0, 0.5, ny) * (0.35 + 0.3 * n1)); break;
      case 'ear': out.copy(dark); mix(out, out, base, sstep(0.1, 0.6, nz) * 0.6); break;
      case 'leg': mix(out, base, dark, sstep(0.45, 0.2, y)); break;
      case 'tail': mix(out, dark, black, sstep(0.6, 1, t)); break;
      case 'tusk': mix(out, tuskRoot, tusk, sstep(0.0, 0.45, t)); break;
      case 'hoof': out.copy(hoof); break;
      case 'eye': out.copy(eye); break;
      default: out.copy(base);
    }
    // Scarback: a pale, ragged old wound across the withers (upper body / crest, z ≈ 0.25..0.55)
    if (hasScar && (part === 'body' || part === 'crest' || part === 'neck') && ny > -0.6) {
      const edge = paintNoise.fbm(x * 9 + 70, z * 7 - 30, 2) * 0.06;
      const band = sstep(0.20, 0.09, Math.abs(z - 0.38 + edge)) * sstep(-0.6, -0.1, ny);   // over the withers, down both shoulders
      const gaps = sstep(-0.7, -0.35, paintNoise.fbm(x * 6 - 15, z * 14 + y * 5, 2));      // broken, not a painted stripe
      mix(out, out, scar, band * gaps);
    }
    let m = 1 + 0.14 * n1;
    if (part === 'body') m *= 1 - 0.35 * sstep(-0.2, -0.9, ny) - 0.25 * sstep(0.25, 0.05, Math.abs(Math.abs(z) - 0.45)) * sstep(0.55, 0.35, y);
    if (part === 'leg') m *= 1 - 0.3 * sstep(0.3, 0.55, y) - 0.2 * sstep(0.15, 0.1, Math.abs(x));
    out.r *= m; out.g *= m; out.b *= m;
  };
}

function buildBoar(v: VariantDef, rng: Rng): AnimalSpecies {
  const tuskScale = Number(v.traits?.['tuskScale'] ?? 1);
  setShag(0.016);
  const bones: BoneDef[] = [
    { name: 'body', parent: null, pos: [0, 0.62, -0.02] },
    { name: 'neck1', parent: 'body', pos: [0, 0.69, 0.55] },
    { name: 'neck2', parent: 'neck1', pos: [0, 0.70, 0.66] },
    { name: 'head', parent: 'neck2', pos: [0, 0.70, 0.78] },
    { name: 'earL', parent: 'head', pos: [0.09, 0.85, 0.82] },
    { name: 'earR', parent: 'head', pos: [-0.09, 0.85, 0.82] },
    { name: 'tail', parent: 'body', pos: [0, 0.71, -0.62] },
    { name: 'belly', parent: 'body', pos: [0, 0.5, 0.0] },
  ];
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    bones.push(
      { name: `F${side}_shoulder`, parent: 'body', pos: [sx * 0.14, 0.58, 0.42] },
      { name: `F${side}_carpus`, parent: `F${side}_shoulder`, pos: [sx * 0.14, 0.30, 0.42] },
      { name: `F${side}_fetlock`, parent: `F${side}_carpus`, pos: [sx * 0.14, 0.10, 0.42] },
      { name: `B${side}_hip`, parent: 'body', pos: [sx * 0.13, 0.58, -0.45] },
      { name: `B${side}_stifle`, parent: `B${side}_hip`, pos: [sx * 0.14, 0.36, -0.36] },
      { name: `B${side}_hock`, parent: `B${side}_stifle`, pos: [sx * 0.14, 0.24, -0.48] },
    );
  }
  const B = boneIndex(bones);
  const lowPoly = isLowPoly();   // a toon level: its own palette (toonPaint), crest = a row of spikes
  const toon = lowPoly ? toonPaint('boar') : null;
  const paint = toon !== null ? toon(v) : boarPaint(v);
  const fur: THREE.BufferGeometry[] = [], hard: THREE.BufferGeometry[] = [], eyes: THREE.BufferGeometry[] = [];
  const body = B('body'), n1 = B('neck1'), n2 = B('neck2'), hd = B('head'), bl = B('belly');
  // torso: barrel with shoulder hump, narrower hips (y is raised 0.07 vs the first draft: legs were too short)
  const Y = 0.07;
  fur.push(loft([
    S(0, 0.55 + Y, -0.64, 0.02, 0.02, body),
    S(0, 0.545 + Y, -0.625, 0.12, 0.16, body),
    S(0, 0.54 + Y, -0.58, 0.19, 0.24, body, body, 0, 1.0, 1.0),
    S(0, 0.54 + Y, -0.48, 0.225, 0.27, body, body, 0, 1.04, 1.0),
    S(0, 0.55 + Y, -0.30, 0.26, 0.32, body, bl, 0.5, 1.06, 1.06),
    S(0, 0.55 + Y, -0.05, 0.275, 0.335, body, bl, 0.7, 1.14, 1.08),
    S(0, 0.56 + Y, 0.18, 0.285, 0.34, body, bl, 0.4, 1.30, 1.06),
    S(0, 0.58 + Y, 0.36, 0.285, 0.34, body, n1, 0.15, 1.38, 1.02),
    S(0, 0.60 + Y, 0.52, 0.26, 0.32, body, n1, 0.5, 1.30, 0.96),
    S(0, 0.62 + Y, 0.66, 0.21, 0.26, n1, n2, 0.5, 1.12, 0.95),
    S(0, 0.625 + Y, 0.78, 0.175, 0.21, n2, hd, 0.6, 1.06, 0.98),
  ], 22, 'body', paint, true, false));
  // head: heavy wedge from the neck to a narrow snout, held low
  fur.push(loft([
    S(0, 0.625 + Y, 0.76, 0.18, 0.215, n2, hd, 0.5, 1.06, 0.98),
    S(0, 0.615 + Y, 0.90, 0.155, 0.185, hd, hd, 0, 1.05, 1.0),
    S(0, 0.585 + Y, 1.02, 0.125, 0.145, hd, hd, 0, 1.0, 1.08),
    S(0, 0.535 + Y, 1.14, 0.095, 0.11, hd, hd, 0, 1.0, 1.12),
    S(0, 0.48 + Y, 1.25, 0.072, 0.082, hd, hd, 0, 1.0, 1.12),
    S(0, 0.44 + Y, 1.33, 0.058, 0.064, hd),
    S(0, 0.425 + Y, 1.37, 0.052, 0.054, hd),
  ], 18, 'head', paint, false, true));
  // snout disc
  hard.push(loft([
    S(0, 0.425 + Y, 1.365, 0.054, 0.056, hd),
    S(0, 0.42 + Y, 1.395, 0.062, 0.064, hd),
    S(0, 0.418 + Y, 1.405, 0.057, 0.059, hd),
    S(0, 0.418 + Y, 1.408, 0.02, 0.02, hd),
  ], 14, 'snout', paint));
  // tusks (lower, curving up and out) — scaled about the root in the jaw by tuskScale
  const tk = tuskScale, trk = tuskScale ** 0.6;
  for (const sx of [1, -1]) {
    const root: [number, number, number] = [sx * 0.05, 0.43 + Y, 1.22];
    const T = (p: [number, number, number]): [number, number, number] => [root[0] + (p[0] - root[0]) * tk, root[1] + (p[1] - root[1]) * tk, root[2] + (p[2] - root[2]) * tk];
    const pts: [number, number, number][] = [[sx * 0.05, 0.43 + Y, 1.22], [sx * 0.078, 0.45 + Y, 1.265], [sx * 0.10, 0.50 + Y, 1.28], [sx * 0.105, 0.55 + Y, 1.275]];
    if (tk > 1.5) pts.push([sx * 0.10, 0.585 + Y, 1.255]);   // big tusks curl back over the snout
    hard.push(tube(pts.map(T), 0.016 * trk, 0.004 * trk, hd, 'tusk', paint, 6));
    const eb = B(sx > 0 ? 'earL' : 'earR');
    fur.push(loft([
      S(sx * 0.08, 0.76 + Y, 0.84, 0.03, 0.015, hd, eb, 0.3),
      S(sx * 0.11, 0.83 + Y, 0.82, 0.05, 0.015, eb),
      S(sx * 0.14, 0.90 + Y, 0.80, 0.045, 0.013, eb),
      S(sx * 0.165, 0.96 + Y, 0.78, 0.025, 0.01, eb),
      S(sx * 0.175, 0.985 + Y, 0.77, 0.008, 0.005, eb),
    ], 10, 'ear', paint, true, true, 'z'));
    const eye = lowPoly ? new THREE.SphereGeometry(0.018, 6, 4) : new THREE.SphereGeometry(0.016, 10, 8);
    eye.translate(sx * 0.115, 0.625 + Y, 0.97);
    eyes.push(skinPlain(eye, hd, 'eye', paint));
  }
  // bristle crest along the spine (a jagged fin), stations rear → front so the ring 'up' is +Y
  const crestSt = [] as ReturnType<typeof S>[];
  const crestPts: [number, number, number, number, number, number][] = [
    // z, y, ry, b0, b1, w1
    [0.86, 0.78, 0.02, hd, hd, 0], [0.74, 0.86, 0.06, n2, hd, 0.5], [0.58, 0.93, 0.09, n1, n2, 0.5], [0.42, 0.985, 0.10, body, n1, 0.4],
    [0.26, 0.965, 0.09, body, body, 0], [0.08, 0.915, 0.075, body, body, 0], [-0.12, 0.875, 0.06, body, body, 0], [-0.32, 0.85, 0.045, body, body, 0], [-0.5, 0.82, 0.025, body, body, 0], [-0.58, 0.80, 0.01, body, body, 0],
  ];
  crestPts.reverse().forEach(([z, y, ry, b0, b1, w1]) => { crestSt.push(S(0, y - 0.04 + Y, z, 0.022, ry * (0.85 + rng.next() * 0.3), b0, b1, w1, 1, 0.3)); });
  if (lowPoly) fur.push(...crestSpikes(crestPts, Y, paint));
  else fur.push(loft(crestSt, 6, 'crest', paint));
  // tail with tuft
  const tl = B('tail');
  fur.push(loft([
    S(0, 0.63 + Y, -0.62, 0.028, 0.028, body, tl, 0.3),
    S(0, 0.52 + Y, -0.69, 0.02, 0.02, tl),
    S(0, 0.40 + Y, -0.72, 0.016, 0.016, tl),
    S(0, 0.33 + Y, -0.73, 0.03, 0.03, tl),
    S(0, 0.27 + Y, -0.735, 0.022, 0.022, tl),
    S(0, 0.24 + Y, -0.74, 0.008, 0.008, tl),
  ], 8, 'tail', paint, false, true));
  // legs
  const feetF: [number, number][] = [], feetB: [number, number][] = [];   // front / back, each L then R
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const sh = B(`F${side}_shoulder`), ca = B(`F${side}_carpus`), fe = B(`F${side}_fetlock`);
    fur.push(loft([
      S(sx * 0.13, 0.66, 0.40, 0.13, 0.19, body, sh, 0.3),
      S(sx * 0.145, 0.50, 0.42, 0.105, 0.15, body, sh, 0.8),
      S(sx * 0.15, 0.37, 0.42, 0.072, 0.095, sh),
      S(sx * 0.15, 0.31, 0.42, 0.054, 0.066, sh, ca, 0.5),
      S(sx * 0.15, 0.22, 0.42, 0.046, 0.056, ca),
      S(sx * 0.15, 0.13, 0.42, 0.045, 0.055, ca, fe, 0.5),
      S(sx * 0.15, 0.07, 0.43, 0.042, 0.052, fe),
    ], 12, 'leg', paint, false, true));
    hard.push(loft([
      S(sx * 0.145, 0.07, 0.43, 0.036, 0.045, fe),
      S(sx * 0.145, 0.035, 0.44, 0.042, 0.052, fe),
      S(sx * 0.145, 0.0, 0.445, 0.038, 0.048, fe),
      S(sx * 0.145, -0.005, 0.445, 0.01, 0.01, fe),
    ], 10, 'hoof', paint));
    feetF.push([sx * 0.145, 0.445]);
    const hp = B(`B${side}_hip`), stf = B(`B${side}_stifle`), hk = B(`B${side}_hock`);
    fur.push(loft([
      S(sx * 0.11, 0.62, -0.50, 0.13, 0.20, body, hp, 0.3),
      S(sx * 0.135, 0.49, -0.43, 0.11, 0.16, body, hp, 0.8),
      S(sx * 0.145, 0.38, -0.38, 0.076, 0.098, hp, stf, 0.5),
      S(sx * 0.15, 0.30, -0.43, 0.056, 0.07, stf),
      S(sx * 0.15, 0.25, -0.475, 0.048, 0.06, stf, hk, 0.5),
      S(sx * 0.15, 0.15, -0.465, 0.045, 0.055, hk),
      S(sx * 0.15, 0.07, -0.45, 0.042, 0.052, hk),
    ], 12, 'leg', paint, false, true));
    hard.push(loft([
      S(sx * 0.145, 0.07, -0.45, 0.036, 0.045, hk),
      S(sx * 0.145, 0.035, -0.445, 0.042, 0.052, hk),
      S(sx * 0.145, 0.0, -0.44, 0.038, 0.048, hk),
      S(sx * 0.145, -0.005, -0.44, 0.01, 0.01, hk),
    ], 10, 'hoof', paint));
    feetB.push([sx * 0.145, -0.44]);
  }
  setShag(0);
  const feetOrdered: [number, number][] = [...feetF, ...feetB];
  return {
    bones, furParts: fur, hardParts: hard, eyeParts: eyes,
    dims: { bodyY: 0.62, bodyHalfLen: 0.65, bodyRadius: 0.33, headRadius: 0.2, legLen: 0.58, feet: feetOrdered, halfWidth: 0.29 },
  };
}

export const BOAR_LOOK: SpeciesLook = {
  rigContract: { skeleton: 'boar.v1', clips: [], sockets: ['body', 'head'] },
  id: 'kit.look.boar', species: 'kit.creature.boar', kind: 'boar',
  fur: {
    texSeed: 202, tex: { contrast: 1.0, grizzle: 0.6, normalStrength: 2.2, bristle: 0.6, strandLen: 12, root: 0.24 },
    roughness: 0.88, sheen: 0.15, sheenColor: [0.35, 0.3, 0.24], envMapIntensity: 0.9, rim: [0.9, 0.7, 0.45], shellLen: 0.065, shag: 0.016,
  },
  pose: { grazeNeck: 0.3, gallopTail: 0.5 },
  variants: {
    sow: { traits: { tuskScale: 0.6 } }, black: { tint: BLACK_TINT, traits: { tuskScale: 1.6 } },
    big: { traits: { tuskScale: 1.3 } }, scarback: { tint: SCARBACK_TINT, traits: { tuskScale: 1.8, scar: 1 } },
    ironhide: { tint: IRONHIDE_TINT, traits: { tuskScale: 2.2 }, fur: { rim: [0.75, 0.78, 0.85], sheenColor: [0.4, 0.42, 0.46] } },
  },
  build: buildBoar,
};
