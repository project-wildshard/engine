/**
 * MIRROR-SALT-ZONE MSZ14b: how a hurt vehicle looks. A worn one (its `vehicleWornRow` up, under 30% of its health) trails a
 * plume of dark smoke from its bonnet, leaning downwind; a wrecked one breaks apart where it stood: an orange flash, one cloud
 * of dark smoke, and a spray of solid chunks in its own colours that tumble out a few metres and settle on its ground. Look
 * only: nothing here reaches the server.
 *
 *   const fx = new VehicleFx(root, scope);          // two draws under `root`: the puffs and the chunks
 *   fx.smokeFrom(id, pose, dt);                     // each frame, for each worn vehicle (`FollowedVehicles.frame`)
 *   fx.burst(pose, colours);                        // once, when a wrecked vehicle's row leaves (colours: its look's)
 *   fx.frame(dt, smoking);                          // each frame, after the emitters
 *
 * The puffs are a `ParticlePool` ring of points whose per-point colour carries its alpha (a 4-wide `color`, three's vertex
 * alphas), so a puff fades in, thins out and parks; the chunks are one `InstancedMesh` of boxes, each scaled to nothing when
 * spent. Either hides with nothing alive.
 */
import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { ParticlePool } from '@wildshard/engine/fx/ParticlePool';
import type { MoverPose } from '@wildshard/format/moverPose';
import type { VehicleKind } from '@wildshard/format/vehicles';
import { panelLook, type VehicleDress } from './followedVehicles';

/** An RGB colour, 0 to 1 a channel. */
export type FxColour = readonly [number, number, number];
/** The look's numbers: a worn vehicle's puff every `every` s from `from` (the kind's frame: x right, y up, z back, so the
 *  bonnet), rising at `rise` m/s and drifting at `drift` m/s for `life` s; a burst's cloud, flash and chunks. */
export const VEHICLE_FX = {
  smoke: { every: 0.06, from: [0, 1.25, -1.0], spread: 0.35, rise: [1.4, 2.2], drift: [0.7, 0.25], life: [2.4, 3.4], alpha: 0.8, colour: [0.13, 0.12, 0.11], size: 2.2 },
  /** a wreck's cloud of dark smoke, thrown out slowly so its puffs run into one */
  blast: { count: 44, speed: [0.8, 2.4], up: [0.8, 2.2], life: [1.8, 2.8], alpha: 0.8, colour: [0.24, 0.22, 0.21] },
  /** the flash at its heart */
  flash: { count: 14, speed: [0.3, 1.4], up: [0.4, 1.4], life: [0.45, 0.7], alpha: 1, colour: [1, 0.55, 0.16] },
  /** a wreck's solid chunks: thrown out about 3 m, falling and tumbling, resting on its ground until they go */
  chunks: { count: 36, speed: [1.2, 3.4], up: [3, 5.5], life: [2.2, 3], gravity: 9.8, size: [0.14, 0.34], spin: 9, metal: [0.2, 0.2, 0.22] },
  /** the puffs: about 17 a second for 3.4 s from up to four smoking vehicles, and two bursts at once; the chunks: two bursts */
  capacity: { puffs: 352, chunks: 72 },
} as const;
/** where a spent puff waits, under any floor */
const PARKED = -1000;
/** a puff's drag (1/s): it slows as it rises and spreads */
const DRAG = 0.9;
/** the memory ledger's name for these arrays */
const OWNER = { owner: 'game/vehicle-fx' } as const;

