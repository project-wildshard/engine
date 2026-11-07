import { GroupBrain } from '@wildshard/engine/ai/GroupBrain';
import { app } from '@wildshard/engine/app/runtime';
import { TickScheduler } from '@wildshard/engine/app/scheduler';
import { Rng } from '@wildshard/engine/core/rng';
import { TIER } from '@wildshard/engine/core/tier';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { ThinkCtx } from '@wildshard/engine/entities/species/registry';
import { PATCH_ORDER, patchShader } from '@wildshard/engine/render/shaderPatches';
import { attachFogUniforms } from '@wildshard/engine/world/Atmosphere';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import { terrainHeight as heightAt, terrainNormal as normalAt } from '@wildshard/engine/world/terrainHeight';


import * as THREE from 'three';






import type { PackPrey } from '../runtime/groupRegistry';
import { buildSheepGeometry, SHEEP_PIVOTS, SHEEP_PART_NAMES } from '../species/sheep';
import { loadCreatureRig, type RigAsset } from '../species/hulls';
import { modelsOn } from '../world/glbPaint';

import { painterlyAnimalMaterial } from '../look/creatureMaterial';
import { wildEnv, angDiff } from './env';


/**
 * Flock — the camp's sheep (docs/design/nalati/wolves-horses-taming.md "Sheep"): 20–60 fat-tailed sheep as ONE
 * InstancedMesh (one draw, one shadow draw) whose legs, head and death roll are animated in the vertex shader from a
 * per-instance `iAnim` (gait phase, ground speed, graze, dead). The flock AI is a boids layer with strong cohesion at
 * 10 Hz; positions integrate every frame.
 *
 *   const flock = new Flock(sky, { x, z, count: 36, seed }).build();  scene.add(flock.mesh)
 *   flock.update(dt, t, player.position, playerSpeed, wolves)          wolves: the living wolves (Animal[]) near it
 *   flock.dog = sheepdog                                                 the collie that herds it (species/sheepdog.ts)
 *   flock.raycast(origin, dir, maxDist) → index | -1 ;  flock.kill(i)    arrows: a sheep drops (the camp's property —
 *                                                                        the design's penalty is the caller's)
 *   flock.onSound = (name, x, z) => …                                   'sheep_bleat' (ambient, panicked), 'dog_bark'
 *   flock.positions(i, out)                                              world position of sheep i
 *   flock.prey(i) / flock.nearest(x, z)                                  B1: sheep i as a wolf pack's prey (Pack.raid —
 *                                                                        src/shards/nalati-grasslands/creatures/sheepRaid.ts); the living sheep nearest (x, z)
 *
 * Behaviour: grazing head-down with the odd shuffle; the flock drifts across its pasture (a new spot every 60–90 s,
 * within `range` m of home); a sheep > 12 m out is a straggler (the dog fetches it); a wolf within 30 m or the player
 * sprinting within 10 m / walking within 4 m panics them — they bunch and run (4.5 m/s), bleating; sheep step out of
 * the dog's way toward the flock.
 */

export interface FlockOpts { x: number; z: number; count: number; seed: number; /** m the flock may wander from home (default 45) */ range?: number }

const RUN = 4.6, WALK = 0.9, GRAZE_STEP = 0.35;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const flockOfDog = new WeakMap<Animal, Flock>();
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** the wolves the sheepdog watches for (Wildlife keeps it current) */
export const dogWolves: Animal[] = [];

/** B1: one sheep as a wolf pack's prey (Pack.raid): its position and heading read live off the flock, a bite kills it */
export class SheepPrey implements PackPrey {
  private readonly p = new THREE.Vector3();
  constructor(readonly flock: Flock, readonly index: number) {}
  get position(): THREE.Vector3 { return this.flock.positions(this.index, this.p); }
  get yaw(): number { return this.flock.headingOf(this.index); }
  get alive(): boolean { return this.flock.isAlive(this.index); }
  readonly applyDamage = (): boolean => { this.flock.kill(this.index); return true; };
}

