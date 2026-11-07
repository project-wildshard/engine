import * as THREE from 'three';
import { rock } from '@wildshard/engine/world/geometryKit';
import { LowPolyKit } from '@wildshard/engine/world/lowpolyKit';

const M = new THREE.Matrix4();
const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 =>
  M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const done = (kit: LowPolyKit): THREE.BufferGeometry => kit.finish({ ao: false });

/** Original pickup builders, retained only for offline exact-byte bakes. */
const SEED = 0x1a7e;

export function seaGlassGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(rock(0.12, 0, k.rng, 0.6, 0.35), '#ffffff', { jitter: 0.25 });
  return done(k);
}

export function glyphShardGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  const g = new THREE.OctahedronGeometry(0.16, 0);
  g.scale(0.7, 2.1, 0.45);
  k.add(g, '#8fe8ff', { jitter: 0.18, wobble: 0.015 });
  k.add(new THREE.OctahedronGeometry(0.06, 0), '#ffffff', { matrix: at(0.1, -0.16, 0.03, 0.4, 0, 0.3), jitter: 0.1 });
  return done(k);
}

/** flint + steel striker on a scrap of leather — lit batch */
export function flintKitGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.CylinderGeometry(0.14, 0.15, 0.015, 7), '#6e4629', { matrix: at(0, 0.008, 0) });
  k.add(rock(0.055, 0, k.rng, 0.7, 0.3), '#7b7f86', { matrix: at(-0.04, 0.05, 0) });
  k.add(new THREE.TorusGeometry(0.04, 0.01, 4, 8, Math.PI * 1.4), '#62656d', { matrix: at(0.06, 0.03, 0, 0, Math.PI / 2, 0) });
  return done(k);
}

/** an amber resin drop — glow batch: a bead of amber weeping down a trunk, a smaller drip under it */
export function resinDropGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  const bead = new THREE.IcosahedronGeometry(0.075, 1); bead.scale(0.85, 1.35, 0.7);
  k.add(bead, '#ffb23a', { matrix: at(0, 0.02, 0), jitter: 0.12 });
  const drip = new THREE.IcosahedronGeometry(0.04, 0); drip.scale(0.8, 1.5, 0.8);
  k.add(drip, '#ff9a1f', { matrix: at(0.012, -0.1, 0.01), jitter: 0.1 });
  k.add(new THREE.OctahedronGeometry(0.03, 0), '#ffe08a', { matrix: at(-0.03, 0.07, 0.035), jitter: 0.1 });
  return done(k);
}

/** a carved wooden token — lit batch: a wooden disc on edge, a burnt antler glyph on both faces, a bark rim */
export function carvedTokenGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.CylinderGeometry(0.15, 0.15, 0.036, 12).rotateX(Math.PI / 2), '#a88157', { jitter: 0.04 });
  k.add(new THREE.TorusGeometry(0.15, 0.014, 4, 12), '#5f432a');
  for (const z of [-0.02, 0.02]) {
    k.add(new THREE.BoxGeometry(0.018, 0.16, 0.006), '#2d2622', { matrix: at(0, -0.01, z) });
    for (const s of [-1, 1]) {
      k.add(new THREE.BoxGeometry(0.014, 0.08, 0.006), '#2d2622', { matrix: at(s * 0.035, 0.07, z, 0, 0, s * -0.7) });
      k.add(new THREE.BoxGeometry(0.012, 0.05, 0.006), '#2d2622', { matrix: at(s * 0.03, 0.02, z, 0, 0, s * -1.1) });
    }
  }
  return done(k);
}

/** the token's faint ember rim (glow batch), so a token reads at a few metres in the undergrowth */
export function tokenRimGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.TorusGeometry(0.168, 0.006, 3, 16), '#ffb060');
  return done(k);
}

export function coinGeometry(seed: number = SEED): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.014, 8).rotateX(Math.PI / 2), '#f2c44d', { jitter: 0.1 });
  return done(k);
}

