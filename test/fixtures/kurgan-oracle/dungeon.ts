import { app } from '@wildshard/engine/app/runtime';
import type { RngPort as Rng } from '@wildshard/engine/core/rng';
import { fxMaterial, annulus, FX, type FxMaterial } from '@wildshard/engine/fx/groundFx';
import type { BoxSpec as Collider } from '@wildshard/engine/physics/box';
import { HeightPatch } from '@wildshard/engine/physics/heightPatch';
import type { Material } from '@wildshard/engine/physics/surface';
import { boxDesc, type ColliderDesc, type WorldRegistry } from '@wildshard/engine/world/registry';
/**
 * KurganDungeon — the INSIDE of the great kurgan (plan row B13; design docs/design/nalati/elites-and-bosses.md §2 "The Golden
 * King fight"; mockups art/nalati-grasslands/round-2/5-bosses/boss-1…4). A timber-lined dromos (the entrance corridor, the
 * fight's checkpoint) with dormant balbals in niches and gold offerings, opening into a 20 × 20 m burial chamber of
 * massive larch logs: a shaft of daylight through the looter's hole in the roof falls on the hollowed-larch log coffin,
 * braziers burn in the corners, felt hangings with horses on the walls, red felt rugs, and gold everywhere.
 *
 * WHERE IT IS. The mound is terrain (B0's landscape), and the player can never stand below the terrain (Player.groundAt
 * is max(terrain, platforms)), so the chamber cannot physically sit under the mound. It is a SEALED INTERIOR VOLUME
 * built high over flat plateau east of the kurgan field (`DUNGEON` below: floor at y 140, over (−40, −95) where the
 * ground is flat to ±1 m, so the animals' terrain tilt stays nil), shown only while the player is inside. The
 * POI agent's doorway (`KurganField` → `pois.kurganEntrance`) is the way in: walk into its dark passage and the screen
 * fades through black into the dromos; walk back out of the dromos and you are on the mound's flank again. While you are
 * inside, `inside` is true — the fight hides the outdoor world and calms the steppe's animals (they only see x / z).
 *
 * LIGHT. Everything static is ONE merged mesh with its light BAKED into the vertex colours (the braziers' warm pools,
 * the daylight shaft on the coffin, the dark corners) and drawn unlit (`MeshBasicMaterial`, vertex colours, no fog, no
 * shadows): the chamber is sealed, so the sun's direction means nothing in here, and a phone skips the shadow-map taps
 * for every interior pixel. That is the painterly look done by hand, like the POIs' baked contact shade. The King, the
 * balbals and your weapon stay on the painterly material (the sun's cel light + rim) — they read as lit figures.
 *
 * FX. Every moving light effect (the light shafts, the flames, the gold rings, the sand streams and the seal curtain,
 * the shield dome, the sun beam, the floor tells) is one `ShaderMaterial` program (`fxMaterial(mode)`: a per-material
 * uniform picks the look), additive or alpha-blended per material.
 *
 *   const dungeon = new KurganDungeon().build();
 *   scene.add(dungeon.group);  dungeon.register(app.registry);   // NALATI-MERGE P1: walls, floor slabs, plinth, beams,
 *                                                                   // the seal (a follows piece) and the sand (a HeightPatch)
 *   dungeon.update(dt, t, player.position);
 *   dungeon.local(p) → { x, y, z }  chamber-local (origin = chamber floor centre, +z = north toward the dromos)
 *   dungeon.world(lx, ly, lz, out)  the other way
 *   dungeon.inChamber(p) / inDromos(p) / inside
 *   dungeon.setSealed(on)            the sand pouring over the chamber door (and a collider in it)
 *   dungeon.setLid(open 0..1)        the coffin lid grinding aside
 *   dungeon.niches[i] / setNicheStatue(i, on)   the four wall niches the balbal adds step out of
 *   dungeon.setShaft(i, strength)    0 = the looter's-hole shaft on the coffin, 1 = the pedestal shaft (victory)
 *   dungeon.rings / streams / beam / dome / arc   hazard visuals the fight drives (see each)
 *   dungeon.sandAt(lx, lz) / addSand(lx, lz, r, dh)   the phase-II drifts (walkable: a heightfield rebuilt as they grow)
 *   dungeon.showHeap(on)             the heap of gold plaques the King crumbles into
 */
import * as THREE from 'three';
import { PaintKit, M, v3 } from '../../../src/shards/nalati-grasslands/generators/paint';
import { pole, blob, lathe } from '../../../src/shards/nalati-grasslands/generators/smoothGeometry';
import { balbalGeometry } from '../../../src/shards/nalati-grasslands/generators/places';

/** where the interior lives (world): the chamber floor centre. Flat plateau under it (see the header). */
export const DUNGEON = { x: -40, y: 140, z: -95 };
/** chamber half size (m): 20 × 20 */
export const CH = 10;
/** the sand-drift grid over the chamber floor (cells per side) */
const SAND_N = 40;
/** chamber wall / ceiling heights */
const WALL_H = 5.3, BEAM_Y = 5.45, PLANK_Y = 5.95;
/** the dromos: from the chamber's north door (z = CH) out to its far end (z = DROMOS_END), half width, height */
export const DROMOS_END = 22.5;
const DW = 1.5, DH = 3.0, DOOR_W = 1.35, DOOR_H = 2.9;
/** where you appear coming in (and respawn after a death: the checkpoint), facing into the chamber (−z) */
export const DROMOS_SPAWN = { x: 0, z: 20.3, yaw: 0 };
export const CHECKPOINT = { x: 0, z: 15.5, yaw: 0 };
/** the coffin (on its plinth, long axis along z) and the pedestal the reward appears on */
export const COFFIN = { x: 0, z: -0.6, plinthH: 0.45, len: 3.2, wid: 1.3, h: 0.85 };
export const PEDESTAL = { x: 0, z: -8.3, h: 0.95 };
/** the wall niches the balbal adds step out of: local centre (in the wall plane) + the yaw they step out along */
export const NICHES = [
  { x: -CH + 0.2, z: 4.6, yaw: Math.PI / 2 }, { x: CH - 0.2, z: 4.6, yaw: -Math.PI / 2 },
  { x: -CH + 0.2, z: -4.2, yaw: Math.PI / 2 }, { x: CH - 0.2, z: -4.2, yaw: -Math.PI / 2 },
];
/** the places sand pours through the ceiling in phase II (local x, z) */
export const STREAMS: { x: number; z: number }[] = [
  { x: -5.2, z: 3.4 }, { x: 4.8, z: 4.6 }, { x: -3.6, z: -5.0 }, { x: 5.6, z: -3.2 },
  { x: -7.0, z: -0.6 }, { x: 1.8, z: 6.6 }, { x: 7.2, z: 1.2 }, { x: -1.6, z: -6.8 },
];
/** the fallen roof beams (high ground in the sand): local ends a → b, radius */
const FALLEN = [
  { a: [-7.4, -2.8], b: [-3.8, -0.4], r: 0.32 },
  { a: [3.6, 2.2], b: [7.2, 4.4], r: 0.3 },
] as const;


const C = {
  larch: new THREE.Color('#6f5238'), larchDark: new THREE.Color('#4c3826'), larchOld: new THREE.Color('#6b5f52'),
  board: new THREE.Color('#5c4430'), boardDust: new THREE.Color('#7d6a52'),
  earth: new THREE.Color('#4a3524'), black: new THREE.Color('#0c0806'),
  felt: new THREE.Color('#8a2619'), feltDark: new THREE.Color('#4f150e'), cream: new THREE.Color('#e2cfa0'), ochre: new THREE.Color('#b0843e'),
  gold: new THREE.Color('#f2c14e'), goldDark: new THREE.Color('#9a6a1c'), bronze: new THREE.Color('#8a5a2a'),
  stone: new THREE.Color('#8f8b83'), fur: new THREE.Color('#cfc3ad'), sand: new THREE.Color('#a88c62'),
  day: new THREE.Color('#9fb4c8'),
};

// ─────────────────────────────── the FX program ───────────────────────────────

// ─────────────────────────────── motifs ───────────────────────────────