export class Flock extends GroupBrain<SheepPrey> {
  mesh!: THREE.InstancedMesh;
  readonly n: number;
  dog: Animal | null = null;
  onSound?: ((name: string, x: number, z: number) => void) | undefined;
  cx: number; cz: number;
  /** the pasture spot the flock drifts toward */
  private tx: number; private tz: number; private tT = 0;
  private readonly homeX: number; private readonly homeZ: number; private readonly range: number;
  private px: Float32Array; private pz: Float32Array; private py: Float32Array;
  private yaw: Float32Array; private spd: Float32Array; private dspd: Float32Array; private dyaw: Float32Array;
  private phase: Float32Array; private graze: Float32Array; private dead: Uint8Array; private deadT: Float32Array;
  private shuffle: Float32Array; private scale: Float32Array;
  private panic = 0; private panicX = 0; private panicZ = 0;
  private bleatT = 2;
  private anim!: THREE.InstancedBufferAttribute;
  private rng: Rng;
  private readonly scheduler = new TickScheduler();
  private readonly tickActor = { position: new THREE.Vector3() };
  private uTime = { value: 0 };
  /** living sheep */
  alive: number;

  constructor(private readonly sky: Sky, opts: FlockOpts) {
    super([]);
    this.n = opts.count; this.alive = opts.count;
    this.cx = this.tx = this.homeX = opts.x; this.cz = this.tz = this.homeZ = opts.z; this.range = opts.range ?? 45;
    const n = this.n;
    for (let i = 0; i < n; i++) this.members.push(new SheepPrey(this, i));
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.py = new Float32Array(n);
    this.yaw = new Float32Array(n); this.spd = new Float32Array(n); this.dspd = new Float32Array(n); this.dyaw = new Float32Array(n);
    this.phase = new Float32Array(n); this.graze = new Float32Array(n); this.dead = new Uint8Array(n); this.deadT = new Float32Array(n);
    this.shuffle = new Float32Array(n); this.scale = new Float32Array(n);
    this.rng = new Rng(opts.seed);
  }

  static ofDog(dog: Animal): Flock | null { return flockOfDog.get(dog) ?? null; }
  /** make `dog` this flock's sheepdog */
  setDog(dog: Animal): void { this.dog = dog; flockOfDog.set(dog, this); }

