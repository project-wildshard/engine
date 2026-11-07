import { app } from '../app/runtime';
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { worldTime } from '../../../shared/engine/core/time';
import { lin } from '../math/color';
import { floorBelow } from '../../../shared/engine/physics/query';

/**
 * Impacts — the sword's contact debris (Driftwood C4): one pooled InstancedMesh of tiny faceted chunks (POOL instances,
 * ONE draw call, unlit — the chunks live half a second and read by colour and motion, and the bright sparks feed the
 * bloom), spawned per material:
 *
 *   'sand'   a puff of pale grains kicked up at a struck animal's feet (boar, bear, monkey on the beach)
 *   'wood'   splinters (the drowned sailor's waterlogged timbers)
 *   'shell'  red-and-white shell shards (the reef crab)
 *   'sparks' hot white-yellow sparks, gravity-light and fast (the iron blade on shell or timber)
 *   'dirt'   dark forest earth and needle litter (a bolt into Pine Hollow's ground, PH-F1; Old Blackpaw leaving his cave)
 *   'stone'  grey granite chips (a bolt glancing off the Ridge's rock, PH-F1)
 *
 *   const impacts = Impacts.for(game);                  // one per game; built into the scene at boot (so it is precompiled)
 *   impacts.burst('shell', point, dir, 10);             // dir = the blow's direction (the chunks fly along it + up)
 *
 * Every chunk has velocity, gravity, drag, spin, a floor it settles on (PHYSICS P7: the world surface under the burst —
 * the deck, the rock, the sand — found by one ray down at spawn; no world or none within reach: a little under the point),
 * and shrinks out over its life. Runs on `worldTime.realDt` (keeps flying through a hit-stop). The pool is a ring: the
 * oldest chunk is recycled. No allocations after construction.
 */

export type ImpactKind = 'sand' | 'wood' | 'shell' | 'sparks' | 'dirt' | 'stone';