/** A round, soft-edged sprite (16 px, made here: no file to load). */
function puffTexture(): THREE.DataTexture {
  const size = 16, pixels = ownedArray(Uint8Array, size * size * 4, { owner: 'game/vehicle-fx', asset: 'puff-texture' });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2), a = Math.max(0, Math.min(1, (1 - d) * 1.6));
    pixels.set([255, 255, 255, Math.round(a * a * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** mulberry32: the same puffs on every run */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The puffs: a pool of soft points and what each needs past the pool's own arrays, its peak alpha and its whole life. */
class Puffs {
  readonly pool: ParticlePool<'color'>;
  private readonly peak: Float32Array;
  private readonly whole: Float32Array;
  constructor(capacity: number, size: number, scope: Scope) {
    const material = scope.own(new THREE.PointsMaterial({ size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, map: scope.own(puffTexture()) }));
    this.pool = new ParticlePool({ capacity, material, renderOrder: 6, parkY: PARKED, attributes: { color: { itemSize: 4, dynamic: true } } });
    scope.own(this.pool.points.geometry);
    this.peak = ownedArray(Float32Array, capacity, OWNER); this.whole = ownedArray(Float32Array, capacity, OWNER);
    this.pool.settle(0);
  }
  /** Start a puff at `at`, moving `v`, for `life` s. */
  spawn(at: { x: number; y: number; z: number }, v: readonly [number, number, number], life: number, colour: FxColour, alpha: number): void {
    const pool = this.pool, i = pool.claim();
    pool.place(i, at); pool.vel.set(v, i * 3); pool.life[i] = life;
    pool.data.color.set([...colour, 0], i * 4);
    this.peak[i] = alpha; this.whole[i] = life;
  }
  /** Step every live puff by `dt` s: move, drag, fade in over the first 12% of its life and out over the rest; how many live. */
  step(dt: number): number {
    const { pos, vel, life, data: { color } } = this.pool, k = Math.exp(-DRAG * dt);
    let alive = 0;
    for (let i = 0; i < this.pool.capacity; i++) {
      const left = life[i] ?? 0; if (left <= 0) continue;
      const now = left - dt; life[i] = now;
      if (now <= 0) { pos[i * 3 + 1] = PARKED; color[i * 4 + 3] = 0; continue; }
      alive++;
      for (let a = 0; a < 3; a++) { vel[i * 3 + a] = (vel[i * 3 + a] ?? 0) * k; pos[i * 3 + a] = (pos[i * 3 + a] ?? 0) + (vel[i * 3 + a] ?? 0) * dt; }
      const u = 1 - now / (this.whole[i] ?? 1), fade = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88;
      color[i * 4 + 3] = (this.peak[i] ?? 0) * fade;
    }
    this.pool.posAttr.needsUpdate = true; this.pool.attr.color.needsUpdate = true;
    this.pool.settle(alive);
    return alive;
  }
}

/** A wreck's chunks: one `InstancedMesh` of boxes, each thrown, falling, tumbling and resting on its floor, shrinking away over
 *  its last 0.4 s; a spent one is scaled to nothing. */
class Chunks {
  readonly mesh: THREE.InstancedMesh;
  private readonly at: Float32Array; private readonly vel: Float32Array; private readonly spin: Float32Array; private readonly turn: Float32Array;
  private readonly size: Float32Array; private readonly life: Float32Array; private readonly floor: Float32Array;
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3(); private readonly k = new THREE.Vector3(); private readonly tint = new THREE.Color();
  readonly capacity: number;
  constructor(capacity: number, scope: Scope) {
    this.capacity = capacity;
    const geometry = scope.own(new THREE.BoxGeometry(1, 0.6, 0.8)), material = scope.own(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }));
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this.at = ownedArray(Float32Array, capacity * 3, OWNER); this.vel = ownedArray(Float32Array, capacity * 3, OWNER); this.spin = ownedArray(Float32Array, capacity * 3, OWNER); this.turn = ownedArray(Float32Array, capacity * 3, OWNER);
    this.size = ownedArray(Float32Array, capacity, OWNER); this.life = ownedArray(Float32Array, capacity, OWNER); this.floor = ownedArray(Float32Array, capacity, OWNER);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)); this.mesh.setColorAt(i, this.tint.setRGB(0, 0, 0)); }
    this.mesh.visible = false;
  }
  /** Throw a chunk from `at` at `v` m/s, turning at `spin` rad/s, `size` m across, for `life` s, resting on `floor`. */
  spawn(at: { x: number; y: number; z: number }, v: readonly [number, number, number], spin: readonly [number, number, number], size: number, life: number, colour: FxColour, floor: number): void {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.capacity;
    this.at.set([at.x, at.y, at.z], i * 3); this.vel.set(v, i * 3); this.spin.set(spin, i * 3); this.turn.fill(0, i * 3, i * 3 + 3);
    this.size[i] = size; this.life[i] = life; this.floor[i] = floor;
    this.mesh.setColorAt(i, this.tint.setRGB(...colour)); if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }
  /** Step every live chunk by `dt` s under `gravity`; how many live. */
  step(dt: number, gravity: number): number {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const left = this.life[i] ?? 0; if (left <= 0) continue;
      const now = left - dt; this.life[i] = now;
      if (now <= 0) { this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)); continue; }
      alive++;
      const o = i * 3, size = this.size[i] ?? 0, rest = (this.floor[i] ?? 0) + size * 0.3;
      if ((this.at[o + 1] ?? 0) > rest || (this.vel[o + 1] ?? 0) > 0) {
        this.vel[o + 1] = (this.vel[o + 1] ?? 0) - gravity * dt;
        for (let a = 0; a < 3; a++) { this.at[o + a] = (this.at[o + a] ?? 0) + (this.vel[o + a] ?? 0) * dt; this.turn[o + a] = (this.turn[o + a] ?? 0) + (this.spin[o + a] ?? 0) * dt; }
        if ((this.at[o + 1] ?? 0) <= rest) { this.at[o + 1] = rest; this.vel.fill(0, o, o + 3); }
      }
      this.q.setFromEuler(this.e.set(this.turn[o] ?? 0, this.turn[o + 1] ?? 0, this.turn[o + 2] ?? 0));
      this.mesh.setMatrixAt(i, this.matrix.compose(this.p.set(this.at[o] ?? 0, this.at[o + 1] ?? 0, this.at[o + 2] ?? 0), this.q, this.k.setScalar(Math.min(1, now / 0.4) * size)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (alive === 0) this.mesh.visible = false;
    return alive;
  }
}

