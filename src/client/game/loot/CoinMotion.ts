import * as THREE from 'three';
import { coinModel } from './coinModel';
import { burstCount, coinShare } from '../../../shared/game/loot/coinAmounts';
import { readCoinBurstState, type CoinBurstState } from '../../../shared/game/loot/coinBurstState';

const POOL = 48;                 // coins in flight at once (a captain = 12; a crab melee = a few)
const SCALE = 2.6;               // coinModel is a 7 cm coin: in flight it has to read at 6 m on a phone
const GRAVITY = 13;
const ARC_TIME = 0.42;           // s of free arc before the magnet takes over
const MAGNET_ACCEL = 60;         // m/s² toward the chest
const MAGNET_MAX = 22;           // m/s
const CATCH_R = 1.2;             // m from the hip: counted — before it can fill the lens
const MAX_LIFE = 2.6;            // s: counted anyway
const CHEST_Y = 0.75;            // m over the player's feet: the hip, under the view, so the coins sweep in low
// E314 stage 2 (Jake: the coins still read big in the last 1–2 m): inside SHRINK_R of the eye a coin shrinks on an
// ease-in curve to MIN_SCALE at NEAR_EYE, so the last two metres show a small coin (≈ 4 cm at 2 m) dropping under the view
const SHRINK_R = 4.5;            // m from the eye: the shrink starts
const NEAR_EYE = 1.0;            // m from the eye: fully shrunk (a coin is counted at CATCH_R from the hip, about here)
const MIN_SCALE = 0.12;          // of SCALE

/** a coin's size factor at `near` metres from the eye: 1 past SHRINK_R, easing in to MIN_SCALE at NEAR_EYE */
export function nearScale(near: number): number {
  if (near >= SHRINK_R) return 1;
  const f = Math.max(0, (near - NEAR_EYE) / (SHRINK_R - NEAR_EYE));
  return MIN_SCALE + (1 - MIN_SCALE) * f ** 1.6;
}

interface Coin {
  live: boolean;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  spinRate: number;
  value: number;
  burst: Burst;
}
interface Burst { left: number; onCoin: (n: number) => void; onDone: (() => void) | undefined }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _to = new THREE.Vector3();

export class CoinMotion {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private coins: Coin[] = [];
  private live = 0;

