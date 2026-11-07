/**
 * The interactables' props (E405 E417: content, the kit's; moved from the engine, which keeps the runtime and asks for
 * these through `registerInteractProps`, installed by `installKitProps`). Every part is a non-indexed, vertex-coloured,
 * flat-normal geometry built with LowPolyKit (@wildshard/engine) in a local frame: origin on the floor under the part's pivot,
 * +Z = the front, +Y up. The runtime (src/client/engine/world/interact/Interactables.ts) adds each geometry once to one of two BatchedMeshes (lit: the shared
 * `lowPolyMaterial`; glow: unlit, for keys, flames and the pickups content registers) and poses instances.
 *
 * Moving parts carry their pivot at the origin: a chest lid hinges about +X at its back edge, a lever handle about +X
 * at its root, a plank door about +Y at its hinge edge, a grate / sluice slides along +Y.
 */
import * as THREE from 'three';
import { log, beam, plank, rock, rope } from '@wildshard/engine/world/geometryKit';
import type { ChestDims } from '@wildshard/engine/world/interact/types';
import { LowPolyKit } from '@wildshard/engine/world/lowpolyKit';

const C = {
  wood: '#8a6440', woodDark: '#5f432a', woodLight: '#a88157', iron: '#3b3d42', ironLight: '#62656d', brass: '#d8a640',
  stone: '#8d8f94', stoneDark: '#62656b', moss: '#5c8f3c', rope: '#b9a57a', gold: '#f2c44d', red: '#a83a2a',
  sand: '#cdb58a', ember: '#ff9a3a', flame: '#ffcf6a', glass: '#6fe0c8', char: '#2d2622',
};

const M = new THREE.Matrix4();
const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 =>
  M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function done(kit: LowPolyKit, ao: boolean, floorY = 0): THREE.BufferGeometry {
  return kit.finish(ao ? { ao: { floorY, strength: 0.5 } } : { ao: false });
}

// ── chests ───────────────────────────────────────────────────────────────────────────────────────

export const CHEST_DIMS: Record<'chest' | 'strongbox' | 'treasure', ChestDims> = {
  chest: { w: 0.92, d: 0.56, h: 0.42, lidH: 0.2 },
  treasure: { w: 0.8, d: 0.5, h: 0.38, lidH: 0.2 },
  strongbox: { w: 0.62, d: 0.42, h: 0.34, lidH: 0.1 },
};

/** the body: planks (or iron plates) with bands, feet, a hasp; `locked` adds a padlock */
export function chestBase(look: 'chest' | 'strongbox' | 'treasure', seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed), D = CHEST_DIMS[look], { w, d, h } = D;
  const body = look === 'strongbox' ? C.ironLight : look === 'treasure' ? C.woodDark : C.wood;
  const band = look === 'treasure' ? C.gold : C.iron;
  if (look === 'strongbox') k.add(new THREE.BoxGeometry(w, h, d), body, { matrix: at(0, h / 2, 0), jitter: 0.05 });
  else for (let i = 0; i < 4; i++) k.add(plank(w, d, h / 4 - 0.008, k.rng, 0.008), i % 2 ? body : C.woodLight, { matrix: at(0, h / 8 + (i * h) / 4, 0) });
  for (const x of [-w * 0.34, w * 0.34]) {
    k.add(new THREE.BoxGeometry(0.06, h + 0.01, d + 0.02), band, { matrix: at(x, h / 2, 0) });
  }
  k.add(new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02), band, { matrix: at(0, 0.02, 0) });
  // hasp + padlock on the front
  k.add(new THREE.BoxGeometry(0.1, 0.12, 0.03), look === 'treasure' ? C.gold : C.ironLight, { matrix: at(0, h - 0.07, d / 2 + 0.015) });
  for (const [x, z] of [[-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [-w / 2 + 0.06, d / 2 - 0.06], [w / 2 - 0.06, d / 2 - 0.06]] as const) {
    k.add(new THREE.BoxGeometry(0.08, 0.04, 0.08), C.iron, { matrix: at(x, -0.0, z) });
  }
  return done(k, true);
}
/** a padlock (its own part so it can vanish when unlocked) */
export function padlock(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.BoxGeometry(0.1, 0.09, 0.04), C.brass, { matrix: at(0, 0, 0) });
  k.add(new THREE.TorusGeometry(0.035, 0.011, 4, 8, Math.PI), C.ironLight, { matrix: at(0, 0.045, 0) });
  return done(k, false);
}
/** the lid, hinge at the origin along X, closed pose extends toward +Z */
export function chestLid(look: 'chest' | 'strongbox' | 'treasure', seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed), D = CHEST_DIMS[look], { w, d, lidH } = D;
  const band = look === 'treasure' ? C.gold : C.iron;
  if (look === 'strongbox') {
    k.add(new THREE.BoxGeometry(w + 0.02, lidH, d + 0.02), C.ironLight, { matrix: at(0, lidH / 2, d / 2) });
  } else {
    // a barrel-vault lid: half of a 6-sided prism, lying along X
    const vault = new THREE.CylinderGeometry(d / 2, d / 2, w, 6, 1, false, 0, Math.PI);
    vault.rotateZ(Math.PI / 2);
    vault.scale(1, lidH / (d / 2), 1);
    k.add(vault, look === 'treasure' ? C.red : C.woodLight, { matrix: at(0, 0, d / 2), jitter: 0.08 });
    for (const x of [-w * 0.34, w * 0.34]) {
      const b = new THREE.CylinderGeometry(d / 2 + 0.012, d / 2 + 0.012, 0.065, 6, 1, false, 0, Math.PI);
      b.rotateZ(Math.PI / 2); b.scale(1, lidH / (d / 2), 1);
      k.add(b, band, { matrix: at(x, 0, d / 2) });
    }
  }
  k.add(new THREE.BoxGeometry(0.08, 0.1, 0.03), band, { matrix: at(0, 0.0, d + 0.012) });
  return done(k, false);
}
/** the loot glint inside an open chest (glow batch) */
export function chestGlint(look: 'chest' | 'strongbox' | 'treasure', seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed), D = CHEST_DIMS[look];
  for (let i = 0; i < 7; i++) {
    const x = k.rng.range(-D.w * 0.35, D.w * 0.35), z = k.rng.range(-D.d * 0.3, D.d * 0.3);
    k.add(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 6), C.gold, { matrix: at(x, D.h - 0.03 + k.rng.range(0, 0.03), z, 0, k.rng.range(-0.4, 0.4), k.rng.range(-0.4, 0.4)) });
  }
  return done(k, false);
}

