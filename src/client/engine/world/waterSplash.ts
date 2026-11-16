/**
 * Water reacts (meta SHARD-SOURCE SS6): a mover (the player, a creature) entering, wading in or leaving a pool throws a
 * splash of droplets and spreads rings on the surface. Droplets are one `Points` draw and rings one `InstancedMesh` draw
 * for every pool together, each a fixed pool of slots reused oldest first; the phone holds half of each.
 *
 *   const splash = new WaterSplash(pools, { phone });
 *   root.add(splash.drops, splash.rings);
 *   splash.update(dt, [{ id: 'player', x, y, z }]);   // every frame
 *
 * A mover is in a pool when it stands inside the outline with its feet at most `FOOT` above the surface and no deeper
 * than `DEPTH` below it. Crossing in or out throws a burst and a wide ring (none on a teleport); averaging faster than
 * `WADE_SPEED` inside throws a small ring and a few drops every `WADE_EVERY` seconds. Both draw after the water (renderOrder 2).
 * Nothing runs on the server: it is look only.
 */
import * as THREE from 'three';

export interface SplashPool { readonly id: string; readonly level: number; readonly outline: readonly (readonly [number, number])[] }
export interface SplashMover { readonly id: string; readonly x: number; readonly y: number; readonly z: number }

/** droplet and ring slots a tier holds (the phone half) */
export const SPLASH_SLOTS = { desktop: { drops: 192, rings: 24 }, phone: { drops: 96, rings: 12 } } as const;
export const FOOT = 0.35, DEPTH = 3, WADE_SPEED = 0.6, WADE_EVERY = 0.4;
/** a step longer than this in one frame is a teleport (a respawn, a pose): it moves the mover and throws nothing */
export const TELEPORT = 2;
/** where a spent droplet waits: far under any floor, so it is never drawn in view */
const PARKED_Y = -1000;
const DROP_LIFE = 0.9, RING_LIFE = 1.3, GRAVITY = 9.8;
const BURST = { enter: 18, leave: 10, wade: 4 } as const;
const RING = { enter: [0.25, 2.2], leave: [0.2, 1.6], wade: [0.15, 1.1] } as const;
const DROP_COLOUR = new THREE.Color(0.85, 0.92, 1).multiplyScalar(0.9), RING_COLOUR = new THREE.Color(0.75, 0.85, 0.95);

/** A droplet's round, soft-edged sprite (16 px, made here: no file to load). */
function dropTexture(): THREE.DataTexture {
  const size = 16, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2), a = Math.max(0, Math.min(1, (1 - d) * 2.5));
    pixels.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Even-odd test of (x, z) against a closed outline. */
export function insideOutline(outline: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i] ?? [0, 0], [xj, zj] = outline[j] ?? [0, 0];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** mulberry32: the same stream on every host */
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

interface Wader { pool: SplashPool | null; x: number; z: number; wade: number; walked: number; seen: boolean }

export class WaterSplash {
  /** every droplet, one draw */
  readonly drops: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  /** every ring, one draw */
  readonly rings: THREE.InstancedMesh;
  private readonly random: () => number;
  private readonly dropAt: Float32Array;
  private readonly dropVelocity: Float32Array;
  private readonly dropLife: Float32Array;
  private readonly dropFloor: Float32Array;
  private readonly dropColour: Float32Array;
  private readonly ringAge: Float32Array;
  private readonly ringSpan: Float32Array;
  private readonly ringSeat: Float32Array;
  private nextDrop = 0;
  private nextRing = 0;
  private readonly waders = new Map<string, Wader>();
  private readonly matrix = new THREE.Matrix4();
  private readonly colour = new THREE.Color();

  private readonly pools: readonly SplashPool[];