  build(): this {
    const geo = buildSheepGeometry();
    // the shared painterly material + the flock's vertex animation: a sibling program ('…|nalati-sheep'), the one
    // exception to painterly's "no onBeforeCompile" rule — 40 GPU-animated sheep for one draw are worth one program
    const mat = painterlyAnimalMaterial(this.sky);
    patchSheep(mat, this.uTime, false);
    const mesh = new THREE.InstancedMesh(geo, mat, this.n);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchSheep(depth, this.uTime, true);
    mesh.customDepthMaterial = depth;
    // the phone's shadow map skips the flock (40 sheep ≈ 0.1 M tris a frame into it); desktop casts
    mesh.castShadow = TIER !== 'phone'; mesh.receiveShadow = true;
    mesh.name = 'sheep-flock';
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 4), 4);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', this.anim);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // wool colours: mostly cream, some fawn, brown and a few near-black (sheep-1 mockup)
    const wool = [new THREE.Color(1, 1, 1), new THREE.Color(0.86, 0.74, 0.58), new THREE.Color(0.52, 0.36, 0.26), new THREE.Color(0.30, 0.22, 0.18)];
    const rng = this.rng;
    for (let i = 0; i < this.n; i++) {
      let x = this.homeX, z = this.homeZ;
      for (let k = 0; k < 20; k++) {
        const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 11;
        x = this.homeX + Math.cos(a) * r; z = this.homeZ + Math.sin(a) * r;
        let ok = inChunk(x, z, 10);
        for (let j = 0; j < i && ok; j++) if (Math.hypot((this.px[j] ?? 0) - x, (this.pz[j] ?? 0) - z) < 1.1) ok = false;
        if (ok) break;
      }
      this.px[i] = x; this.pz[i] = z; this.py[i] = heightAt(x, z);
      this.yaw[i] = this.dyaw[i] = rng.range(0, Math.PI * 2);
      this.phase[i] = rng.next(); this.graze[i] = rng.next() < 0.7 ? 1 : 0;
      this.shuffle[i] = rng.range(0, 8);
      this.scale[i] = rng.range(0.88, 1.08);
      const r = rng.next();
      mesh.setColorAt(i, wool[r < 0.62 ? 0 : r < 0.8 ? 1 : r < 0.93 ? 2 : 3] ?? new THREE.Color(1, 1, 1));
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(this.homeX, this.py[0] ?? 0, this.homeZ), 30);
    this.mesh = mesh;
    this.writeInstances();
    // Debug ▸ Creatures = Models (the default): the generated sheep, baked onto the flock's parts (scripts/nalati-rig-bake.mjs), swapped in when
    // it loads — the procedural flock stands in until then
    if (modelsOn('creatures')) loadCreatureRig('sheep').then((rig) => { this.useRig(rig, mat); return null; }).catch((e: unknown) => { console.warn('[nalati] sheep rig failed', e); });
    return this;
  }

  /** the flock's geometry from a baked rig: its skin folded into aRig (the two strongest parts), the atlas as the map */
  private useRig(rig: RigAsset, mat: THREE.MeshLambertMaterial): void {
    if (rig.joints.length !== SHEEP_PART_NAMES.length || rig.joints.some((j, i) => j.name !== SHEEP_PART_NAMES[i])) { console.warn('[nalati] sheep rig: not the flock parts'); return; }
    const src = rig.geometry, si = src.getAttribute('skinIndex'), sw = src.getAttribute('skinWeight'), n = si.count;
    const aRig = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let a = 0, wa = -1, b = 0, wb = -1;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c), k = si.getComponent(i, c);
        if (w > wa) { b = a; wb = wa; a = k; wa = w; } else if (w > wb) { b = k; wb = w; }
      }
      const t = wa + Math.max(0, wb);
      aRig[i * 3] = a; aRig[i * 3 + 1] = wb > 0 ? b : a; aRig[i * 3 + 2] = t > 0 && wb > 0 ? wb / t : 0;
    }
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color'] as const) g.setAttribute(k, src.getAttribute(k));
    g.setAttribute('aRig', new THREE.BufferAttribute(aRig, 3));
    g.setAttribute('iAnim', this.anim);
    const index = src.getIndex();
    if (index) g.setIndex(index);
    g.computeBoundingSphere();
    const old = this.mesh.geometry;
    this.mesh.geometry = g;
    old.dispose();
    mat.map = rig.map; mat.needsUpdate = true;
  }

  positions(i: number, out: THREE.Vector3): THREE.Vector3 { return out.set(this.px[i] ?? 0, (this.py[i] ?? 0) + 0.6, this.pz[i] ?? 0); }
  /** sheep i's heading (animal yaw) and whether it lives */
  headingOf(i: number): number { return this.yaw[i] ?? 0; }
  isAlive(i: number): boolean { return i >= 0 && i < this.n && this.dead[i] === 0; }
  /** B1: sheep i as a wolf pack's prey (Pack.raid): live position / heading, a bite kills it */
  prey(i: number): SheepPrey { return new SheepPrey(this, i); }
  /** the living sheep nearest (x, z) — the one a raid from that side reaches first — or -1 */
  nearest(x: number, z: number): number {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) continue;
      const d = Math.hypot((this.px[i] ?? 0) - x, (this.pz[i] ?? 0) - z);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  /** the sheep index a ray hits (a 0.42 m body sphere + a 0.14 m head sphere per sheep), or -1 */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): number {
    let best = maxDist, bi = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) continue;
      const s = this.scale[i] ?? 1, yw = this.yaw[i] ?? 0;
      for (const [off, up, r] of [[0, 0.6, 0.36], [0.62, 0.66, 0.14]] as const) {
        _p.set((this.px[i] ?? 0) + Math.sin(yw) * off * s, (this.py[i] ?? 0) + up * s, (this.pz[i] ?? 0) + Math.cos(yw) * off * s);
        const t = raySphere(o, d, _p, r * s);
        if (t >= 0 && t < best) { best = t; bi = i; }
      }
    }
    return bi;
  }

  /** a sheep dies (arrow, wolf): it rolls over in the shader; the flock panics away from it */
  kill(i: number): void {
    if (this.dead[i] === 1) return;
    this.dead[i] = 1; this.deadT[i] = 0; this.alive--;
    this.scare(this.px[i] ?? 0, this.pz[i] ?? 0, 6);
    this.onSound?.('sheep_bleat', this.px[i] ?? 0, this.pz[i] ?? 0);
  }

  /** panic the flock away from (x, z) for `secs` */
  scare(x: number, z: number, secs: number): void { this.panic = Math.max(this.panic, secs); this.panicX = x; this.panicZ = z; }

  update(dt: number, t: number, player: THREE.Vector3, playerSpeed: number, wolves: readonly Animal[]): void {
    this.scheduler.beginFrame(dt, player);
    this.tickActor.position.set(this.cx, heightAt(this.cx, this.cz), this.cz);
    const brainDt = this.scheduler.takeBrainDt('ai', this.tickActor);
    if (brainDt > 0) this.think(brainDt, player, playerSpeed, wolves);
    const bodyDt = this.scheduler.bodyDt('ai', this.tickActor);
    if (bodyDt === 0) return;
    this.uTime.value = t;
    const near = Math.hypot(player.x - this.cx, player.z - this.cz) < 160;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) { this.deadT[i] = Math.min(1, (this.deadT[i] ?? 0) + bodyDt / 0.7); continue; }
      // steer + speed
      const dy = angDiff(this.dyaw[i] ?? 0, this.yaw[i] ?? 0);
      const turn = (this.spd[i] ?? 0) > 2 ? 3.5 : 1.6;
      this.yaw[i] = (this.yaw[i] ?? 0) + THREE.MathUtils.clamp(dy, -turn * bodyDt, turn * bodyDt);
      const sp = (this.spd[i] ?? 0) + THREE.MathUtils.clamp((this.dspd[i] ?? 0) - (this.spd[i] ?? 0), -6 * bodyDt, 4 * bodyDt);
      this.spd[i] = sp;
      if (sp > 0.01) {
        const nx = (this.px[i] ?? 0) + Math.sin(this.yaw[i] ?? 0) * sp * bodyDt, nz = (this.pz[i] ?? 0) + Math.cos(this.yaw[i] ?? 0) * sp * bodyDt;
        // the shard's water (the river corridor, the brook): stop at the edge and turn for home
        if (wildEnv.wetAt?.(nx + Math.sin(this.yaw[i] ?? 0) * 0.8, nz + Math.cos(this.yaw[i] ?? 0) * 0.8) === true) {
          this.dyaw[i] = Math.atan2(this.homeX - nx, this.homeZ - nz); this.spd[i] = 0; continue;
        }
        this.px[i] = nx;
        this.pz[i] = nz;
        this.phase[i] = ((this.phase[i] ?? 0) + (bodyDt * sp) / (0.42 + 0.12 * sp)) % 1;
        if (near) this.py[i] = heightAt(this.px[i] ?? 0, this.pz[i] ?? 0);
      }
      const gTarget = sp < 0.2 && this.panic <= 0 && (this.shuffle[i] ?? 0) > 0.5 ? 1 : 0;
      this.graze[i] = (this.graze[i] ?? 0) + (gTarget - (this.graze[i] ?? 0)) * Math.min(1, bodyDt * 2.5);
    }
    this.writeInstances();
  }

  private think(dt: number, player: THREE.Vector3, playerSpeed: number, wolves: readonly Animal[]): void {
    const rng = this.rng;
    // centre + spread
    let x = 0, z = 0, k = 0;
    for (let i = 0; i < this.n; i++) if (this.dead[i] === 0) { x += this.px[i] ?? 0; z += this.pz[i] ?? 0; k++; }
    if (k === 0) return;
    this.cx = x / k; this.cz = z / k;
    if (this.mesh.boundingSphere !== null) { this.mesh.boundingSphere.center.set(this.cx, heightAt(this.cx, this.cz), this.cz); this.mesh.boundingSphere.radius = 30; }
    // the drift target
    this.tT -= dt;
    if (this.tT <= 0) {
      this.tT = rng.range(60, 90);
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(8, this.range);
        const tx = this.homeX + Math.cos(a) * r, tz = this.homeZ + Math.sin(a) * r;
        if (inChunk(tx, tz, 25) && normalAt(tx, tz)[1] > 0.85 && wildEnv.wetAt?.(tx, tz) !== true) { this.tx = tx; this.tz = tz; break; }
      }
    }
    // threats: wolves within 30 m, a sprinting / close player
    const dP = Math.hypot(player.x - this.cx, player.z - this.cz);
    for (const w of wolves) {
      if (!w.alive) continue;
      if (Math.hypot(w.position.x - this.cx, w.position.z - this.cz) < 30) { this.scare(w.position.x, w.position.z, 5); break; }
    }
    // B9 stealth (src/shards/nalati-grasslands/stealth.ts): a crouched player creeping through long grass (≥ 0.7 m) gets to 3 m before a sheep bolts
    const creeping = wildEnv.playerCrouched && playerSpeed <= 2.6 && wildEnv.grassHeightAt(player.x, player.z) >= 0.7;
    if ((playerSpeed > 5.2 && dP < 16) || (playerSpeed > 0.5 && dP < (creeping ? 3 : 6))) this.scare(player.x, player.z, 3);
    this.panic = Math.max(0, this.panic - dt);
    const panicking = this.panic > 0;
    // drift direction for the whole flock (slow)
    const tdx = this.tx - this.cx, tdz = this.tz - this.cz, td = Math.hypot(tdx, tdz);
    const drift = td > 4 ? 1 : 0;
    const dog = this.dog;
    const dogX = dog?.alive === true ? dog.position.x : 1e9, dogZ = dog?.alive === true ? dog.position.z : 1e9;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) continue;
      const sx = this.px[i] ?? 0, sz = this.pz[i] ?? 0;
      let vx = 0, vz = 0, speed = 0;
      // separation (1.1 m) — only near neighbours; an O(n²) pass over ≤ 60 sheep at 10 Hz is ~3600 checks, cheap
      let sepX = 0, sepZ = 0;
      for (let j = 0; j < this.n; j++) {
        if (j === i || this.dead[j] === 1) continue;
        const ox = sx - (this.px[j] ?? 0), oz = sz - (this.pz[j] ?? 0);
        const d2 = ox * ox + oz * oz;
        if (d2 < 1.2 * 1.2 && d2 > 1e-6) { const d = Math.sqrt(d2); sepX += (ox / d) * (1.2 - d); sepZ += (oz / d) * (1.2 - d); }
      }
      const cdx = this.cx - sx, cdz = this.cz - sz, cd = Math.hypot(cdx, cdz) || 1;
      const dogD = Math.hypot(sx - dogX, sz - dogZ);
      const pD = Math.hypot(sx - player.x, sz - player.z);
      if (panicking) {
        // run from the scare, bunched: away + strong cohesion
        const ax = sx - this.panicX, az = sz - this.panicZ, ad = Math.hypot(ax, az) || 1;
        vx = (ax / ad) * 1.2 + (cdx / cd) * 0.7 + sepX * 2; vz = (az / ad) * 1.2 + (cdz / cd) * 0.7 + sepZ * 2;
        speed = RUN * (0.85 + 0.3 * (((i * 0.618) % 1)));
        this.shuffle[i] = 0;
      } else if (dogD < 5) {
        // out of the dog's way, toward the flock
        vx = (sx - dogX) / dogD + (cdx / cd) * 1.2; vz = (sz - dogZ) / dogD + (cdz / cd) * 1.2; speed = 2.4;
      } else if (pD < 3.2) {
        vx = (sx - player.x) / pD; vz = (sz - player.z) / pD; speed = 1.4;
      } else if (cd > 9) {
        vx = cdx / cd + sepX; vz = cdz / cd + sepZ; speed = WALK * (cd > 14 ? 1.6 : 1);
      } else if (Math.hypot(sepX, sepZ) > 0.3) {
        vx = sepX; vz = sepZ; speed = 0.6;
      } else {
        // grazing: stand head-down, shuffle a step now and then, drift with the flock
        this.shuffle[i] = (this.shuffle[i] ?? 0) - dt;
        if ((this.shuffle[i] ?? 0) < 0) {
          vx = drift > 0 ? tdx / td + (rng.next() - 0.5) : Math.sin((this.yaw[i] ?? 0) + rng.range(-1, 1)); vz = drift > 0 ? tdz / td + (rng.next() - 0.5) : Math.cos(this.yaw[i] ?? 0);
          speed = drift > 0 ? GRAZE_STEP * 1.6 : GRAZE_STEP;
          if ((this.shuffle[i] ?? 0) < -rng.range(1.2, 3)) this.shuffle[i] = rng.range(3, 12);
        }
      }
      if ((this.spd[i] ?? 0) > 0.01) this.py[i] = heightAt(sx, sz);   // (per frame too while the player is near)
      if (speed > 0 && Math.hypot(vx, vz) > 1e-4) { this.dyaw[i] = Math.atan2(vx, vz); this.dspd[i] = speed; }
      else this.dspd[i] = 0;
      // keep in the chunk
      if (!inChunk(sx, sz, 12)) { this.dyaw[i] = Math.atan2(-sx, -sz); this.dspd[i] = Math.max(this.dspd[i] ?? 0, 1); }
      if ((this.dspd[i] ?? 0) > 1.5) wildEnv.trample(sx, sz, 0.35, 0.4, Math.sin(this.dyaw[i] ?? 0) * 2, Math.cos(this.dyaw[i] ?? 0) * 2);
    }
    // bleats: now and then near the player, a chorus while panicking
    this.bleatT -= dt;
    if (this.bleatT <= 0 && dP < 70) {
      this.bleatT = panicking ? rng.range(0.3, 0.9) : rng.range(2.5, 7);
      const i = rng.int(0, this.n - 1);
      if (this.dead[i] === 0) this.onSound?.('sheep_bleat', this.px[i] ?? 0, this.pz[i] ?? 0);
    }
  }

  /** a straggler for the dog: the living sheep farthest from the centre past `minD` m, or -1 */
  straggler(minD = 12): number {
    let bi = -1, bd = minD;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) continue;
      const d = Math.hypot((this.px[i] ?? 0) - this.cx, (this.pz[i] ?? 0) - this.cz);
      if (d > bd) { bd = d; bi = i; }
    }
    return bi;
  }
  get panicking(): boolean { return this.panic > 0; }

  private writeInstances(): void {
    const a = this.anim.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const s = this.scale[i] ?? 1;
      _q.setFromAxisAngle(_y, this.yaw[i] ?? 0);
      _p.set(this.px[i] ?? 0, (this.py[i] ?? 0) - 0.02, this.pz[i] ?? 0);
      _s.set(s, s, s);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      a[i * 4] = this.phase[i] ?? 0;
      a[i * 4 + 1] = this.spd[i] ?? 0;
      a[i * 4 + 2] = this.graze[i] ?? 0;
      a[i * 4 + 3] = this.dead[i] === 1 ? smooth(this.deadT[i] ?? 0) : 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
  }
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : -1;
}