/** Original part order, specimen heights and animation laws; no page imports this module. */
export const authoredPickups: readonly [{ readonly id: "flint"; readonly model: "shared/flint-kit"; readonly name: "Flint & steel"; readonly batch: "lit"; readonly lift: 0; readonly parts: readonly [{ readonly key: "flint"; readonly batch: "lit"; readonly geometry: (seed?: number) => THREE.BufferGeometry; }]; }, { readonly id: "seaglass"; readonly model: "shared/sea-glass"; readonly name: "Sea glass"; readonly batch: "glow"; readonly lift: 0.45; readonly parts: readonly [{ readonly key: "seaglass"; readonly batch: "glow"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [0.45, 0.07, 1.1]; readonly pulse: 2.2; }]; }, { readonly id: "coin"; readonly model: "shared/doubloon"; readonly name: "Doubloon"; readonly batch: "glow"; readonly lift: 0.6; readonly parts: readonly [{ readonly key: "coin"; readonly batch: "glow"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [0.6, 0.06, 2.4]; readonly pulse: 1.4; }]; }, { readonly id: "resin"; readonly model: "shared/resin-drop"; readonly name: "Resin drop"; readonly batch: "glow"; readonly lift: 0; readonly parts: readonly [{ readonly key: "resin"; readonly batch: "glow"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [0, 0.025, 0.35]; readonly pulse: 1.25; }]; }, { readonly id: "token"; readonly model: "shared/carved-token"; readonly name: "Carved token"; readonly batch: "lit"; readonly lift: 0.55; readonly parts: readonly [{ readonly key: "token"; readonly batch: "lit"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [0.55, 0.05, 1.3]; }, { readonly key: "token-rim"; readonly batch: "glow"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [0.55, 0.05, 1.3]; readonly pulse: 0.9; }]; }, { readonly id: "shard"; readonly model: "shared/glyph-shard"; readonly name: "Glyph shard"; readonly batch: "glow"; readonly lift: 1.2; readonly parts: readonly [{ readonly key: "shard"; readonly batch: "glow"; readonly geometry: (seed?: number) => THREE.BufferGeometry; readonly bob: readonly [1.2, 0.12, 0.9]; readonly pulse: 2.2; }]; }] = [
  { id: 'flint', model: 'shared/flint-kit', name: 'Flint & steel', batch: 'lit', lift: 0,
    parts: [{ key: 'flint', batch: 'lit', geometry: flintKitGeometry }] },
  { id: 'seaglass', model: 'shared/sea-glass', name: 'Sea glass', batch: 'glow', lift: 0.45,
    parts: [{ key: 'seaglass', batch: 'glow', geometry: seaGlassGeometry, bob: [0.45, 0.07, 1.1], pulse: 2.2 }] },
  { id: 'coin', model: 'shared/doubloon', name: 'Doubloon', batch: 'glow', lift: 0.6,
    parts: [{ key: 'coin', batch: 'glow', geometry: coinGeometry, bob: [0.6, 0.06, 2.4], pulse: 1.4 }] },
  { id: 'resin', model: 'shared/resin-drop', name: 'Resin drop', batch: 'glow', lift: 0,
    parts: [{ key: 'resin', batch: 'glow', geometry: resinDropGeometry, bob: [0, 0.025, 0.35], pulse: 1.25 }] },
  { id: 'token', model: 'shared/carved-token', name: 'Carved token', batch: 'lit', lift: 0.55, parts: [
    { key: 'token', batch: 'lit', geometry: carvedTokenGeometry, bob: [0.55, 0.05, 1.3] },
    { key: 'token-rim', batch: 'glow', geometry: tokenRimGeometry, bob: [0.55, 0.05, 1.3], pulse: 0.9 },
  ] },
  { id: 'shard', model: 'shared/glyph-shard', name: 'Glyph shard', batch: 'glow', lift: 1.2,
    parts: [{ key: 'shard', batch: 'glow', geometry: glyphShardGeometry, bob: [1.2, 0.12, 0.9], pulse: 2.2 }] },
] as const;