  constructor(pools: readonly SplashPool[], options: { phone: boolean; seed?: number }) {
    this.pools = pools;
    const slots = options.phone ? SPLASH_SLOTS.phone : SPLASH_SLOTS.desktop;
    this.random = stream(options.seed ?? 0x5eed);
    this.dropAt = new Float32Array(slots.drops * 3);
    this.dropVelocity = new Float32Array(slots.drops * 3);
    this.dropLife = new Float32Array(slots.drops);
    this.dropFloor = new Float32Array(slots.drops);
    this.dropColour = new Float32Array(slots.drops * 3);
    for (let i = 0; i < slots.drops; i++) this.dropAt[i * 3 + 1] = PARKED_Y;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.dropAt, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.dropColour, 3).setUsage(THREE.DynamicDrawUsage));
    // additive, so no fog (fog would add the fog colour to a faded droplet); a spent droplet is black and parked far under
    this.drops = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.08, map: dropTexture(), alphaTest: 0.02, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.drops.name = 'water:splash';
    this.drops.frustumCulled = false;
    // after the water surfaces (clientWater's renderOrder 1, transparent, no depth write), so the water never blends over them
    this.drops.renderOrder = 2;
    this.ringAge = new Float32Array(slots.rings).fill(RING_LIFE);
    this.ringSpan = new Float32Array(slots.rings * 2);
    this.ringSeat = new Float32Array(slots.rings * 3);
    const ring = new THREE.RingGeometry(0.93, 1, 48, 1).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), slots.rings);
    this.rings.name = 'water:rings';
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < slots.rings; i++) { this.rings.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)); this.rings.setColorAt(i, this.colour.setRGB(0, 0, 0)); }
  }

  /** The pool a mover stands in, or null. */
  poolAt(x: number, y: number, z: number): SplashPool | null {
    for (const pool of this.pools) if (y <= pool.level + FOOT && y >= pool.level - DEPTH && insideOutline(pool.outline, x, z)) return pool;
    return null;
  }

  /** Move the movers' splashes on by `dt` seconds; a mover not in `movers` this frame is forgotten. */
  update(dt: number, movers: Iterable<SplashMover>): void {
    for (const wader of this.waders.values()) wader.seen = false;
    for (const mover of movers) this.follow(dt, mover);
    for (const [id, wader] of this.waders) if (!wader.seen) this.waders.delete(id);
    this.stepDrops(dt);
    this.stepRings(dt);
  }

  /** live droplets and rings (tests, the proof) */
  live(): { drops: number; rings: number } {
    let drops = 0, rings = 0;
    for (const life of this.dropLife) if (life > 0) drops++;
    for (const age of this.ringAge) if (age < RING_LIFE) rings++;
    return { drops, rings };
  }

  dispose(): void {
    this.drops.geometry.dispose(); this.drops.material.map?.dispose(); this.drops.material.dispose();
    this.rings.geometry.dispose(); (this.rings.material as THREE.Material).dispose(); this.rings.dispose();
  }

  private follow(dt: number, mover: SplashMover): void {
    const pool = this.poolAt(mover.x, mover.y, mover.z);
    let wader = this.waders.get(mover.id);
    if (wader === undefined) {
      // a mover first seen already in water (a spawn in the pond) throws nothing until it moves
      wader = { pool, x: mover.x, z: mover.z, wade: 0, walked: 0, seen: true };
      this.waders.set(mover.id, wader);
      return;
    }
    wader.seen = true;
    const step = Math.hypot(mover.x - wader.x, mover.z - wader.z);
    if (pool !== wader.pool) {
      // in at the new point; out at the last point still in the water
      if (step <= TELEPORT) {
        if (pool !== null) this.throw('enter', mover.x, mover.z, pool.level);
        else if (wader.pool !== null) this.throw('leave', wader.x, wader.z, wader.pool.level);
      }
      wader.wade = 0; wader.walked = 0;
    } else if (pool !== null) {
      // time and distance over the whole stretch: the player moves per fixed step, so one frame's speed flickers
      wader.wade += dt; wader.walked += Math.min(step, TELEPORT);
      if (wader.wade >= WADE_EVERY) {
        if (wader.walked / wader.wade > WADE_SPEED) this.throw('wade', mover.x, mover.z, pool.level);
        wader.wade = 0; wader.walked = 0;
      }
    }
    wader.pool = pool; wader.x = mover.x; wader.z = mover.z;
  }

  private throw(kind: keyof typeof BURST, x: number, z: number, level: number): void {
    const r = this.random, slots = this.dropLife.length;
    for (let n = 0; n < BURST[kind]; n++) {
      const i = this.nextDrop; this.nextDrop = (this.nextDrop + 1) % slots;
      const a = r() * Math.PI * 2, out = 0.6 + r() * 1.4, up = (kind === 'wade' ? 1.4 : 2.4) + r() * 1.6;
      this.dropAt.set([x + Math.cos(a) * 0.2, level + 0.05, z + Math.sin(a) * 0.2], i * 3);
      this.dropVelocity.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      this.dropLife[i] = DROP_LIFE * (0.7 + r() * 0.3); this.dropFloor[i] = level;
    }
    const k = this.nextRing; this.nextRing = (this.nextRing + 1) % this.ringAge.length;
    this.ringAge[k] = 0; this.ringSpan.set(RING[kind], k * 2); this.ringSeat.set([x, level + 0.012, z], k * 3);
  }

  private stepDrops(dt: number): void {
    let moved = false;
    for (let i = 0; i < this.dropLife.length; i++) {
      const life = this.dropLife[i] ?? 0;
      if (life <= 0) continue;
      moved = true;
      const v = i * 3, vy = (this.dropVelocity[v + 1] ?? 0) - GRAVITY * dt;
      this.dropVelocity[v + 1] = vy;
      this.dropAt[v] = (this.dropAt[v] ?? 0) + (this.dropVelocity[v] ?? 0) * dt;
      this.dropAt[v + 1] = (this.dropAt[v + 1] ?? 0) + vy * dt;
      this.dropAt[v + 2] = (this.dropAt[v + 2] ?? 0) + (this.dropVelocity[v + 2] ?? 0) * dt;
      const left = (this.dropAt[v + 1] ?? 0) < (this.dropFloor[i] ?? 0) - 0.02 ? 0 : life - dt;
      this.dropLife[i] = Math.max(0, left);
      if (left <= 0) this.dropAt[v + 1] = PARKED_Y;
      const fade = Math.max(0, left) / DROP_LIFE;
      this.dropColour[v] = DROP_COLOUR.r * fade; this.dropColour[v + 1] = DROP_COLOUR.g * fade; this.dropColour[v + 2] = DROP_COLOUR.b * fade;
    }
    // upload only while something flies (or just landed): a still pond costs no buffer upload
    if (moved) { this.drops.geometry.getAttribute('position').needsUpdate = true; this.drops.geometry.getAttribute('color').needsUpdate = true; }
  }

  private stepRings(dt: number): void {
    let moved = false;
    for (let k = 0; k < this.ringAge.length; k++) {
      const age = this.ringAge[k] ?? RING_LIFE;
      if (age >= RING_LIFE) continue;
      const next = age + dt, t = Math.min(1, next / RING_LIFE);
      this.ringAge[k] = next; moved = true;
      if (t >= 1) { this.rings.setMatrixAt(k, this.matrix.makeScale(0, 0, 0)); this.rings.setColorAt(k, this.colour.setRGB(0, 0, 0)); continue; }
      const r0 = this.ringSpan[k * 2] ?? 0, r1 = this.ringSpan[k * 2 + 1] ?? 1, radius = r0 + (r1 - r0) * Math.sqrt(t), fade = (1 - t) * (1 - t) * 0.6;
      this.matrix.makeScale(radius, 1, radius).setPosition(this.ringSeat[k * 3] ?? 0, this.ringSeat[k * 3 + 1] ?? 0, this.ringSeat[k * 3 + 2] ?? 0);
      this.rings.setMatrixAt(k, this.matrix);
      this.rings.setColorAt(k, this.colour.copy(RING_COLOUR).multiplyScalar(fade));
    }
    if (moved) { this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor !== null) this.rings.instanceColor.needsUpdate = true; }
  }
}