// ── keys / pickups (glow batch unless noted) ───────────────────────────────────────────────────────

export function keyModel(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.TorusGeometry(0.06, 0.018, 4, 8), C.gold, { matrix: at(0, 0.2, 0) });
  k.add(log(V(0, 0.14, 0), V(0, -0.12, 0), 0.016, 0.016, 5), C.gold);
  k.add(new THREE.BoxGeometry(0.06, 0.028, 0.02), C.gold, { matrix: at(0.03, -0.1, 0) });
  k.add(new THREE.BoxGeometry(0.045, 0.024, 0.02), C.gold, { matrix: at(0.024, -0.05, 0) });
  return done(k, false);
}


// ── doors ────────────────────────────────────────────────────────────────────────────────────────

/** the frame (static, lit): posts + lintel for plank / grate, a stone cheek + lintel for the sluice */
export function doorFrame(look: 'plank' | 'grate' | 'sluice', w: number, h: number, seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  if (look === 'sluice') {
    for (const s of [-1, 1]) k.add(rock(0.5, 1, k.rng, 1, 0.12), C.stoneDark, { matrix: new THREE.Matrix4().compose(V(s * (w / 2 + 0.32), h / 2, 0), new THREE.Quaternion(), V(0.75, (h + 0.5) / 1.0, 0.8)) });
    k.add(beam(V(-w / 2 - 0.6, h + 0.25, 0), V(w / 2 + 0.6, h + 0.25, 0), 0.4, 0.5), C.stone, { wobble: 0.03 });
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.1, h, 0.26), C.iron, { matrix: at(s * (w / 2 + 0.03), h / 2, 0) }); // the guide channels
  } else {
    for (const s of [-1, 1]) k.add(log(V(s * (w / 2 + 0.1), -0.05, 0), V(s * (w / 2 + 0.1), h + 0.12, 0), 0.11, 0.1), C.woodDark);
    k.add(beam(V(-w / 2 - 0.25, h + 0.1, 0), V(w / 2 + 0.25, h + 0.1, 0), 0.18, 0.22), C.woodDark, { wobble: 0.01 });
  }
  return done(k, true);
}
/** the moving panel. plank: hinge at the origin (left edge), panel toward +X. grate / sluice: centred, bottom at y 0 */
export function doorPanel(look: 'plank' | 'grate' | 'sluice', w: number, h: number, seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  if (look === 'plank') {
    const n = Math.max(3, Math.round(w / 0.2)), pw = w / n;
    for (let i = 0; i < n; i++) k.add(new THREE.BoxGeometry(pw - 0.01, h - 0.02, 0.06), i % 2 ? C.wood : C.woodLight, { matrix: at(pw * (i + 0.5), h / 2, 0), wobble: 0.008 });
    for (const y of [0.3, h - 0.3]) k.add(new THREE.BoxGeometry(w - 0.06, 0.12, 0.03), C.woodDark, { matrix: at(w / 2, y, -0.045) });
    k.add(new THREE.TorusGeometry(0.05, 0.012, 4, 8), C.iron, { matrix: at(w - 0.14, h * 0.48, 0.05) });
  } else if (look === 'grate') {
    const n = Math.max(3, Math.round(w / 0.16));
    for (let i = 0; i <= n; i++) { const x = -w / 2 + (i * w) / n; k.add(log(V(x, 0, 0), V(x, h, 0), 0.022, 0.022, 5), C.iron); }
    for (const y of [0.12, h * 0.5, h - 0.1]) k.add(new THREE.BoxGeometry(w + 0.04, 0.05, 0.05), C.ironLight, { matrix: at(0, y, 0) });
    k.add(new THREE.BoxGeometry(0.12, 0.14, 0.07), C.brass, { matrix: at(w * 0.3, h * 0.5, 0.05) }); // the lock box
  } else {
    const n = Math.max(3, Math.round(h / 0.28));
    for (let i = 0; i < n; i++) k.add(plank(w + 0.1, (h / n) - 0.012, 0.14, k.rng, 0.012), i % 2 ? C.woodDark : C.wood, { matrix: at(0, (h / n) * (i + 0.5), 0, 0, Math.PI / 2, 0) });
    for (const x of [-w * 0.3, w * 0.3]) k.add(new THREE.BoxGeometry(0.08, h, 0.18), C.iron, { matrix: at(x, h / 2, 0) });
    k.add(rope([V(0, h, 0), V(0, h + 0.6, 0)], 0.03), C.rope);
  }
  return done(k, false);
}