/** A worn vehicle's smoke and a wrecked one's break-apart, for every vehicle a page follows. */
export class VehicleFx {
  /** the smoke, the bursts' clouds and flashes */
  readonly puffs: Puffs;
  /** the bursts' chunks */
  readonly chunks: Chunks;
  private readonly random: () => number;
  /** s until each smoking vehicle's next puff */
  private readonly due = new Map<string, number>();
  private alive = { puffs: 0, chunks: 0 };
  constructor(root: THREE.Object3D, scope: Scope, seed = 0x5a17) {
    this.puffs = new Puffs(VEHICLE_FX.capacity.puffs, VEHICLE_FX.smoke.size, scope);
    this.chunks = new Chunks(VEHICLE_FX.capacity.chunks, scope);
    this.puffs.pool.points.name = 'vehicle-smoke'; this.chunks.mesh.name = 'vehicle-chunks';
    root.add(this.puffs.pool.points, this.chunks.mesh);
    scope.onDispose(() => { this.puffs.pool.points.removeFromParent(); this.chunks.mesh.removeFromParent(); this.chunks.mesh.dispose(); });
    this.random = stream(seed);
  }
  /** A worn vehicle's frame of `dt` s: a puff from its bonnet when one is due, drifting downwind as it rises. */
  smokeFrom(id: string, pose: MoverPose, dt: number): void {
    const s = VEHICLE_FX.smoke, r = this.random, yaw = pose.euler.y, cos = Math.cos(yaw), sin = Math.sin(yaw), [lx, ly, lz] = s.from;
    const x = pose.position.x + lx * cos + lz * sin, z = pose.position.z - lx * sin + lz * cos;
    let left = (this.due.get(id) ?? 0) - dt;
    for (; left <= 0; left += s.every) {
      const at = { x: x + (r() - 0.5) * s.spread, y: pose.position.y + ly, z: z + (r() - 0.5) * s.spread };
      this.puffs.spawn(at, [s.drift[0] + (r() - 0.5) * 0.5, s.rise[0] + r() * (s.rise[1] - s.rise[0]), s.drift[1] + (r() - 0.5) * 0.5], s.life[0] + r() * (s.life[1] - s.life[0]), s.colour, s.alpha);
    }
    this.due.set(id, left);
  }
  /** A vehicle wrecked where `pose` stood: a flash, one cloud of dark smoke, and its chunks (in `colours`, its look's own, with
   *  bare metal among them) thrown out to fall back on its ground. */
  burst(pose: MoverPose, colours: readonly FxColour[] = []): void {
    const r = this.random, ground = pose.position.y, c = VEHICLE_FX.chunks, tints: readonly FxColour[] = [...colours, c.metal];
    const at = (spread: number): { x: number; y: number; z: number } => ({ x: pose.position.x + (r() - 0.5) * spread, y: ground + 0.5 + r() * 0.7, z: pose.position.z + (r() - 0.5) * spread });
    const pick = (range: readonly [number, number]): number => range[0] + r() * (range[1] - range[0]);
    for (const cloud of [VEHICLE_FX.blast, VEHICLE_FX.flash]) for (let i = 0; i < cloud.count; i++) {
      const a = (i / cloud.count) * Math.PI * 2 + r() * 0.4, speed = pick(cloud.speed);
      this.puffs.spawn(at(1.4), [Math.cos(a) * speed, pick(cloud.up), Math.sin(a) * speed], pick(cloud.life), cloud.colour, cloud.alpha);
    }
    for (let i = 0; i < c.count; i++) {
      const a = r() * Math.PI * 2, speed = pick(c.speed), spin: [number, number, number] = [(r() - 0.5) * c.spin, (r() - 0.5) * c.spin, (r() - 0.5) * c.spin];
      this.chunks.spawn(at(1.8), [Math.cos(a) * speed, pick(c.up), Math.sin(a) * speed], spin, pick(c.size), pick(c.life), tints[i % tints.length] ?? c.metal, ground);
    }
  }
  /** Step both by `dt` s; a vehicle that smoked no more since the last frame stops being timed. */
  frame(dt: number, smoking: ReadonlySet<string> = new Set()): void {
    for (const id of this.due.keys()) if (!smoking.has(id)) this.due.delete(id);
    this.alive = { puffs: this.puffs.step(dt), chunks: this.chunks.step(dt, VEHICLE_FX.chunks.gravity) };
  }
  /** The puffs and chunks alive after the last frame, for a probe or a test. */
  live(): { readonly puffs: number; readonly chunks: number } { return this.alive; }
}

/** MSZ14c: the look and fx a page's drawn panels lend its vehicles: a copy of each kind's panel, and the smoke and break-apart
 *  beside them under the panels' own root. Null when no kind's panel is drawn. */
export function vehicleDress(kinds: readonly VehicleKind[], panels: ReadonlyMap<string, THREE.Object3D> | undefined, scope: Scope): VehicleDress | null {
  const root = kinds.map(kind => panels?.get(kind.panel)?.parent ?? null).find(parent => parent !== null) ?? null;
  return root === null ? null : { look: panelLook(panels, scope), fx: new VehicleFx(root, scope) };
}