/**
 * The flock's vertex animation, patched into the (painterly) material and the shadow depth material: each vertex
 * swings about its part's pivot (aRig: part a, part b, weight of b) by an angle from the instance's iAnim.
 */
function patchSheep(mat: THREE.Material, uTime: { value: number }, depthOnly: boolean): void {
  const piv = SHEEP_PIVOTS.map((p) => `vec3(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`).join(', ');
  patchShader(mat, depthOnly ? 'nalati.sheep-depth' : 'nalati.sheep', PATCH_ORDER.decorate, (shader) => {
    attachFogUniforms(shader);
    shader.uniforms['uSheepTime'] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aRig;
        attribute vec4 iAnim;
        uniform float uSheepTime;
        const vec3 SHEEP_PIV[7] = vec3[7](${piv});
        float sheepAngle(float b, vec4 an, float seed) {
          float walk = min(an.y * 0.34, 0.62);
          if (b < 0.5) return 0.0;
          if (b < 1.5) return an.z * (1.35 + 0.07 * sin(uSheepTime * 5.0 + seed * 3.7)) - walk * 0.12 * sin(an.x * 12.566);
          if (b < 5.5) {
            float off = b < 2.5 ? 0.25 : (b < 3.5 ? 0.75 : (b < 4.5 ? 0.0 : 0.5));
            return sin((an.x + off) * 6.2832) * walk * (b < 3.5 ? 1.0 : 0.85);
          }
          return 0.08 * sin(an.x * 12.566) * walk;
        }
        vec3 sheepRot(vec3 q, float ang) { float c = cos(ang), s = sin(ang); return vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c); }
        vec3 sheepPos(vec3 p) {
          float seed = float(gl_InstanceID);
          float b0 = aRig.x, b1 = aRig.y;
          vec3 p0 = SHEEP_PIV[int(b0)] + sheepRot(p - SHEEP_PIV[int(b0)], sheepAngle(b0, iAnim, seed));
          vec3 p1 = SHEEP_PIV[int(b1)] + sheepRot(p - SHEEP_PIV[int(b1)], sheepAngle(b1, iAnim, seed));
          vec3 r = mix(p0, p1, aRig.z);
          r.y += iAnim.y > 0.1 ? 0.018 * min(iAnim.y, 3.0) * abs(sin(iAnim.x * 6.2832)) : 0.004 * sin(uSheepTime * 1.4 + seed);
          // dead: roll onto the left side about a pivot at the flank
          float d = -iAnim.w * 1.5;
          vec3 q = r - vec3(0.3, 0.0, 0.0);
          r = vec3(0.3, 0.0, 0.0) + vec3(q.x * cos(d) - q.y * sin(d), q.x * sin(d) + q.y * cos(d), q.z);
          return r;
        }
        vec3 sheepNrm(vec3 n) {
          float seed = float(gl_InstanceID);
          vec3 n0 = sheepRot(n, sheepAngle(aRig.x, iAnim, seed)), n1 = sheepRot(n, sheepAngle(aRig.y, iAnim, seed));
          vec3 r = normalize(mix(n0, n1, aRig.z));
          float d = -iAnim.w * 1.5;
          return vec3(r.x * cos(d) - r.y * sin(d), r.x * sin(d) + r.y * cos(d), r.z);
        }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = sheepPos( vec3( position ) );');
    if (!depthOnly) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = sheepNrm( vec3( normal ) );');
    // the wool colour (the instance colour) tints only the fleece: with the generated sheep's atlas the dark face and
    // legs stay dark instead of every sheep's face taking the wool (a near-black ewe's face was pitch)
    if (!depthOnly) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
      { float woolL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ); diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, smoothstep( 0.05, 0.18, woolL ) ); }
      #endif`);
  }, { key: (k) => `${k}|nalati-sheep${depthOnly ? '-depth' : ''}` });
}