const inEll = (u: number, v: number, cx: number, cy: number, rx: number, ry: number, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot), dx = u - cx, dy = v - cy;
  const x = dx * c + dy * s, y = -dx * s + dy * c;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
};
/** a galloping felt-appliqué horse (Pazyryk style) in the unit square, facing left: true inside the figure */
export function horseMask(u: number, v: number): boolean {
  if (inEll(u, v, 0.52, 0.52, 0.25, 0.12, 0.05)) return true;                 // barrel
  if (inEll(u, v, 0.28, 0.64, 0.07, 0.17, -0.55)) return true;                // neck
  if (inEll(u, v, 0.15, 0.78, 0.1, 0.05, 0.55)) return true;                  // head
  if (inEll(u, v, 0.3, 0.84, 0.03, 0.05, -0.3)) return true;                  // ear / mane crest
  if (inEll(u, v, 0.82, 0.55, 0.12, 0.03, -0.55)) return true;                // tail
  if (inEll(u, v, 0.3, 0.33, 0.035, 0.16, 0.55)) return true;                 // foreleg, stretched forward
  if (inEll(u, v, 0.4, 0.3, 0.03, 0.15, -0.2)) return true;                   // foreleg under
  if (inEll(u, v, 0.66, 0.31, 0.035, 0.16, 0.25)) return true;                // hind leg under
  if (inEll(u, v, 0.78, 0.33, 0.03, 0.17, -0.65)) return true;                // hind leg, kicked back
  return false;
}
/** a felt panel: red ground, a cream border with a running diamond, `horses` horses along it */
function feltPainter(w: number, h: number, horses: number, horizontal: boolean): (p: THREE.Vector3) => THREE.Color {
  const out = new THREE.Color();
  return (p) => {
    const u = p.x / w + 0.5, v = p.y / h + 0.5;
    const bu = Math.min(u, 1 - u) * w, bv = Math.min(v, 1 - v) * h, b = Math.min(bu, bv);
    if (b < 0.05) return out.copy(C.feltDark);
    if (b < 0.16) {
      // the border: a cream band with red diamonds
      const along = bu < bv ? v * h : u * w;
      const across = (b - 0.05) / 0.11;
      const dmd = Math.abs(((along * 5) % 1) - 0.5) + Math.abs(across - 0.5);
      return out.copy(dmd < 0.35 ? C.felt : C.cream);
    }
    if (b < 0.2) return out.copy(C.ochre);
    // the field: horses
    const iw = w - 0.4, ih = h - 0.4;
    const fu = (u * w - 0.2) / iw, fv = (v * h - 0.2) / ih;
    if (horizontal) {
      const k = Math.min(horses - 1, Math.floor(fu * horses)), lu = fu * horses - k;
      if (horseMask(lu * 1.05 - 0.02, (fv - 0.5) * (ih / (iw / horses)) + 0.5)) return out.copy(C.cream);
    } else {
      const k = Math.min(horses - 1, Math.floor(fv * horses)), lv = fv * horses - k;
      if (horseMask(fu, (lv - 0.5) * ((ih / horses) / iw) + 0.5)) return out.copy(C.cream);
    }
    return out.copy(C.felt);
  };
}

// ─────────────────────────────── the bake ───────────────────────────────

interface Lamp { x: number; y: number; z: number; r: number; i: number; c: THREE.Color }
const WARM = new THREE.Color(1.0, 0.7, 0.44), DAY = new THREE.Color(1.0, 0.93, 0.78), LAMP = new THREE.Color(1.0, 0.72, 0.48);
export const BRAZIERS = [{ x: -6.6, z: 6.6 }, { x: 6.6, z: 6.6 }, { x: -6.6, z: -6.4 }, { x: 6.6, z: -6.4 }];
const LAMPS: Lamp[] = [
  ...BRAZIERS.map((b) => ({ x: b.x, y: 1.5, z: b.z, r: 9.5, i: 1.5, c: WARM })),
  { x: 0, y: 2.0, z: 12.6, r: 5, i: 0.75, c: LAMP }, { x: 0, y: 2.0, z: 18.2, r: 5, i: 0.7, c: LAMP },
];
const AMBIENT = new THREE.Color(0.15, 0.13, 0.115);
const _n = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Color();

/** the light at a chamber-local point with normal n (the unlit interior's whole lighting model, baked once) */
function lightAt(x: number, y: number, z: number, n: THREE.Vector3, out: THREE.Color): THREE.Color {
  out.copy(AMBIENT);
  // soft sky bounce from the looter's hole and the dark ceiling
  out.multiplyScalar(1 - 0.35 * THREE.MathUtils.smoothstep(y, 3, 6));
  for (const L of LAMPS) {
    _d.set(L.x - x, L.y - y, L.z - z);
    const d = _d.length();
    if (d > L.r) continue;
    const f = (1 - (d / L.r) ** 2) ** 2;
    const lam = Math.max(0.2, n.dot(_d.normalize()));
    out.r += L.c.r * L.i * f * lam; out.g += L.c.g * L.i * f * lam; out.b += L.c.b * L.i * f * lam;
  }
  // the daylight shaft from the looter's hole: a pool on the coffin and the floor round it, and a glow on nearby faces
  const dx = x - (COFFIN.x + 0.3), dz = z - (COFFIN.z + 0.2), dr = Math.hypot(dx, dz);
  const pool = (1 - THREE.MathUtils.smoothstep(dr, 1.2, 3.0)) * Math.max(0, n.y);
  const halo = (1 - THREE.MathUtils.smoothstep(dr, 0.5, 5.5)) * 0.35;
  out.r += DAY.r * (pool * 1.8 + halo); out.g += DAY.g * (pool * 1.8 + halo); out.b += DAY.b * (pool * 1.8 + halo);
  // the pedestal's shaft, faint until the victory lights it (the FX does that)
  const pr = Math.hypot(x - PEDESTAL.x, z - PEDESTAL.z);
  const pp = (1 - THREE.MathUtils.smoothstep(pr, 0.6, 2.2)) * 0.5;
  out.r += DAY.r * pp; out.g += DAY.g * pp; out.b += DAY.b * pp;
  // the dromos' far end: cool daylight leaking in from the mound's door
  if (z > CH) {
    const k = THREE.MathUtils.smoothstep(z, DROMOS_END - 4, DROMOS_END);
    out.r += C.day.r * 0.5 * k; out.g += C.day.g * 0.5 * k; out.b += C.day.b * 0.6 * k;
  }
  // corners and the foot of every wall sit in the dark
  const wx = z > CH ? DW - Math.abs(x) : CH - Math.abs(x), wz = z > CH ? 99 : CH - Math.abs(z);
  const ao = THREE.MathUtils.smoothstep(Math.min(wx, wz) + y * 0.8, 0.0, 1.4);
  out.multiplyScalar(0.55 + 0.45 * ao);
  return out;
}

/** multiply a merged geometry's vertex colours by the baked light (positions are chamber-local) */
function bake(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal'), col = geo.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    _n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    lightAt(pos.getX(i), pos.getY(i), pos.getZ(i), _n, _l);
    col.setXYZ(i, col.getX(i) * _l.r, col.getY(i) * _l.g, col.getZ(i) * _l.b);
  }
  col.needsUpdate = true;
}

function interiorMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
}

// ─────────────────────────────── the builder ───────────────────────────────

/** a horizontal log from (x0, y, z0) to (x1, y, z1) */
const log = (x0: number, y: number, z0: number, x1: number, z1: number, r: number, sides = 9) => pole(v3(x0, y, z0), v3(x1, y, z1), r, r * 0.96, sides);

interface Stream { mesh: THREE.Mesh; mat: FxMaterial; tell: THREE.Mesh; tellMat: FxMaterial; x: number; z: number }
interface Ring { mesh: THREE.Mesh; mat: FxMaterial }

export class ShippingKurganDungeon {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /** true while the player is in the dromos or the chamber (the fight hides the outdoor world then) */
  inside = false;
  /** walkable heights: the floor (+ the sand drifts), the coffin plinth, the fallen beams, the pedestal step */
  readonly floorHeightAt = (x: number, z: number): number | undefined => this.floorAt(x, z);

  readonly niches = NICHES;
  readonly streams: Stream[] = [];
  readonly rings: Ring[] = [];
  beam!: { mesh: THREE.Mesh; mat: FxMaterial; line: THREE.Mesh; lineMat: FxMaterial };
  dome!: { mesh: THREE.Mesh; mat: FxMaterial };
  arc!: { mesh: THREE.Mesh; mat: FxMaterial };
  private shafts: { mesh: THREE.Mesh; mat: FxMaterial; base: number; target: number }[] = [];
  private flames!: FxMaterial;
  private curtain!: { mesh: THREE.Mesh; mat: FxMaterial; k: number; target: number };
  private sealCollider: Collider;
  private lid!: THREE.Mesh;
  private statues: THREE.Mesh[] = [];
  private heap!: THREE.Mesh;
  private fx: FxMaterial[] = [];
  // the sand drifts: a heightfield over the chamber floor (SAND_N × SAND_N cells), drawn as one displaced grid
  private sandH = new Float32Array(SAND_N * SAND_N);
  private sandMesh!: THREE.Mesh;
  private sandLight = new Float32Array((SAND_N + 1) * (SAND_N + 1) * 3);
  private sandDirty = false;
  /** the drifts' collision (P1): rebuilt with the drawn grid */
  private sandPatch: HeightPatch | null = null;
  private sandAcc = 0;