// ── lever / plate / barrel ───────────────────────────────────────────────────────────────────────

export function leverBase(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.BoxGeometry(0.42, 0.32, 0.32), C.woodDark, { matrix: at(0, 0.16, 0), wobble: 0.01 });
  k.add(new THREE.BoxGeometry(0.1, 0.05, 0.26), C.char, { matrix: at(0, 0.33, 0) }); // the slot
  for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.03, 0.14, 0.14), C.iron, { matrix: at(s * 0.08, 0.36, 0) });
  return done(k, true);
}
/** handle: root at the origin, pointing +Y (the runtime tilts it about X: forward = off, back = on) */
export function leverHandle(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(log(V(0, 0, 0), V(0, 0.62, 0), 0.028, 0.022, 6), C.iron);
  k.add(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 7).rotateZ(Math.PI / 2), C.red, { matrix: at(0, 0.64, 0) });
  k.add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6).rotateZ(Math.PI / 2), C.ironLight, { matrix: at(0, 0, 0) });
  return done(k, false);
}
export function plateRim(size: number, seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed), s = size / 2 + 0.09;
  for (const [x, z, w, d] of [[0, s, size + 0.36, 0.18], [0, -s, size + 0.36, 0.18], [s, 0, 0.18, size], [-s, 0, 0.18, size]] as const) {
    k.add(new THREE.BoxGeometry(w, 0.16, d), C.stoneDark, { matrix: at(x, 0.02, z), wobble: 0.015 });
  }
  return done(k, true);
}
/** the slab (top at y 0.07) with a carved wave glyph */
export function plateSlab(size: number, seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.BoxGeometry(size, 0.12, size), C.stone, { matrix: at(0, 0.01, 0), jitter: 0.04 });
  for (let i = 0; i < 3; i++) k.add(new THREE.BoxGeometry(size * 0.55, 0.012, 0.05), '#4ec6e8', { matrix: at(0, 0.072, (i - 1) * size * 0.2, 0.25 * (i - 1)) });
  return done(k, false);
}
export function barrel(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  const g = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10, 4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), b = 1 + 0.14 * (1 - (y / 0.475) ** 2); p.setX(i, p.getX(i) * b); p.setZ(i, p.getZ(i) * b); }
  k.add(g, C.wood, { matrix: at(0, 0.475, 0), jitter: 0.1 });
  for (const y of [0.12, 0.83]) k.add(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 10, 1, true), C.iron, { matrix: at(0, y, 0) });
  for (const y of [0.36, 0.59]) k.add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10, 1, true), C.iron, { matrix: at(0, y, 0) });
  return done(k, false);
}