/** SpeciesDef.think for the sheepdog: circle the flock, fetch stragglers, face down wolves */
export function thinkSheepdog(a: Animal, c: ThinkCtx): void {
  const f = Flock.ofDog(a);
  if (f === null || !a.alive) { a.setMotion(a.yaw, 0, 1); return; }
  const m = a.mem;
  m['barkT'] = (m['barkT'] ?? 0) - c.dt;
  const px = a.position.x, pz = a.position.z;
  // a wolf near the flock: run at it and bark (keeps between, never closes)
  let wolf: Animal | null = null, wd = 35;
  for (const w of dogWolves) {
    if (!w.alive) continue;
    const d = Math.hypot(w.position.x - f.cx, w.position.z - f.cz);
    if (d < wd) { wd = d; wolf = w; }
  }
  if (wolf !== null) {
    const tx = (wolf.position.x + f.cx) / 2, tz = (wolf.position.z + f.cz) / 2;
    c.steer(a, c.pathYaw(a, tx, tz, 0.8), Math.hypot(tx - px, tz - pz) > 3 ? 7.5 : 0, 5);
    a.lookTarget.copy(wolf.position); a.lookWeight = 1; a.state = 'alert'; m['snarl'] = 1; m['low'] = 0.4;
    if ((m['barkT'] ?? 0) <= 0) { m['barkT'] = 0.5 + app.rng.stream('ai').next() * 0.6; f.onSound?.('dog_bark', px, pz); }
    c.confine(a); return;
  }
  m['snarl'] = 0;
  // fetch a straggler: get round behind it, the sheep walks away from the dog toward the flock
  const s = f.straggler(12);
  if (s >= 0) {
    f.positions(s, _p);
    const ox = _p.x - f.cx, oz = _p.z - f.cz, od = Math.hypot(ox, oz) || 1;
    const bx = _p.x + (ox / od) * 3.5, bz = _p.z + (oz / od) * 3.5;
    const bd = Math.hypot(bx - px, bz - pz);
    m['low'] = 0.8;
    a.state = 'stalk';
    if (bd > 1) c.steer(a, bd > 4 ? c.pathYaw(a, bx, bz, 1) : Math.atan2(bx - px, bz - pz), bd > 8 ? 7.5 : 3, 5); else a.setMotion(Math.atan2(-ox, -oz), 0, 3);
    a.lookTarget.set(_p.x, _p.y, _p.z); a.lookWeight = 0.8;
    c.confine(a); return;
  }
  // circle the flock at a trot, now and then lie watching
  m['low'] = 0;
  m['rest'] = (m['rest'] ?? 0) - c.dt;
  if ((m['rest'] ?? 0) > 0) { a.setMotion(Math.atan2(f.cx - px, f.cz - pz), 0, 2); a.state = 'idle'; a.lookTarget.set(f.cx, a.position.y, f.cz); a.lookWeight = 0.5; c.confine(a); return; }
  if ((m['rest'] ?? 0) < -20 && app.rng.stream('ai').next() < 0.02) m['rest'] = 6 + app.rng.stream('ai').next() * 8;
  const R = 16;
  const ang = Math.atan2(px - f.cx, pz - f.cz) + 0.35;
  const tx = f.cx + Math.sin(ang) * R, tz = f.cz + Math.cos(ang) * R;
  a.state = 'wander';
  c.steer(a, c.pathYaw(a, tx, tz, 2), 3.4, 3);
  const pd = a.position.distanceTo(c.player);
  a.lookTarget.copy(c.player); a.lookWeight = pd < 6 ? 0.8 : 0;
  c.confine(a);
}

function inChunk(x: number, z: number, margin = 0): boolean { return Math.abs(x) <= 250 - margin && Math.abs(z) <= 250 - margin; }