const POOL = 128;
/** the floor ray starts this far over the burst point and reaches this far under it */
const FLOOR_UP = 0.1, FLOOR_DOWN = 3;
const GRAVITY: Record<ImpactKind, number> = { sand: 7, wood: 11, shell: 12, sparks: 4, dirt: 9, stone: 13 };
const LIFE: Record<ImpactKind, [number, number]> = { sand: [0.35, 0.6], wood: [0.5, 0.9], shell: [0.5, 0.9], sparks: [0.18, 0.35], dirt: [0.4, 0.75], stone: [0.45, 0.8] };
const SPEED: Record<ImpactKind, [number, number]> = { sand: [0.8, 2.2], wood: [1.6, 3.4], shell: [1.8, 3.6], sparks: [3.5, 7], dirt: [1.0, 2.6], stone: [2.0, 4.0] };
const SIZE: Record<ImpactKind, [number, number]> = { sand: [0.02, 0.045], wood: [0.025, 0.06], shell: [0.03, 0.06], sparks: [0.012, 0.022], dirt: [0.02, 0.05], stone: [0.02, 0.045] };
const DRAG: Record<ImpactKind, number> = { sand: 3.5, wood: 1.2, shell: 1.0, sparks: 2.2, dirt: 2.6, stone: 0.9 };
/** linear colours (sparks > 1: they bloom) */
const COLOURS: Record<ImpactKind, THREE.Color[]> = {
  sand: [lin(0xe8d6a8), lin(0xd9c290), lin(0xf2e6c4)],
  wood: [lin(0x8a6a44), lin(0x6e5236), lin(0xb08a5a)],
  shell: [lin(0xd8573c), lin(0xf0e6d8), lin(0xb8402c)],
  sparks: [lin(0xffe7a8, 5), lin(0xfff6dc, 6), lin(0xffc070, 4)],
  dirt: [lin(0x3a2c1e), lin(0x4d3a26), lin(0x6b5433), lin(0x5a4a2a)],
  stone: [lin(0x8c8a84), lin(0x6f6d68), lin(0xa8a59c)],
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Impacts {
  private static byGame = new WeakMap<Game, Impacts>();
  /** Diagnostic reads never install an impact system or allocate its pool. */
  static count(game: Game): number {
    return Impacts.byGame.get(game)?.mesh.count ?? 0;
  }
  static for(game: Game): Impacts {
    let fx = Impacts.byGame.get(game);
    if (fx === undefined) { const made = new Impacts(game.scene); fx = made; Impacts.byGame.set(game, made); game.onUpdate(() => { made.update(worldTime.realDt); }, 'world.impacts'); }
    return fx;
  }

  readonly mesh: THREE.InstancedMesh;
  private pos = new Float32Array(POOL * 3); private vel = new Float32Array(POOL * 3);
  private rot = new Float32Array(POOL * 3); private spin = new Float32Array(POOL * 3);
  private life = new Float32Array(POOL); private life0 = new Float32Array(POOL); private size = new Float32Array(POOL);
  private floor = new Float32Array(POOL); private grav = new Float32Array(POOL); private drag = new Float32Array(POOL); private streak = new Uint8Array(POOL);
  private next = 0; private live = 0;
  private seed = 12345;

  private constructor(scene: THREE.Scene) {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(1, 0.6, 0.8); // a chip, not a gem
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(g, mat, POOL);
    this.mesh.name = 'impacts';
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < POOL; i++) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); this.mesh.setColorAt(i, white); }
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  private rand(): number { this.seed = (Math.imul(this.seed, 1103515245) + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }
  private range(r: [number, number]): number { return r[0] + (r[1] - r[0]) * this.rand(); }

  /** `n` chunks of `kind` at `point`, flung along `dir` (normalised or not; its horizontal part matters) and up */
  burst(kind: ImpactKind, point: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    const cols = COLOURS[kind];
    const dl = Math.hypot(dir.x, dir.z) || 1, dx = dir.x / dl, dz = dir.z / dl;
    const physics = app.physics;
    const hit = physics ? floorBelow(physics, point.x, point.z, point.y + FLOOR_UP, FLOOR_UP + FLOOR_DOWN) : undefined;
    // a ray that starts inside something (sparks off a bulkhead's face) says nothing
    const floor = hit !== undefined && hit < point.y + FLOOR_UP - 0.01 ? hit : point.y - (kind === 'sand' ? 0.05 : 0.9);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % POOL;
      const j = i * 3;
      this.pos[j] = point.x; this.pos[j + 1] = point.y; this.pos[j + 2] = point.z;
      const sp = this.range(SPEED[kind]);
      const a = (this.rand() - 0.5) * 2.4;                               // spread either side of the blow
      const ca = Math.cos(a), sa = Math.sin(a);
      const hx = dx * ca - dz * sa, hz = dx * sa + dz * ca;
      const up = kind === 'sand' ? 0.9 + this.rand() * 0.8 : 0.4 + this.rand() * 0.9;
      this.vel[j] = hx * sp * 0.8; this.vel[j + 1] = up * sp * 0.7; this.vel[j + 2] = hz * sp * 0.8;
      this.rot[j] = this.rand() * 6.3; this.rot[j + 1] = this.rand() * 6.3; this.rot[j + 2] = this.rand() * 6.3;
      const spinK = kind === 'sparks' ? 0 : 14;
      this.spin[j] = (this.rand() - 0.5) * spinK; this.spin[j + 1] = (this.rand() - 0.5) * spinK; this.spin[j + 2] = (this.rand() - 0.5) * spinK;
      const l = this.range(LIFE[kind]); this.life[i] = l; this.life0[i] = l;
      this.size[i] = this.range(SIZE[kind]); this.streak[i] = kind === 'sparks' ? 1 : 0;
      this.floor[i] = floor;
      this.grav[i] = GRAVITY[kind]; this.drag[i] = DRAG[kind];
      const c = cols[Math.floor(this.rand() * cols.length)] ?? cols[0];
      if (c !== undefined) this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.live = Math.min(POOL, this.live + n);
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let alive = 0, top = 0;
    for (let i = 0; i < POOL; i++) {
      const l0 = this.life[i] ?? 0;
      if (l0 <= 0) continue;
      const l = l0 - dt; this.life[i] = l;
      const j = i * 3;
      if (l <= 0) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      alive++; top = i + 1;
      const drag = Math.exp(-(this.drag[i] ?? 0) * dt);
      let vx = (this.vel[j] ?? 0) * drag, vy = (this.vel[j + 1] ?? 0) - (this.grav[i] ?? 0) * dt, vz = (this.vel[j + 2] ?? 0) * drag;
      const px = (this.pos[j] ?? 0) + vx * dt, pz = (this.pos[j + 2] ?? 0) + vz * dt;
      let py = (this.pos[j + 1] ?? 0) + vy * dt;
      const fl = this.floor[i] ?? -1e9;
      if (py < fl) { py = fl; vy = vy < -1 ? -vy * 0.25 : 0; vx *= 0.5; vz *= 0.5; }
      this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz; this.pos[j] = px; this.pos[j + 1] = py; this.pos[j + 2] = pz;
      for (let a = 0; a < 3; a++) this.rot[j + a] = (this.rot[j + a] ?? 0) + (this.spin[j + a] ?? 0) * dt;
      const k = l / (this.life0[i] ?? 1);                                  // 1 → 0 over the life
      const s = (this.size[i] ?? 0) * (k < 0.35 ? k / 0.35 : 1);            // shrink out over the last third
      _e.set(this.rot[j] ?? 0, this.rot[j + 1] ?? 0, this.rot[j + 2] ?? 0);
      // sparks: stretched along their velocity (a streak), the rest tumble
      if (this.streak[i] === 1) {
        const v = Math.hypot(vx, vy, vz) || 1;
        _q.setFromUnitVectors(_s.set(0, 1, 0), _p.set(vx / v, vy / v, vz / v));
        _m.compose(_p.set(px, py, pz), _q, _s.set(s, s * (2 + v * 0.9), s));
      } else _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e), _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
    }
    this.live = alive;
    this.mesh.count = alive > 0 ? top : 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
