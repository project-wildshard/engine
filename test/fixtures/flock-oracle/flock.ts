// Generated mechanically from shipping.txt by capture.ts; the source hash fences the oracle.
import * as THREE from 'three';
import { Rng } from '../../../src/shared/engine/core/rng';
import { TickScheduler } from '../../../src/shared/engine/app/scheduler';
export interface OracleThreat { alive: boolean; position: THREE.Vector3 }
export interface OracleOpts { x: number; z: number; count: number; seed: number; range?: number }
export interface OraclePorts { heightAt(x: number, z: number): number; normalAt(x: number, z: number): readonly [number, number, number]; wetAt(x: number, z: number): boolean; playerCrouched: boolean; grassHeightAt(x: number, z: number): number; trample(x: number, z: number, radius: number, strength: number, vx: number, vz: number): void; centre(x: number, y: number, z: number): void }
const RUN = 4.6, WALK = 0.9, GRAZE_STEP = 0.35;
function angleDifference(a: number, b: number): number { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function inChunk(x: number, z: number, margin = 0): boolean { return Math.abs(x) <= 250 - margin && Math.abs(z) <= 250 - margin; }
export class ShippingFlock {
  readonly n: number;
  dog: OracleThreat | null = null;
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
  private rng: Rng;
  private readonly scheduler = new TickScheduler();
  private readonly tickActor = { position: new THREE.Vector3() };
  private uTime = { value: 0 };
  readonly wool: number[] = [];
  alive: number;
  constructor(private readonly ports: OraclePorts, opts: OracleOpts) {
    this.n = opts.count; this.alive = opts.count;
    this.cx = this.tx = this.homeX = opts.x; this.cz = this.tz = this.homeZ = opts.z; this.range = opts.range ?? 45;
    const n = this.n;
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.py = new Float32Array(n);
    this.yaw = new Float32Array(n); this.spd = new Float32Array(n); this.dspd = new Float32Array(n); this.dyaw = new Float32Array(n);
    this.phase = new Float32Array(n); this.graze = new Float32Array(n); this.dead = new Uint8Array(n); this.deadT = new Float32Array(n);
    this.shuffle = new Float32Array(n); this.scale = new Float32Array(n);
    this.rng = new Rng(opts.seed);
  }

  initialize(): void {
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
      this.px[i] = x; this.pz[i] = z; this.py[i] = this.ports.heightAt(x, z);
      this.yaw[i] = this.dyaw[i] = rng.range(0, Math.PI * 2);
      this.phase[i] = rng.next(); this.graze[i] = rng.next() < 0.7 ? 1 : 0;
      this.shuffle[i] = rng.range(0, 8);
      this.scale[i] = rng.range(0.88, 1.08);
      const r = rng.next();
      this.wool[i] = r < 0.62 ? 0 : r < 0.8 ? 1 : r < 0.93 ? 2 : 3;
    }
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

  update(dt: number, t: number, player: THREE.Vector3, playerSpeed: number, wolves: readonly OracleThreat[]): void {
    this.scheduler.beginFrame(dt, player);
    this.tickActor.position.set(this.cx, this.ports.heightAt(this.cx, this.cz), this.cz);
    const brainDt = this.scheduler.takeBrainDt('ai', this.tickActor);
    if (brainDt > 0) this.think(brainDt, player, playerSpeed, wolves);
    const bodyDt = this.scheduler.bodyDt('ai', this.tickActor);
    if (bodyDt === 0) return;
    this.uTime.value = t;
    const near = Math.hypot(player.x - this.cx, player.z - this.cz) < 160;
    for (let i = 0; i < this.n; i++) {
      if (this.dead[i] === 1) { this.deadT[i] = Math.min(1, (this.deadT[i] ?? 0) + bodyDt / 0.7); continue; }
      // steer + speed
      const dy = angleDifference(this.dyaw[i] ?? 0, this.yaw[i] ?? 0);
      const turn = (this.spd[i] ?? 0) > 2 ? 3.5 : 1.6;
      this.yaw[i] = (this.yaw[i] ?? 0) + THREE.MathUtils.clamp(dy, -turn * bodyDt, turn * bodyDt);
      const sp = (this.spd[i] ?? 0) + THREE.MathUtils.clamp((this.dspd[i] ?? 0) - (this.spd[i] ?? 0), -6 * bodyDt, 4 * bodyDt);
      this.spd[i] = sp;
      if (sp > 0.01) {
        const nx = (this.px[i] ?? 0) + Math.sin(this.yaw[i] ?? 0) * sp * bodyDt, nz = (this.pz[i] ?? 0) + Math.cos(this.yaw[i] ?? 0) * sp * bodyDt;
        // the shard's water (the river corridor, the brook): stop at the edge and turn for home
        if (this.ports.wetAt?.(nx + Math.sin(this.yaw[i] ?? 0) * 0.8, nz + Math.cos(this.yaw[i] ?? 0) * 0.8) === true) {
          this.dyaw[i] = Math.atan2(this.homeX - nx, this.homeZ - nz); this.spd[i] = 0; continue;
        }
        this.px[i] = nx;
        this.pz[i] = nz;
        this.phase[i] = ((this.phase[i] ?? 0) + (bodyDt * sp) / (0.42 + 0.12 * sp)) % 1;
        if (near) this.py[i] = this.ports.heightAt(this.px[i] ?? 0, this.pz[i] ?? 0);
      }
      const gTarget = sp < 0.2 && this.panic <= 0 && (this.shuffle[i] ?? 0) > 0.5 ? 1 : 0;
      this.graze[i] = (this.graze[i] ?? 0) + (gTarget - (this.graze[i] ?? 0)) * Math.min(1, bodyDt * 2.5);
    }
  }

  private think(dt: number, player: THREE.Vector3, playerSpeed: number, wolves: readonly OracleThreat[]): void {
    const rng = this.rng;
    // centre + spread
    let x = 0, z = 0, k = 0;
    for (let i = 0; i < this.n; i++) if (this.dead[i] === 0) { x += this.px[i] ?? 0; z += this.pz[i] ?? 0; k++; }
    if (k === 0) return;
    this.cx = x / k; this.cz = z / k;
    this.ports.centre(this.cx, this.ports.heightAt(this.cx, this.cz), this.cz);
    // the drift target
    this.tT -= dt;
    if (this.tT <= 0) {
      this.tT = rng.range(60, 90);
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(8, this.range);
        const tx = this.homeX + Math.cos(a) * r, tz = this.homeZ + Math.sin(a) * r;
        if (inChunk(tx, tz, 25) && this.ports.normalAt(tx, tz)[1] > 0.85 && this.ports.wetAt?.(tx, tz) !== true) { this.tx = tx; this.tz = tz; break; }
      }
    }
    // threats: wolves within 30 m, a sprinting / close player
    const dP = Math.hypot(player.x - this.cx, player.z - this.cz);
    for (const w of wolves) {
      if (!w.alive) continue;
      if (Math.hypot(w.position.x - this.cx, w.position.z - this.cz) < 30) { this.scare(w.position.x, w.position.z, 5); break; }
    }
    // B9 stealth (src/shards/nalati-grasslands/stealth.ts): a crouched player creeping through long grass (≥ 0.7 m) gets to 3 m before a sheep bolts
    const creeping = this.ports.playerCrouched && playerSpeed <= 2.6 && this.ports.grassHeightAt(player.x, player.z) >= 0.7;
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
      if ((this.spd[i] ?? 0) > 0.01) this.py[i] = this.ports.heightAt(sx, sz);   // (per frame too while the player is near)
      if (speed > 0 && Math.hypot(vx, vz) > 1e-4) { this.dyaw[i] = Math.atan2(vx, vz); this.dspd[i] = speed; }
      else this.dspd[i] = 0;
      // keep in the chunk
      if (!inChunk(sx, sz, 12)) { this.dyaw[i] = Math.atan2(-sx, -sz); this.dspd[i] = Math.max(this.dspd[i] ?? 0, 1); }
      if ((this.dspd[i] ?? 0) > 1.5) this.ports.trample(sx, sz, 0.35, 0.4, Math.sin(this.dyaw[i] ?? 0) * 2, Math.cos(this.dyaw[i] ?? 0) * 2);
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

  state(): object { return { n: this.n, alive: this.alive, cx: this.cx, cz: this.cz, tx: this.tx, tz: this.tz, tT: this.tT, panic: this.panic, panicX: this.panicX, panicZ: this.panicZ, bleatT: this.bleatT, wool: [...this.wool], px: [...this.px], pz: [...this.pz], py: [...this.py], yaw: [...this.yaw], spd: [...this.spd], dspd: [...this.dspd], dyaw: [...this.dyaw], phase: [...this.phase], graze: [...this.graze], dead: [...this.dead], deadT: [...this.deadT], shuffle: [...this.shuffle], scale: [...this.scale], time: this.uTime.value, rng: this.rng.snapshot() }; }
}