  /** The continuation owner lends the cosmetic stream without creating it eagerly. */
  constructor(private scene: THREE.Scene, private readonly random: () => number) {
    const geo = coinModel(0xc01);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: true, color: new THREE.Color(1.25, 1.12, 0.8) });
    mat.name = 'loot-coin';
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.name = 'loot-coins';
    this.mesh.frustumCulled = false; // the coins move; the mesh's own sphere is stale
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) {
      this.coins.push({ live: false, age: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0, spinRate: 0, value: 0, burst: { left: 0, onCoin: () => undefined, onDone: undefined } });
    }
    scene.add(this.mesh);
  }

  get inFlight(): number { return this.live; }

  /** `total` coins' worth out of `at` (a body's feet); `onCoin(share)` as each lands, `onDone()` after the last */
  spawn(at: THREE.Vector3, total: number, onCoin: (n: number) => void, onDone?: () => void): void {
    const count = burstCount(total);
    if (count <= 0) return;
    const burst: Burst = { left: 0, onCoin, onDone };
    const turn = this.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const c = this.coins.find((k) => !k.live);
      const share = coinShare(total, count, i);
      if (!c) { onCoin(share); continue; } // the pool is full: count it at once
      const a = turn + (i / count) * Math.PI * 2 + (this.random() - 0.5) * 0.6, out = 1.4 + this.random() * 1.4;
      c.live = true; c.age = 0; c.value = share; c.burst = burst;
      c.pos.set(at.x, at.y + 0.7, at.z);
      c.vel.set(Math.cos(a) * out, 4.2 + this.random() * 1.6, Math.sin(a) * out);
      c.spin = this.random() * Math.PI * 2; c.spinRate = 9 + this.random() * 6;
      burst.left++; this.live++;
    }
    if (burst.left === 0) onDone?.();
  }

  update(dt: number, player: THREE.Vector3): void {
    if (this.live === 0) { this.mesh.count = 0; return; }
    const tx = player.x, ty = player.y + CHEST_Y, tz = player.z, ey = player.y + 1.6;
    let n = 0;
    for (const c of this.coins) {
      if (!c.live) continue;
      c.age += dt;
      if (c.age < ARC_TIME) {
        c.vel.y -= GRAVITY * dt;
      } else {
        _to.set(tx - c.pos.x, ty - c.pos.y, tz - c.pos.z);
        const d = _to.length();
        if (d < CATCH_R || c.age > MAX_LIFE) { this.land(c); continue; }
        _to.multiplyScalar(1 / d);
        c.vel.multiplyScalar(Math.max(0, 1 - 5 * dt)).addScaledVector(_to, MAGNET_ACCEL * dt);
        const sp = c.vel.length();
        if (sp > MAGNET_MAX) c.vel.multiplyScalar(MAGNET_MAX / sp);
        if (sp * dt > d) { this.land(c); continue; } // it would overshoot this frame
      }
      c.pos.addScaledVector(c.vel, dt);
      c.spin += c.spinRate * dt;
      _q.setFromEuler(_e.set(0.35, c.spin, 0));
      const near = Math.hypot(tx - c.pos.x, ey - c.pos.y, tz - c.pos.z);
      _s.setScalar(SCALE * nearScale(near));
      _m.compose(c.pos, _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Numeric continuation only. The caller owns the meaning of each award sink. */
  snapshot(): CoinBurstState {
    const groups: Burst[] = [];
    const coins = this.coins.map(c => {
      if (!c.live) return null;
      let group = groups.indexOf(c.burst);
      if (group < 0) { group = groups.length; groups.push(c.burst); }
      return { age: c.age, pos: [c.pos.x, c.pos.y, c.pos.z] as [number, number, number],
        vel: [c.vel.x, c.vel.y, c.vel.z] as [number, number, number], spin: c.spin, spinRate: c.spinRate, value: c.value, group };
    });
    const a = this.mesh.instanceMatrix.array;
    return { version: 1, coins, groups: groups.map(group => group.left),
      matrix: Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length)), count: this.mesh.count };
  }

  /** Restore silently after validating the whole pool, then borrow the original
   * award callbacks from the continuation owner. No random draw or payout runs. */
  restore(input: unknown, resolve: (group: number) => { onCoin: (n: number) => void; onDone?: () => void }): void {
    const saved = readCoinBurstState(input);
    const groups = saved.groups.map((left, index): Burst => {
      const callbacks = resolve(index);
      if (typeof callbacks.onCoin !== 'function' || callbacks.onDone !== undefined && typeof callbacks.onDone !== 'function')
        throw new TypeError('Coin burst continuation requires its original award callbacks');
      return { left, onCoin: callbacks.onCoin, onDone: callbacks.onDone };
    });
    this.live = 0;
    for (const [i, c] of this.coins.entries()) {
      const row = saved.coins[i];
      c.live = row !== null && row !== undefined;
      if (row === null || row === undefined) continue;
      const group = groups[row.group];
      if (group === undefined) throw new Error('Validated coin group is missing');
      c.age = row.age; c.pos.fromArray(row.pos); c.vel.fromArray(row.vel);
      c.spin = row.spin; c.spinRate = row.spinRate; c.value = row.value; c.burst = group; this.live++;
    }
    const a = this.mesh.instanceMatrix.array;
    new Uint32Array(a.buffer, a.byteOffset, a.length).set(saved.matrix);
    this.mesh.count = saved.count; this.mesh.instanceMatrix.needsUpdate = true;
  }

  private land(c: Coin): void {
    c.live = false; this.live--;
    c.burst.onCoin(c.value);
    if (--c.burst.left === 0) c.burst.onDone?.();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