  constructor() {
    this.group.name = 'kurgan-dungeon';
    this.group.visible = false;
    this.group.position.set(DUNGEON.x, DUNGEON.y, DUNGEON.z);
    this.sealCollider = { x: DUNGEON.x, z: DUNGEON.z + CH + 0.1, hw: DOOR_W + 0.3, hd: 0.25, rot: 0, yTop: DUNGEON.y - 50, yBottom: DUNGEON.y - 51 };
  }

  // ── frames ──
  local(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 { return out.set(p.x - DUNGEON.x, p.y - DUNGEON.y, p.z - DUNGEON.z); }
  world(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 { return out.set(DUNGEON.x + lx, DUNGEON.y + ly, DUNGEON.z + lz); }
  inChamber(p: THREE.Vector3): boolean { const x = p.x - DUNGEON.x, z = p.z - DUNGEON.z, y = p.y - DUNGEON.y; return Math.abs(x) < CH && Math.abs(z) < CH && y > -3 && y < 8; }
  inDromos(p: THREE.Vector3): boolean { const x = p.x - DUNGEON.x, z = p.z - DUNGEON.z, y = p.y - DUNGEON.y; return Math.abs(x) < DW + 0.5 && z >= CH && z < DROMOS_END + 1 && y > -3 && y < 8; }
  inVolume(p: THREE.Vector3): boolean { return this.inChamber(p) || this.inDromos(p); }

  build(): this {
    const t0 = performance.now();
    const kit = new PaintKit(0xb0551);
    const rng = kit.rng;
    const mat = interiorMaterial();
    this.buildChamber(kit, rng);
    this.buildDromos(kit, rng);
    this.buildGraveGoods(kit, rng);
    const geo = kit.finish();
    bake(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'kurgan-interior';
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.buildMovables(mat, rng);
    this.buildSand(mat);
    this.buildFx();
    this.buildColliders();
    this.buildMs = Math.round(performance.now() - t0);
    this.tris = geo.getAttribute('position').count / 3;
    return this;
  }
  buildMs = 0; tris = 0;

  private buildChamber(kit: PaintKit, rng: Rng): void {
    // ── floor: long larch boards, dusty toward the walls ──
    for (let i = 0; i < 40; i++) {
      const z = -CH + 0.25 + i * 0.5;
      kit.add(new THREE.BoxGeometry(CH * 2, 0.16, 0.48), rng.next() < 0.3 ? C.larchOld : C.board, { matrix: M(0, -0.08 + rng.range(-0.012, 0.012), z), flat: true, brush: 0.12 });
    }
    // ── walls: stacked horizontal logs; openings for the door (north) and the four niches (east / west) ──
    const rows = Math.ceil(PLANK_Y / 0.42);                // up to the deck: no gap under the ceiling
    for (let r = 0; r < rows; r++) {
      const y = 0.22 + r * 0.42, rr = 0.23 + rng.range(-0.015, 0.015);
      const col = r % 3 === 0 ? C.larchDark : r % 3 === 1 ? C.larch : C.larchOld;
      // north (z = +CH): split round the door
      if (y < DOOR_H + 0.1) { kit.add(log(-CH, y, CH, -DOOR_W - 0.35, CH, rr), col, { brush: 0.12 }); kit.add(log(DOOR_W + 0.35, y, CH, CH, CH, rr), col, { brush: 0.12 }); }
      else kit.add(log(-CH, y, CH, CH, CH, rr), col, { brush: 0.12 });
      kit.add(log(-CH, y, -CH, CH, -CH, rr), col, { brush: 0.12 });
      // east (x = −CH) / west (x = +CH): split round the niches
      for (const sx of [-1, 1]) {
        const x = sx * CH;
        if (y < 3.55) {
          const cuts = NICHES.filter((n) => Math.sign(n.x) === sx).map((n) => n.z).sort((a, b) => a - b);
          let z0 = -CH;
          for (const cz of cuts) { kit.add(log(x, y, z0, x, cz - 1.15, rr), col, { brush: 0.12 }); z0 = cz + 1.15; }
          kit.add(log(x, y, z0, x, CH, rr), col, { brush: 0.12 });
        } else kit.add(log(x, y, -CH, x, CH, rr), col, { brush: 0.12 });
      }
    }
    // ── posts: the corners, the wall midpoints, either side of every opening ──
    const post = (x: number, z: number, r = 0.3) => kit.add(pole(v3(x, -0.1, z), v3(x, BEAM_Y + 0.2, z), r, r * 0.9, 10), C.larchDark, { brush: 0.14, foot: 0.7 });
    for (const [x, z] of [[-CH, -CH], [CH, -CH], [-CH, CH], [CH, CH], [0, -CH], [-CH, 0], [CH, 0]] as const) post(x * 0.97, z * 0.97, 0.34);
    for (const sx of [-1, 1]) post(sx * (DOOR_W + 0.3), CH - 0.05, 0.32);
    kit.add(log(-DOOR_W - 0.9, DOOR_H + 0.3, CH - 0.1, DOOR_W + 0.9, CH - 0.1, 0.3), C.larchOld, { brush: 0.1 });
    // niches: framed, recessed, dark inside
    for (const n of NICHES) {
      const sx = Math.sign(n.x), x = sx * CH;
      for (const dz of [-1.15, 1.15]) kit.add(pole(v3(x - sx * 0.1, -0.1, n.z + dz), v3(x - sx * 0.1, 3.7, n.z + dz), 0.24, 0.22, 9), C.larchDark, { brush: 0.12 });
      kit.add(log(x - sx * 0.1, 3.72, n.z - 1.4, x - sx * 0.1, n.z + 1.4, 0.26), C.larchOld);
      kit.add(new THREE.BoxGeometry(0.2, 3.8, 2.4), C.earth.clone().multiplyScalar(0.55), { matrix: M(x + sx * 1.2, 1.8, n.z), flat: true });
      kit.add(new THREE.BoxGeometry(1.3, 0.2, 2.4), C.earth.clone().multiplyScalar(0.7), { matrix: M(x + sx * 0.6, 3.8, n.z), flat: true });
      for (const dz of [-1.2, 1.2]) kit.add(new THREE.BoxGeometry(1.3, 3.8, 0.2), C.earth.clone().multiplyScalar(0.6), { matrix: M(x + sx * 0.6, 1.8, n.z + dz), flat: true });
      kit.add(new THREE.BoxGeometry(1.3, 0.1, 2.4), C.earth, { matrix: M(x + sx * 0.6, 0.0, n.z), flat: true });
    }
    // ── the ceiling: massive beams across, a plank deck above them, the looter's hole over the coffin ──
    const hole = (x: number, z: number) => Math.hypot((x - 0.3) / 1.45, (z - COFFIN.z - 0.1) / 1.25) < 1 + 0.12 * Math.sin(Math.atan2(z, x) * 5);
    for (let k = 0; k < 13; k++) {
      const z = -CH + 0.6 + k * 1.57;
      const r = 0.3 + rng.range(-0.02, 0.03);
      if (Math.abs(z - COFFIN.z) < 1.2) {
        // the broken beam: two halves hanging into the hole
        kit.add(pole(v3(-CH, BEAM_Y, z), v3(-1.2, BEAM_Y - 0.55, z + 0.2), r, r * 0.8, 9), C.larchOld, { brush: 0.14 });
        kit.add(pole(v3(CH, BEAM_Y, z), v3(1.6, BEAM_Y - 0.9, z - 0.3), r, r * 0.8, 9), C.larchOld, { brush: 0.14 });
        continue;
      }
      kit.add(log(-CH, BEAM_Y, z, CH, z, r, 10), k % 2 === 0 ? C.larchDark : C.larch, { brush: 0.14 });
    }
    for (let i = 0; i < 40; i++) {
      const x = -CH + 0.25 + i * 0.5;
      // boards along z, cut where they cross the hole (ragged ends)
      let z0 = -CH;
      const segs: [number, number][] = [];
      let inHole = false;
      for (let z = -CH; z <= CH + 1e-6; z += 0.25) {
        const h = hole(x, z);
        if (h && !inHole) { segs.push([z0, z]); inHole = true; }
        if (!h && inHole) { z0 = z + rng.range(0, 0.2); inHole = false; }
      }
      if (!inHole) segs.push([z0, CH]);
      for (const [a, b] of segs) if (b - a > 0.2) kit.add(new THREE.BoxGeometry(0.47, 0.12, b - a), rng.next() < 0.4 ? C.larchOld : C.larchDark, { matrix: M(x, PLANK_Y + rng.range(-0.02, 0.02), (a + b) / 2), flat: true, brush: 0.15 });
    }
    // the mound's packed earth over the deck (the plank seams must not show the sky): four slabs framing the hole
    const HX0 = -1.3, HX1 = 1.9, HZ0 = COFFIN.z - 1.3, HZ1 = COFFIN.z + 1.5, EY = PLANK_Y + 0.2;
    const slab = (x0: number, x1: number, z0: number, z1: number) => kit.add(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), C.earth.clone().multiplyScalar(0.4), { matrix: M((x0 + x1) / 2, EY, (z0 + z1) / 2), flat: true, brush: 0 });
    slab(-CH - 0.5, CH + 0.5, HZ1, CH + 0.5); slab(-CH - 0.5, CH + 0.5, -CH - 0.5, HZ0); slab(-CH - 0.5, HX0, HZ0, HZ1); slab(HX1, CH + 0.5, HZ0, HZ1);
    // earth and turf showing round the hole's rim (the mound's fill), and dangling roots
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2, x = 0.3 + Math.cos(a) * 1.5, z = COFFIN.z + 0.1 + Math.sin(a) * 1.3;
      kit.add(blob(rng.range(0.25, 0.45), rng, 1, 0.6), C.earth, { matrix: M(x, PLANK_Y + 0.15, z, rng.range(0, 6)) });
      if (i % 3 === 0) kit.add(pole(v3(x, PLANK_Y, z), v3(x + rng.range(-0.2, 0.2), PLANK_Y - rng.range(0.5, 1.3), z + rng.range(-0.2, 0.2)), 0.025, 0.008, 4), C.earth);
    }
    // ── the coffin plinth (walkable high ground) and the coffin: a hollowed larch log, horses carved along its sides ──
    kit.add(new THREE.BoxGeometry(COFFIN.wid + 1.3, COFFIN.plinthH, COFFIN.len + 1.2), C.larchOld, { matrix: M(COFFIN.x, COFFIN.plinthH / 2, COFFIN.z), flat: true, brush: 0.1 });
    for (const sx of [-1, 1]) kit.add(log(COFFIN.x + sx * (COFFIN.wid / 2 + 0.55), COFFIN.plinthH - 0.05, COFFIN.z - COFFIN.len / 2 - 0.5, COFFIN.x + sx * (COFFIN.wid / 2 + 0.55), COFFIN.z + COFFIN.len / 2 + 0.5, 0.14), C.larchDark);
    const cy = COFFIN.plinthH + COFFIN.h / 2;
    const sidePaint = (w: number, h: number) => {
      const out = new THREE.Color();
      return (p: THREE.Vector3, n: THREE.Vector3) => {
        if (Math.abs(n.x) > 0.7) {
          // a frieze of three horses along the side (p.z along, p.y up)
          const u = p.z / w + 0.5, v = p.y / h + 0.5;
          const k = Math.min(2, Math.floor(u * 3)), lu = u * 3 - k;
          if (v > 0.18 && v < 0.86 && horseMask(n.x > 0 ? lu : 1 - lu, (v - 0.18) / 0.68)) return out.copy(C.larchOld).lerp(C.cream, 0.25);
          if (v < 0.12 || v > 0.9) return out.copy(C.larchDark);
        }
        return out.copy(C.larch);
      };
    };
    kit.add(new THREE.BoxGeometry(COFFIN.wid, COFFIN.h, COFFIN.len, 2, 12, 60), sidePaint(COFFIN.len, COFFIN.h), { matrix: M(COFFIN.x, cy, COFFIN.z), flat: true, brush: 0.08 });
    kit.add(new THREE.BoxGeometry(COFFIN.wid - 0.22, 0.04, COFFIN.len - 0.22), C.black, { matrix: M(COFFIN.x, COFFIN.plinthH + COFFIN.h + 0.005, COFFIN.z), flat: true, brush: 0 });
    // ── the pedestal: a dressed stone block under a red felt with a horse ──
    kit.add(new THREE.BoxGeometry(1.2, PEDESTAL.h, 1.0), C.stone, { matrix: M(PEDESTAL.x, PEDESTAL.h / 2, PEDESTAL.z), brush: 0.14, flat: true });
    kit.add(new THREE.BoxGeometry(1.1, 0.04, 1.3), C.felt, { matrix: M(PEDESTAL.x, PEDESTAL.h + 0.02, PEDESTAL.z + 0.1), flat: true });
    kit.add(new THREE.PlaneGeometry(0.95, 0.75, 38, 30), feltPainter(0.95, 0.75, 1, true), { matrix: M(PEDESTAL.x, PEDESTAL.h - 0.36, PEDESTAL.z + 0.505), brush: 0.05 });
    kit.add(new THREE.BoxGeometry(1.6, 0.18, 1.4), C.stone.clone().multiplyScalar(0.85), { matrix: M(PEDESTAL.x, 0.09, PEDESTAL.z), flat: true, brush: 0.12 });
    // ── the braziers: bronze tripods with a bowl of embers ──
    for (const b of BRAZIERS) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        kit.add(pole(v3(b.x + Math.cos(a) * 0.45, 0, b.z + Math.sin(a) * 0.45), v3(b.x + Math.cos(a) * 0.18, 0.9, b.z + Math.sin(a) * 0.18), 0.035, 0.03, 5), C.bronze);
      }
      kit.add(lathe([[0.02, 0.0], [0.34, 0.04], [0.5, 0.2], [0.52, 0.28], [0.47, 0.27], [0.3, 0.12], [0.0, 0.1]], 16), C.bronze, { matrix: M(b.x, 0.9, b.z), brush: 0.1 });
      kit.add(blob(0.36, rng, 1, 0.3, 0.3), new THREE.Color(2.2, 0.8, 0.25), { matrix: M(b.x, 1.13, b.z) });  // embers (HDR: they glow)
    }
    // ── felt hangings on the walls and red felt rugs on the floor ──
    const hang = (x: number, z: number, yaw: number) => {
      kit.add(new THREE.PlaneGeometry(1.7, 2.7, 44, 70), feltPainter(1.7, 2.7, 2, false), { matrix: M(x, 2.55, z, yaw), brush: 0.06 });
      kit.add(log(x - Math.cos(yaw), 3.95, z + Math.sin(yaw), x + Math.cos(yaw), z - Math.sin(yaw), 0.04, 6), C.larchDark);
    };
    hang(-5.6, CH - 0.28, Math.PI); hang(5.6, CH - 0.28, Math.PI);
    hang(-4.8, -CH + 0.28, 0); hang(4.8, -CH + 0.28, 0);
    hang(-CH + 0.28, 0.2, Math.PI / 2); hang(CH - 0.28, 0.2, -Math.PI / 2);
    const rug = (x: number, z: number, w: number, d: number, yaw: number, horses: number) => {
      const fp = feltPainter(w, d, horses, true), q = new THREE.Vector3();
      kit.add(new THREE.PlaneGeometry(w, d, Math.round(w * 22), Math.round(d * 22)).rotateX(-Math.PI / 2), (p) => fp(q.set(p.x, -p.z, 0)), { matrix: M(x, 0.012, z, yaw), brush: 0.05 });
    };
    rug(0, 4.4, 3.4, 2.2, 0, 2);
    rug(-5.8, -6.0, 2.6, 1.8, 0.35, 1);
    rug(6.2, 0.4, 1.8, 2.8, 0.1, 2);
    rug(0, -6.9, 2.8, 1.6, 0, 2);
    // fur pelts by the coffin
    for (const [x, z, a] of [[-1.9, 0.8, 0.4], [2.0, -1.6, -0.6]] as const) kit.add(blob(0.8, rng, 2, 0.08, 0.3), C.fur, { matrix: M(x, 0.02, z, a, 1.2, 1, 0.8), brush: 0.1 });
    // the fallen roof beams (high ground)
    for (const f of FALLEN) kit.add(pole(v3(f.a[0], f.r, f.a[1]), v3(f.b[0], f.r * 0.95, f.b[1]), f.r, f.r * 0.9, 10), C.larchOld, { brush: 0.14 });
  }

  private buildDromos(kit: PaintKit, rng: Rng): void {
    const z0 = CH + 0.2, z1 = DROMOS_END;
    for (let i = 0; i < 7; i++) {
      const x = -DW + 0.22 + i * 0.43;
      kit.add(new THREE.BoxGeometry(0.42, 0.16, z1 - z0), rng.next() < 0.4 ? C.larchOld : C.board, { matrix: M(x, -0.08, (z0 + z1) / 2), flat: true, brush: 0.12 });
    }
    const niche = (z: number) => [13.6, 18.4].some((nz) => Math.abs(z - nz) < 0.9);
    for (let r = 0; r < 8; r++) {
      const y = 0.2 + r * 0.4;
      for (const sx of [-1, 1]) {
        if (y < 2.4) {
          kit.add(log(sx * DW, y, z0, sx * DW, 12.7, 0.2), r % 2 ? C.larch : C.larchDark);
          kit.add(log(sx * DW, y, 14.5, sx * DW, 17.5, 0.2), r % 2 ? C.larch : C.larchDark);
          kit.add(log(sx * DW, y, 19.3, sx * DW, z1, 0.2), r % 2 ? C.larch : C.larchDark);
        } else kit.add(log(sx * DW, y, z0, sx * DW, z1, 0.2), r % 2 ? C.larch : C.larchDark);
      }
    }
    for (let z = z0 + 0.2; z < z1; z += 0.55) kit.add(log(-DW - 0.3, DH + 0.05, z, DW + 0.3, z, 0.21, 8), C.larchOld, { brush: 0.12 });
    // the niches with their dormant balbals (static — only the chamber's four wake)
    for (const nz of [13.6, 18.4]) for (const sx of [-1, 1]) {
      kit.add(new THREE.BoxGeometry(0.2, 2.8, 1.8), C.earth.clone().multiplyScalar(0.55), { matrix: M(sx * (DW + 0.9), 1.3, nz), flat: true });
      kit.add(new THREE.BoxGeometry(1.1, 0.12, 1.9), C.earth.clone().multiplyScalar(0.7), { matrix: M(sx * (DW + 0.45), -0.02, nz), flat: true });
      for (const dz of [-0.95, 0.95]) kit.add(new THREE.BoxGeometry(1.1, 2.8, 0.14), C.earth.clone().multiplyScalar(0.5), { matrix: M(sx * (DW + 0.45), 1.3, nz + dz), flat: true });
      kit.add(new THREE.BoxGeometry(1.1, 0.14, 1.9), C.earth.clone().multiplyScalar(0.45), { matrix: M(sx * (DW + 0.45), 2.72, nz), flat: true });
      for (const dz of [-0.9, 0.9]) kit.add(pole(v3(sx * DW, -0.1, nz + dz), v3(sx * DW, 2.7, nz + dz), 0.2, 0.18, 8), C.larchDark);
      kit.add(log(sx * DW, 2.65, nz - 1.1, sx * DW, nz + 1.1, 0.2), C.larchOld);
      const g = balbalGeometry(nz > 16 ? 1 : 0, 0xba1 + Math.round(nz * 10) + sx);
      g.applyMatrix4(M(sx * (DW + 0.55), 0, nz, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 1.0));
      kit.add(g, (p) => new THREE.Color(0.4, 0.39, 0.37).multiplyScalar(0.85 + 0.15 * Math.sin(p.y * 7)), { brush: 0.08 });
    }
    // the door frame between the dromos and the chamber: massive larch posts and a lintel
    for (const sx of [-1, 1]) kit.add(pole(v3(sx * (DOOR_W + 0.05), -0.1, CH + 0.3), v3(sx * (DOOR_W + 0.05), DOOR_H + 0.35, CH + 0.3), 0.3, 0.27, 10), C.larchDark, { brush: 0.14 });
    kit.add(log(-DOOR_W - 0.6, DOOR_H + 0.3, CH + 0.3, DOOR_W + 0.6, CH + 0.3, 0.3), C.larch);
    // the far end: packed earth and daylight coming round the bend from the mound's door
    kit.add(new THREE.BoxGeometry(DW * 2 + 0.4, DH + 0.4, 0.3), C.day.clone().multiplyScalar(0.55), { matrix: M(0, DH / 2, z1 + 0.15), flat: true, brush: 0.2 });
    // gold offerings along the walls, oil lamps on posts
    for (let i = 0; i < 12; i++) {
      const z = rng.range(z0 + 0.6, z1 - 1), sx = rng.next() < 0.5 ? -1 : 1;
      if (niche(z)) continue;
      this.goldBowl(kit, rng, sx * (DW - 0.35), z, rng.range(0.1, 0.18));
    }
    for (const z of [12.6, 18.2]) {
      kit.add(pole(v3(-DW + 0.25, 0, z), v3(-DW + 0.25, 1.75, z), 0.05, 0.04, 6), C.larchDark);
      kit.add(lathe([[0.02, 0], [0.12, 0.04], [0.14, 0.08], [0.0, 0.07]], 10), C.bronze, { matrix: M(-DW + 0.25, 1.75, z) });
    }
  }

  private goldBowl(kit: PaintKit, rng: Rng, x: number, z: number, r: number, y = 0): void {
    kit.add(lathe([[0.0, 0.0], [r * 0.55, 0.0], [r * 0.9, r * 0.25], [r, r * 0.6], [r * 0.93, r * 0.62], [r * 0.82, r * 0.3], [0.0, r * 0.12]], 14), rng.next() < 0.7 ? C.gold : C.goldDark, { matrix: M(x, y, z, rng.range(0, 6)), brush: 0.18 });
  }

  private buildGraveGoods(kit: PaintKit, rng: Rng): void {
    const G = kit;
    const nearWall = (): [number, number] => {
      const side = rng.int(0, 3), t = rng.range(-CH + 1.2, CH - 1.2), d = rng.range(0.7, 1.9);
      const p: [number, number] = side === 0 ? [t, -CH + d] : side === 1 ? [t, CH - d] : side === 2 ? [-CH + d, t] : [CH - d, t];
      return p;
    };
    const blocked = (x: number, z: number) => (Math.abs(x) < DOOR_W + 0.8 && z > CH - 2.6)
      || NICHES.some((n) => Math.abs(x - n.x) < 2.6 && Math.abs(z - n.z) < 1.6)
      || Math.hypot(x - PEDESTAL.x, z - PEDESTAL.z) < 1.6 || BRAZIERS.some((b) => Math.hypot(x - b.x, z - b.z) < 1.0);
    // chests (carved boxes), cauldrons, amphorae, bowls, heaps of plaques — against the walls
    for (let i = 0; i < 70; i++) {
      const [x, z] = nearWall();
      if (blocked(x, z)) continue;
      const kind = rng.next();
      if (kind < 0.16) {
        const w = rng.range(0.8, 1.3), d = rng.range(0.55, 0.8), h = rng.range(0.45, 0.7), yaw = Math.abs(x) > Math.abs(z) ? Math.PI / 2 : 0;
        G.add(new THREE.BoxGeometry(w, h, d), C.larchDark, { matrix: M(x, h / 2, z, yaw + rng.range(-0.1, 0.1)), flat: true, brush: 0.12 });
        G.add(new THREE.BoxGeometry(w + 0.06, 0.08, d + 0.06), C.bronze, { matrix: M(x, h + 0.04, z, yaw), flat: true });
        for (let k = 0; k < 4; k++) this.goldBowl(G, rng, x + rng.range(-w / 3, w / 3), z + rng.range(-0.15, 0.15), rng.range(0.08, 0.13), h + 0.08);
      } else if (kind < 0.26) {
        G.add(lathe([[0.0, 0.0], [0.22, 0.02], [0.4, 0.2], [0.44, 0.45], [0.38, 0.62], [0.34, 0.64], [0.36, 0.6], [0.0, 0.55]], 16), C.bronze, { matrix: M(x, 0, z), brush: 0.14 });
        for (const a of [0, Math.PI]) G.add(new THREE.TorusGeometry(0.1, 0.02, 5, 10), C.bronze, { matrix: M(x + Math.cos(a) * 0.4, 0.62, z + Math.sin(a) * 0.4, a + Math.PI / 2) });
      } else if (kind < 0.36) {
        G.add(lathe([[0.0, 0.0], [0.08, 0.02], [0.2, 0.25], [0.21, 0.5], [0.1, 0.72], [0.07, 0.85], [0.1, 0.9], [0.0, 0.9]], 14), rng.next() < 0.5 ? C.ochre : C.gold, { matrix: M(x, 0, z, 0, 1, rng.range(0.8, 1.2)), brush: 0.14 });
      } else if (kind < 0.72) {
        this.goldBowl(G, rng, x, z, rng.range(0.14, 0.3));
      } else {
        // a heap of gold plaques and coins
        G.add(blob(rng.range(0.35, 0.7), rng, 2, 0.35, 0.35), (p) => (Math.sin(p.x * 60) * Math.sin(p.z * 60) > 0.2 ? C.gold : C.goldDark), { matrix: M(x, 0, z, rng.range(0, 6)), brush: 0.25 });
      }
    }
    // gold spilled across the floor
    for (let i = 0; i < 90; i++) {
      const x = rng.range(-CH + 0.6, CH - 0.6), z = rng.range(-CH + 0.6, CH - 0.6);
      if (Math.hypot(x - COFFIN.x, z - COFFIN.z) < 2.4 || blocked(x, z)) continue;
      G.add(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 7), C.gold, { matrix: M(x, 0.008, z, 0, 1, 1, 1, rng.range(-0.2, 0.2)) });
    }
    // spears with gold horse finials and round gold shields leaning on the walls
    for (let i = 0; i < 10; i++) {
      const [x, z] = nearWall();
      if (blocked(x, z)) continue;
      const tx = x + Math.sign(x) * (Math.abs(x) > Math.abs(z) ? 0.6 : 0), tz = z + Math.sign(z) * (Math.abs(z) >= Math.abs(x) ? 0.6 : 0);
      if (i % 2 === 0) {
        G.add(pole(v3(x, 0, z), v3(tx, 2.9, tz), 0.03, 0.025, 5), C.larchDark);
        G.add(new THREE.ConeGeometry(0.06, 0.3, 6), C.gold, { matrix: M(tx, 3.05, tz) });
        G.add(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 6), new THREE.Color('#9a1a14'), { matrix: M(tx, 2.78, tz) });
      } else {
        const yaw = Math.abs(x) > Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : (z > 0 ? Math.PI : 0);
        G.add(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), (p, n) => (n.y > 0.5 && Math.hypot(p.x, p.z) > 0.3 ? C.goldDark : C.gold), { matrix: M(x, 0.45, z, yaw, 1, 1, 1, Math.PI / 2 - 0.25), brush: 0.1 });
      }
    }
    // gold ibex statuettes flanking the pedestal
    for (const sx of [-1, 1]) {
      const x = PEDESTAL.x + sx * 1.6, z = PEDESTAL.z + 0.2;
      G.add(new THREE.BoxGeometry(0.5, 0.5, 0.5), C.larchDark, { matrix: M(x, 0.25, z), flat: true });
      G.add(new THREE.CapsuleGeometry(0.1, 0.32, 3, 8).rotateZ(Math.PI / 2), C.gold, { matrix: M(x, 0.72, z, Math.PI / 2) });
      G.add(new THREE.CapsuleGeometry(0.05, 0.16, 3, 6), C.gold, { matrix: M(x, 0.9, z - sx * 0, Math.PI / 2, 1, 1, 1, 0.6) });
      for (const dz of [-0.13, 0.13]) G.add(new THREE.TorusGeometry(0.1, 0.018, 5, 10, Math.PI * 1.3), C.gold, { matrix: M(x, 1.05, z + dz, 0, 1, 1, 1, 0) });
      for (const lx of [-0.12, 0.12]) G.add(new THREE.CylinderGeometry(0.025, 0.02, 0.22, 5), C.gold, { matrix: M(x + lx, 0.56, z) });
    }
  }

  /** the pieces that move or come and go: the coffin lid, the four niche balbals, the heap of plaques */
  private buildMovables(mat: THREE.MeshBasicMaterial, rng: Rng): void {
    {
      const kit = new PaintKit(0x11d);
      kit.add(new THREE.BoxGeometry(COFFIN.wid + 0.14, 0.18, COFFIN.len + 0.14, 2, 1, 40), (p, n) => (n.y > 0.5 && horseMask(p.z / COFFIN.len * 3 % 1 + 0.5, p.x / COFFIN.wid + 0.5) ? C.larchOld : C.larch), { flat: true, brush: 0.1 });
      const g = kit.finish();
      // bake as it lies on the coffin (the lid is small: the light barely changes when it slides)
      g.translate(COFFIN.x, COFFIN.plinthH + COFFIN.h + 0.09, COFFIN.z); bake(g); g.translate(-COFFIN.x, -(COFFIN.plinthH + COFFIN.h + 0.09), -COFFIN.z);
      this.lid = new THREE.Mesh(g, mat);
      this.lid.position.set(COFFIN.x, COFFIN.plinthH + COFFIN.h + 0.09, COFFIN.z);
      this.lid.frustumCulled = false;
      this.group.add(this.lid);
    }
    for (const [i, n] of NICHES.entries()) {
      const kit = new PaintKit(0x2b + i);
      const g0 = balbalGeometry(i % 2, 0xba7 + i * 3);
      g0.applyMatrix4(M(0, 0, 0, 0, 1.2));
      kit.add(g0, (p) => new THREE.Color(0.4, 0.39, 0.37).multiplyScalar(0.85 + 0.15 * Math.sin(p.y * 7)), { brush: 0.08 });
      const g = kit.finish();
      const sx = Math.sign(n.x);
      g.applyMatrix4(M(n.x + sx * 0.55, 0, n.z, n.yaw + Math.PI));
      bake(g);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      this.statues.push(m); this.group.add(m);
    }
    {
      const kit = new PaintKit(0x4ea9);
      for (let i = 0; i < 70; i++) {
        const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 1.1, y = (1.1 - r) * 0.35;
        kit.add(new THREE.BoxGeometry(0.1, 0.02, 0.13), rng.next() < 0.7 ? C.gold : C.goldDark, { matrix: M(Math.cos(a) * r, y + rng.range(0, 0.08), Math.sin(a) * r, rng.range(0, 6), 1, 1, 1, rng.range(-0.8, 0.8), rng.range(-0.8, 0.8)), flat: true });
      }
      kit.add(blob(0.9, rng, 2, 0.4, 0.3), C.goldDark, { matrix: M(0, 0.02, 0) });
      const g = kit.finish();
      const col = g.getAttribute('color');
      for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * 1.6, col.getY(i) * 1.35, col.getZ(i) * 1.1);
      this.heap = new THREE.Mesh(g, mat);
      this.heap.visible = false;
      this.group.add(this.heap);
    }
  }

  private buildSand(mat: THREE.MeshBasicMaterial): void {
    const g = new THREE.PlaneGeometry(CH * 2, CH * 2, SAND_N, SAND_N).rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position'), n = pos.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      _n.set(0, 1, 0);
      lightAt(x, 0.2, z, _n, _l);
      this.sandLight[i * 3] = _l.r; this.sandLight[i * 3 + 1] = _l.g; this.sandLight[i * 3 + 2] = _l.b;
      pos.setY(i, -0.05);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (pos as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.sandMesh = new THREE.Mesh(g, mat);
    this.sandMesh.frustumCulled = false;
    this.sandMesh.visible = false;
    this.group.add(this.sandMesh);
  }

  private buildFx(): void {
    const add = <T extends THREE.Object3D>(o: T, order = 10): T => { o.renderOrder = order; o.frustumCulled = false; this.group.add(o); return o; };
    const reg = (m: FxMaterial) => { this.fx.push(m); return m; };
    // the two light shafts: the looter's hole on the coffin, and the pedestal's (lit at the victory)
    const shaft = (x: number, z: number, top: number, r0: number, r1: number, base: number) => {
      const g = new THREE.CylinderGeometry(r0, r1, top, 24, 1, true);
      g.translate(0, top / 2, 0);
      const mat = reg(fxMaterial(FX.shaft, new THREE.Color(1.0, 0.86, 0.58), base));
      const m = add(new THREE.Mesh(g, mat), 12);
      m.position.set(x, 0, z); m.rotation.z = 0.1;
      this.shafts.push({ mesh: m, mat, base, target: base });
    };
    shaft(COFFIN.x + 0.3, COFFIN.z + 0.1, PLANK_Y + 1.5, 1.3, 1.25, 0.38);
    shaft(PEDESTAL.x, PEDESTAL.z, PLANK_Y + 0.5, 0.75, 0.65, 0.0);
    // flames: one merged mesh of crossed cards over the braziers and the dromos lamps
    {
      const parts: THREE.BufferGeometry[] = [];
      const flame = (x: number, y: number, z: number, h: number) => {
        for (const a of [0, Math.PI / 2]) { const p = new THREE.PlaneGeometry(h * 0.6, h, 1, 4); p.translate(0, h / 2, 0); p.rotateY(a); p.translate(x, y, z); parts.push(p); }
      };
      for (const b of BRAZIERS) flame(b.x, 1.12, b.z, 0.9);
      flame(-DW + 0.25, 1.8, 12.6, 0.28); flame(-DW + 0.25, 1.8, 18.2, 0.28);
      const g = mergeParts(parts);
      this.flames = reg(fxMaterial(FX.flame, new THREE.Color(1.3, 0.55, 0.15), 1));
      add(new THREE.Mesh(g, this.flames), 13);
    }
    // gold rings (the sunburst): flat annuli on the floor, radius set per use
    for (let i = 0; i < 2; i++) {
      const g = annulus(0.84, 1.0, 128);
      const mat = reg(fxMaterial(FX.ring, new THREE.Color(3.2, 2.1, 0.6), 0));
      mat.uniforms.uP.value.x = 0.9;
      mat.depthTest = false;                           // the ring reads over the drifts and the rugs
      const m = add(new THREE.Mesh(g, mat), 14); m.visible = false;
      this.rings.push({ mesh: m, mat });
    }
    // sand streams (+ their floor shimmer tell)
    for (const s of STREAMS) {
      const g = new THREE.CylinderGeometry(0.28, 0.4, PLANK_Y, 12, 1, true); g.translate(0, PLANK_Y / 2, 0);
      const mat = reg(fxMaterial(FX.stream, new THREE.Color(0.95, 0.78, 0.48), 0, false));
      const m = add(new THREE.Mesh(g, mat), 11); m.position.set(s.x, 0, s.z); m.visible = false;
      const tg = new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2);
      const tellMat = reg(fxMaterial(FX.decal, new THREE.Color(1.6, 1.15, 0.4), 0));
      tellMat.uniforms.uP.value.set(0, 0.6, 0, 0);
      const tell = add(new THREE.Mesh(tg, tellMat), 14); tell.position.set(s.x, 0.04, s.z); tell.visible = false;
      this.streams.push({ mesh: m, mat, tell, tellMat, x: s.x, z: s.z });
    }
    // the sun beam (phase III) and the thin gold line of its path
    {
      const g = new THREE.CylinderGeometry(0.45, 0.7, 1, 18, 1, true); g.translate(0, 0.5, 0);
      const mat = reg(fxMaterial(FX.beam, new THREE.Color(1.5, 1.0, 0.4), 0));
      const mesh = add(new THREE.Mesh(g, mat), 12); mesh.visible = false;
      const lg = annulus(5.85, 6.15, 64, Math.PI * 0.6);
      const lineMat = reg(fxMaterial(FX.ring, new THREE.Color(1.8, 1.25, 0.4), 0));
      lineMat.uniforms.uP.value.x = 0.8;
      const line = add(new THREE.Mesh(lg, lineMat), 14); line.position.y = 0.05; line.visible = false;
      this.beam = { mesh, mat, line, lineMat };
    }
    // the shield dome (phase II) and the painted arc of the wide strike
    {
      const g = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const mat = reg(fxMaterial(FX.dome, new THREE.Color(1.5, 1.05, 0.35), 0));
      const mesh = add(new THREE.Mesh(g, mat), 15); mesh.visible = false;
      this.dome = { mesh, mat };
      const ag = new THREE.CircleGeometry(1, 32, -Math.PI * 0.35, Math.PI * 0.7).rotateX(-Math.PI / 2);
      const amat = reg(fxMaterial(FX.decal, new THREE.Color(1.8, 0.5, 0.15), 0));
      amat.uniforms.uP.value.set(0.25, 0.5, 0, 0);
      const arc = add(new THREE.Mesh(ag, amat), 14); arc.visible = false;
      this.arc = { mesh: arc, mat: amat };
    }
    // the seal: a curtain of sand pouring over the chamber door
    {
      const g = new THREE.PlaneGeometry(DOOR_W * 2 + 0.4, DOOR_H + 0.4, 1, 1); g.translate(0, (DOOR_H + 0.4) / 2, 0);
      const mat = reg(fxMaterial(FX.curtain, new THREE.Color(0.9, 0.72, 0.45), 0, false));
      const mesh = add(new THREE.Mesh(g, mat), 11); mesh.position.set(0, 0, CH + 0.05); mesh.visible = false;
      this.curtain = { mesh, mat, k: 0, target: 0 };
    }
  }

  private buildColliders(): void {
    const Y0 = DUNGEON.y, box = (lx: number, lz: number, hw: number, hd: number, y0: number, y1: number) => this.colliders.push({ x: DUNGEON.x + lx, z: DUNGEON.z + lz, hw, hd, rot: 0, yBottom: Y0 + y0, yTop: Y0 + y1 });
    // chamber walls (the north one split round the door, east / west round the niches' backs)
    box(0, -CH - 0.2, CH + 0.5, 0.35, -1, WALL_H + 1);
    box(-(CH + DOOR_W + 0.35) / 2 - 0.0, CH + 0.2, (CH - DOOR_W - 0.35) / 2, 0.35, -1, WALL_H + 1);
    box((CH + DOOR_W + 0.35) / 2, CH + 0.2, (CH - DOOR_W - 0.35) / 2, 0.35, -1, WALL_H + 1);
    for (const sx of [-1, 1]) {
      box(sx * (CH + 0.2), 0, 0.35, CH + 0.5, 3.6, WALL_H + 1);                      // above the niches
      const cuts = NICHES.filter((n) => Math.sign(n.x) === sx).map((n) => n.z).sort((a, b) => a - b);
      let z0 = -CH;
      for (const cz of cuts) { const a = z0, b = cz - 1.15; box(sx * (CH + 0.2), (a + b) / 2, 0.35, (b - a) / 2, -1, 3.7); z0 = cz + 1.15; }
      box(sx * (CH + 0.2), (z0 + CH) / 2, 0.35, (CH - z0) / 2, -1, 3.7);
      for (const cz of cuts) box(sx * (CH + 1.3), cz, 0.3, 1.3, -1, 3.8);          // niche backs
    }
    // the dromos walls and its far end
    for (const sx of [-1, 1]) box(sx * (DW + 0.2), (CH + DROMOS_END) / 2, 0.3, (DROMOS_END - CH) / 2 + 0.3, -1, DH + 1);
    box(0, DROMOS_END + 0.5, DW + 0.5, 0.3, -1, DH + 1);
    // the coffin (the plinth is a platform), the pedestal, the braziers
    box(COFFIN.x, COFFIN.z, COFFIN.wid / 2 + 0.05, COFFIN.len / 2 + 0.05, COFFIN.plinthH - 0.3, COFFIN.plinthH + COFFIN.h);
    box(PEDESTAL.x, PEDESTAL.z, 0.6, 0.5, -0.5, PEDESTAL.h);
    for (const b of BRAZIERS) box(b.x, b.z, 0.45, 0.45, -0.5, 1.3);
    // floor + ceiling slabs: arrows stick in them (the player is never pushed: it stands above / below them)
    box(0, 0, CH + 0.5, CH + 0.5, -1.2, 0);
    box(0, (CH + DROMOS_END) / 2, DW + 0.5, (DROMOS_END - CH) / 2 + 0.5, -1.2, 0);
    // the ceiling, minus the looter's hole (arrows loosed up through it fly out)
    box(0, -CH / 2 - 1.2, CH, CH / 2 - 1.2, BEAM_Y - 0.2, PLANK_Y + 0.5);
    box(0, CH / 2 + 0.8, CH, CH / 2 - 0.8, BEAM_Y - 0.2, PLANK_Y + 0.5);
    box(-CH / 2 - 1, COFFIN.z, CH / 2 - 1, 1.6, BEAM_Y - 0.2, PLANK_Y + 0.5);
    box(CH / 2 + 1.3, COFFIN.z, CH / 2 - 1.3, 1.6, BEAM_Y - 0.2, PLANK_Y + 0.5);
    this.colliders.push(this.sealCollider);
  }

  /**
   * NALATI-MERGE P1: the interior into the world registry — the walls, ceiling and floor slabs as boxes (larch; the
   * pedestal stone, the braziers metal), the coffin plinth + a step onto it and the pedestal's step as slabs, the fallen
   * beams as capsules; the seal as a piece that follows the (still) interior group and collides only while sealed; the
   * sand drifts as a heightfield rebuilt with the drawn grid. `floorHeightAt` stays for placement.
   */
  register(registry: WorldRegistry): void {
    const Y0 = DUNGEON.y, at = (lx: number, lz: number) => ({ x: DUNGEON.x + lx, z: DUNGEON.z + lz });
    const statics = this.colliders.filter((c) => c !== this.sealCollider);
    const surfaceOf = (c: Collider): Material | undefined =>
      BRAZIERS.some((b) => Math.abs(DUNGEON.x + b.x - c.x) < 0.01 && Math.abs(DUNGEON.z + b.z - c.z) < 0.01) ? 'metal'
        : Math.abs(DUNGEON.x + PEDESTAL.x - c.x) < 0.01 && Math.abs(DUNGEON.z + PEDESTAL.z - c.z) < 0.01 ? 'stone' : undefined;
    const descs: ColliderDesc[] = statics.map((c) => boxDesc(c, surfaceOf(c)));
    const cf = at(COFFIN.x, COFFIN.z), pd = at(PEDESTAL.x, PEDESTAL.z);
    descs.push({ kind: 'box', x: cf.x, y: Y0 + COFFIN.plinthH / 2, z: cf.z, hx: COFFIN.wid / 2 + 0.65, hy: COFFIN.plinthH / 2, hz: COFFIN.len / 2 + 0.6, surface: 'wood' });
    descs.push({ kind: 'box', x: cf.x, y: Y0 + 0.11, z: cf.z, hx: COFFIN.wid / 2 + 0.95, hy: 0.11, hz: COFFIN.len / 2 + 0.9, surface: 'wood' });   // a step onto it (≤ 0.35)
    descs.push({ kind: 'box', x: pd.x, y: Y0 + 0.09, z: pd.z, hx: 0.8, hy: 0.09, hz: 0.7, surface: 'stone' });
    const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), q = new THREE.Quaternion();
    for (const f of FALLEN) {
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz), c = at((f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2);
      q.setFromUnitVectors(up, axis.set(dx / len, 0, dz / len));
      descs.push({ kind: 'capsule', x: c.x, y: Y0 + f.r, z: c.z, halfHeight: Math.max(0.05, len / 2 - f.r), radius: f.r, rot: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'wood' });
    }
    registry.add({ id: 'nalati-kurgan-dungeon', name: 'The Golden King\'s tomb', category: 'buildings', file: 'src/shards/nalati-grasslands/world/KurganDungeon.ts', surface: 'wood', colliders: descs, floor: this.floorHeightAt, solidFloor: true });
    // the seal: its box in the interior group's frame (the group stands at DUNGEON, never moves)
    registry.add({
      id: 'nalati-kurgan-seal', name: 'The sand seal', category: 'buildings', file: 'src/shards/nalati-grasslands/world/KurganDungeon.ts', surface: 'sand', follows: this.group,
      colliders: [{ kind: 'box', x: 0, y: DOOR_H / 2, z: CH + 0.1, hx: DOOR_W + 0.3, hy: DOOR_H / 2 + 1, hz: 0.25 }], active: () => this.sealed,
    });
    const ph = app.physics;
    if (ph) this.sandPatch = new HeightPatch(ph, { x: DUNGEON.x, y: Y0, z: DUNGEON.z, size: CH * 2, res: SAND_N + 1, material: 'sand', owner: this });
  }

  // ── walkable heights ──
  private floorAt(x: number, z: number): number | undefined {
    const lx = x - DUNGEON.x, lz = z - DUNGEON.z;
    const inCh = Math.abs(lx) <= CH + 1.4 && Math.abs(lz) <= CH, inDr = Math.abs(lx) <= DW + 0.2 && lz >= CH - 0.1 && lz <= DROMOS_END + 0.6;
    if (!inCh && !inDr) return undefined;
    let y = 0;
    if (inCh) {
      y = this.sandAt(lx, lz);
      // the coffin plinth
      if (Math.abs(lx - COFFIN.x) < COFFIN.wid / 2 + 0.65 && Math.abs(lz - COFFIN.z) < COFFIN.len / 2 + 0.6) y = Math.max(y, COFFIN.plinthH);
      // the pedestal's step
      if (Math.abs(lx - PEDESTAL.x) < 0.8 && Math.abs(lz - PEDESTAL.z) < 0.7) y = Math.max(y, 0.18);
      // the fallen beams (their round tops)
      for (const f of FALLEN) {
        const ax = f.a[0], az = f.a[1], bx = f.b[0], bz = f.b[1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const u = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / L2));
        const d = Math.hypot(lx - (ax + dx * u), lz - (az + dz * u));
        if (d < f.r) y = Math.max(y, f.r + Math.sqrt(f.r * f.r - d * d) - 0.02);
      }
    }
    return DUNGEON.y + y;
  }

  /** sand depth (m) at a chamber-local point */
  sandAt(lx: number, lz: number): number {
    const fx = (lx + CH) / (CH * 2) * SAND_N - 0.5, fz = (lz + CH) / (CH * 2) * SAND_N - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = (i: number, j: number) => (i < 0 || j < 0 || i >= SAND_N || j >= SAND_N ? 0 : this.sandH[j * SAND_N + i] ?? 0);
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
  }
  /** pile sand: a soft mound of radius r (m) rising by dh (m) at its centre, capped at `max` */
  addSand(lx: number, lz: number, r: number, dh: number, max = 1.0): void {
    const cell = (CH * 2) / SAND_N;
    const i0 = Math.max(0, Math.floor((lx - r + CH) / cell)), i1 = Math.min(SAND_N - 1, Math.ceil((lx + r + CH) / cell));
    const j0 = Math.max(0, Math.floor((lz - r + CH) / cell)), j1 = Math.min(SAND_N - 1, Math.ceil((lz + r + CH) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = -CH + (i + 0.5) * cell, cz = -CH + (j + 0.5) * cell, d = Math.hypot(cx - lx, cz - lz) / r;
      if (d >= 1) continue;
      const k = j * SAND_N + i;
      this.sandH[k] = Math.min(max, (this.sandH[k] ?? 0) + dh * (1 - d * d) * (1 - d * d));
    }
    this.sandDirty = true;
  }
  clearSand(): void { this.sandH.fill(0); this.sandDirty = true; }
  /** the drifts drain away (the victory): `rate` m/s */
  drainSand(dt: number, rate = 0.25): void {
    let any = false;
    for (let k = 0; k < this.sandH.length; k++) { const h = this.sandH[k] ?? 0; if (h > 0) { this.sandH[k] = Math.max(0, h - rate * dt); any = true; } }
    if (any) this.sandDirty = true;
  }

  private writeSand(): void {
    const g = this.sandMesh.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color');
    const N1 = SAND_N + 1;
    const grid = this.sandPatch ? new Float32Array(N1 * N1) : null;
    let any = false;
    for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
      const v = j * N1 + i;
      // vertex height = the mean of the (up to) four cells round it
      let s = 0, c = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) { const ci = i + di, cj = j + dj; if (ci >= 0 && cj >= 0 && ci < SAND_N && cj < SAND_N) { s += this.sandH[cj * SAND_N + ci] ?? 0; c++; } }
      const h = c > 0 ? s / c : 0;
      if (h > 0.01) any = true;
      if (grid) grid[v] = h;
      pos.setY(v, h > 0.01 ? h : -0.05);
      const k = 0.85 + 0.25 * Math.min(1, h / 0.6);
      col.setXYZ(v, C.sand.r * k * (this.sandLight[v * 3] ?? 1), C.sand.g * k * (this.sandLight[v * 3 + 1] ?? 1), C.sand.b * k * (this.sandLight[v * 3 + 2] ?? 1));
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.sandMesh.visible = any;
    if (grid) this.sandPatch?.set(grid);   // P1: the drifts are walkable as real geometry (row j = z, column i = x)
  }

  // ── state the fight drives ──
  setSealed(on: boolean): void {
    this.curtain.target = on ? 1 : 0;
    this.sealCollider.yBottom = on ? DUNGEON.y - 1 : DUNGEON.y - 51;
    this.sealCollider.yTop = on ? DUNGEON.y + DOOR_H + 1 : DUNGEON.y - 50;
  }
  get sealed(): boolean { return this.curtain.target > 0.5; }
  /** the coffin lid: 0 closed … 1 slid off and leaning on the coffin's side */
  setLid(open: number): void {
    const k = THREE.MathUtils.clamp(open, 0, 1);
    const slide = THREE.MathUtils.smoothstep(k, 0, 0.7), tip = THREE.MathUtils.smoothstep(k, 0.55, 1);
    this.lid.position.set(COFFIN.x + slide * (COFFIN.wid * 0.85), COFFIN.plinthH + COFFIN.h + 0.09 - tip * 0.75, COFFIN.z + slide * 0.2);
    this.lid.rotation.set(0, 0.06 * slide, -tip * 1.15);
  }
  setNicheStatue(i: number, on: boolean): void { const s = this.statues[i]; if (s) s.visible = on; }
  /** 0 = the looter's-hole shaft, 1 = the pedestal shaft; strength 0..1.5 (eased) */
  setShaft(i: number, strength: number): void { const s = this.shafts[i]; if (s) s.target = strength; }
  showHeap(on: boolean, lx = COFFIN.x + 1.8, lz = COFFIN.z + 2.6): void { this.heap.visible = on; this.heap.position.set(lx, this.sandAt(lx, lz), lz); }
  /** show / hide the whole interior (it lives in the sky — see the header) */
  setVisible(on: boolean): void { this.group.visible = on; }

  update(dt: number, t: number): void {
    if (!this.group.visible) return;
    for (const m of this.fx) m.uniforms.uTime.value = t;
    for (const s of this.shafts) {
      const a = s.mat.uniforms.uAlpha;
      a.value += (s.target - a.value) * Math.min(1, dt * 1.5);
      s.mesh.visible = a.value > 0.01;
    }
    const c = this.curtain;
    c.k += (c.target - c.k) * Math.min(1, dt * (c.target > c.k ? 3 : 1.2));
    c.mat.uniforms.uAlpha.value = c.k;
    c.mesh.visible = c.k > 0.02;
    this.flames.uniforms.uAlpha.value = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
    this.sandAcc += dt;
    if (this.sandDirty && this.sandAcc > 1 / 15) { this.sandAcc = 0; this.sandDirty = false; this.writeSand(); }
  }
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0, idx = 0;
  for (const p of parts) { n += p.getAttribute('position').count; idx += p.index?.count ?? 0; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), ind: number[] = [];
  let o = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position'), pn = p.getAttribute('normal'), pu = p.getAttribute('uv');
    for (let i = 0; i < pp.count; i++) {
      pos[(o + i) * 3] = pp.getX(i); pos[(o + i) * 3 + 1] = pp.getY(i); pos[(o + i) * 3 + 2] = pp.getZ(i);
      nrm[(o + i) * 3] = pn.getX(i); nrm[(o + i) * 3 + 1] = pn.getY(i); nrm[(o + i) * 3 + 2] = pn.getZ(i);
      uv[(o + i) * 2] = pu.getX(i); uv[(o + i) * 2 + 1] = pu.getY(i);
    }
    const pi = p.index;
    if (pi) for (let i = 0; i < pi.count; i++) ind.push(pi.getX(i) + o);
    o += pp.count;
    p.dispose();
  }
  void idx;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(ind);
  return g;
}