// ── beacon / bench / altar ───────────────────────────────────────────────────────────────────────

/** the brazier: a faceted iron bowl on three legs, a stack of dry logs in it (unlit) */
export function brazier(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; k.add(log(V(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5), V(Math.cos(a) * 0.3, 0.8, Math.sin(a) * 0.3), 0.04, 0.035, 5), C.iron); }
  const bowl = new THREE.CylinderGeometry(0.55, 0.3, 0.32, 8, 1, true);
  k.add(bowl, C.iron, { matrix: at(0, 0.92, 0) });
  k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8), C.char, { matrix: at(0, 0.78, 0) });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; k.add(log(V(Math.cos(a) * 0.35, 0.82, Math.sin(a) * 0.35), V(-Math.cos(a) * 0.05, 1.25, -Math.sin(a) * 0.05), 0.05, 0.04, 5), i % 2 ? C.woodDark : C.wood); }
  return done(k, true);
}
/** flames (glow batch): three tongues, origin at the bowl */
export function flame(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  // a ring of leaning ember-red tongues, a taller orange body, a pale core: reads as fire, not a cone, from any side
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, h = 0.55 + (i % 3) * 0.18, r = 0.3;
    k.add(new THREE.ConeGeometry(0.13, h, 4), i % 2 ? C.ember : '#ff6a1e', { matrix: at(Math.cos(a) * r, h / 2 - 0.02, Math.sin(a) * r, a, 0, 0).multiply(new THREE.Matrix4().makeRotationX(Math.sin(a) * 0.35)).multiply(new THREE.Matrix4().makeRotationZ(-Math.cos(a) * 0.35)), wobble: 0.02, jitter: 0.12 });
  }
  k.add(new THREE.ConeGeometry(0.28, 1.25, 6), C.flame, { matrix: at(0, 0.62, 0), wobble: 0.05, jitter: 0.1 });
  k.add(new THREE.ConeGeometry(0.16, 0.95, 5), '#ffb13a', { matrix: at(0.1, 0.52, -0.05, 0.7), wobble: 0.03 });
  k.add(new THREE.ConeGeometry(0.1, 0.8, 5), '#fff1b8', { matrix: at(0, 0.42, 0), wobble: 0.02 });
  return done(k, false);
}
export function bench(seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  for (const x of [-0.7, 0.7]) for (const z of [-0.14, 0.14]) k.add(log(V(x, 0, z), V(x, 0.44, z), 0.05, 0.045, 5), C.woodDark);
  for (let i = 0; i < 3; i++) k.add(plank(1.8, 0.14, 0.05, k.rng, 0.01), i % 2 ? C.woodLight : C.wood, { matrix: at(0, 0.46, (i - 1) * 0.15) });
  for (const x of [-0.7, 0.7]) k.add(log(V(x, 0.44, -0.2), V(x, 0.9, -0.3), 0.04, 0.035, 5), C.woodDark);
  for (let i = 0; i < 2; i++) k.add(plank(1.8, 0.12, 0.045, k.rng, 0.01), C.wood, { matrix: at(0, 0.64 + i * 0.18, -0.25 - i * 0.03, 0, -0.2) });
  return done(k, true);
}
/** the shard altar: a mossy stone plinth with `n` sockets on its top */
export function altar(n: number, seed: number): THREE.BufferGeometry {
  const k = new LowPolyKit(seed);
  k.add(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 8), C.stoneDark, { matrix: at(0, 0.15, 0), wobble: 0.02 });
  k.add(new THREE.CylinderGeometry(0.5, 0.62, 0.7, 8), C.stone, { matrix: at(0, 0.65, 0), wobble: 0.02 });
  k.add(new THREE.CylinderGeometry(0.72, 0.6, 0.16, 8), C.stone, { matrix: at(0, 1.08, 0), wobble: 0.02 });
  k.add(new THREE.CylinderGeometry(0.74, 0.74, 0.03, 8), C.moss, { matrix: at(0, 1.17, 0) });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    k.add(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 6), C.char, { matrix: at(Math.cos(a) * 0.4, 1.2, Math.sin(a) * 0.4) });
  }
  return done(k, true);
}
/** where socket i of an n-socket altar sits (altar-local) */
export function altarSocket(i: number, n: number): { x: number; y: number; z: number } {
  const a = (i / n) * Math.PI * 2 + Math.PI / 2;
  return { x: Math.cos(a) * 0.4, y: 1.45, z: Math.sin(a) * 0.4 };
}
