/**
 * The ambient flock (G466 H6): perched, wheeling, flushed and guiding flyers driven from one row
 * (`@wildshard/format/ambientLife#AmbientFlockSchema`). Render-free and server-safe: the caller draws `birds`
 * (`@wildshard/engine/game/ambient/ambientFlock` packs them into one posed draw) and voices `calls`.
 *
 * States: perched (head turns, the odd hop) → flushed by the player (a takeoff curve away from them, into a loop)
 * → wheeling on harmonic loops (`CirclingFlyer.wheel`) → landing on a free perch → perched. A row with no
 * `wheeling` keeps idle birds hidden. `guide(player, tx, tz)` borrows the formation's birds far from the player and
 * flies them past the player toward (tx, tz) on one quadratic through the row's start / pass / end offsets, then
 * back into a loop (`guide.after`) or hidden. Driftwood's gulls and Pine Hollow's breadcrumb ravens are its rows.
 *
 */
import { Rng } from '../core/rng';
import { CirclingFlyer, type AmbientWheelOrbit } from './ambientFlight';
import { terrainHeight } from '../world/terrainHeight';
import type { AmbientFlockData } from '@wildshard/format/ambientLife';

/** Hidden 0 · Perched 1 · Hop 2 · Takeoff 3 · Wheel 4 · Landing 5 · Guide 6 */
export type AmbientFlockState = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** One flyer's pose and rig channels (flap, wing fold, head yaw, leg tuck, head pitch / peck, body upright), read by the drawer. */
export interface AmbientFlockBird {
  state: AmbientFlockState; x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  flap: number; fold: number; head: number; legs: number; peck: number; body: number;
  perch: number; loop: AmbientWheelOrbit; phase: number; scale: number; altOff: number;
  t: number; dur: number; timer: number; flush: number; flapT: number; burst: number; glide: number;
  headFrom: number; headTo: number; headT: number; headDur: number;
  ax: number; ay: number; az: number; bx: number; by: number; bz: number; tx: number; ty: number; tz: number; yaw0: number; call: boolean;
}
interface Point { x: number; y: number; z: number }
/** A perch in the content's local frame. */
export interface AmbientPerch { readonly x:number;readonly y:number;readonly z:number }
/** Current player position; private visitor state belongs to its content owner. */
export interface AmbientFlockPlayer { readonly x:number;readonly y:number;readonly z:number }
/** a voice this frame: where, which cue, how loud */
export interface AmbientFlockCall extends Point { cue: string; gain: number }
const HIDDEN = 0, PERCHED = 1, HOP = 2, TAKEOFF = 3, WHEEL = 4, LANDING = 5, GUIDE = 6;
const TAU = Math.PI * 2;
/** A data-driven flock; `update` once a frame, then draw `birds` (hidden ones excepted) and voice `calls`. */
export class AmbientFlock {
  readonly birds: AmbientFlockBird[] = [];
  /** voices this frame (borrowed until the next update) */
  readonly calls: AmbientFlockCall[] = [];
  private readonly flight: CirclingFlyer;
  private readonly rng: Rng;
  private readonly loops: AmbientWheelOrbit[] = [];
  private readonly perchYaw: number[];
  private readonly occupied: Int8Array;
  private readonly pool: AmbientFlockCall[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0, cue: '', gain: 1 }));
  private readonly p: Point = { x: 0, y: 0, z: 0 };
  private readonly q: Point = { x: 0, y: 0, z: 0 };
  private time = 0;
  private callTimer: number;
  readonly row: AmbientFlockData;
  private readonly perches: readonly AmbientPerch[];
  private readonly heightAt: (x: number, z: number) => number;

  /** `heightAt` defaults to the installed terrain (`world/terrainHeight`). */
  constructor(row: AmbientFlockData, perches: readonly AmbientPerch[] = [], heightAt: (x: number, z: number) => number = terrainHeight) {
    if(row.scavenge!==null||row.visit!==null)throw new Error('Scavenge and visit require a content owner');
    this.row = row; this.perches = perches; this.heightAt = heightAt;
    const rng = this.rng = new Rng(row.seed), w = row.wheeling, pr = row.perch;
    this.flight = new CirclingFlyer(row.flight, w?.wheel, row.wingbeats);
    this.callTimer = row.call?.first ?? 0;
    this.perchYaw = perches.map(() => rng.range(0, TAU));
    this.occupied = new Int8Array(perches.length);
    if (w !== null) w.loops.forEach(([ox, oz], i) => {
      const r = w.radius * rng.range(...w.loopRadius), speed = rng.range(...w.speed) / r;
      this.loops.push({ cx: w.centre.x + ox * w.radius, cz: w.centre.z + oz * w.radius, r, alt: rng.range(...w.altitude), w: speed * (i % 2 ? -1 : 1), p1: rng.range(0, 6.28), p2: rng.range(0, 6.28), p3: rng.range(0, 6.28), p4: rng.range(0, 6.28) });
    });
    const n = Math.min(row.count, w === null || pr === null ? row.count : perches.length + 16);
    const perched = pr === null ? 0 : Math.min(perches.length, Math.round(n * pr.share));
    const order = perches.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i), oi = order[i] ?? 0, oj = order[j] ?? 0; order[i] = oj; order[j] = oi; }
    for (let i = 0; i < n; i++) {
      const b: AmbientFlockBird = {
        state: w === null ? HIDDEN : WHEEL, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, flap: 0.12, fold: 0, head: 0, legs: 1, peck: 0, body: 0,
        perch: -1, loop: this.loopAt(i), phase: rng.range(0, 6.28), scale: w === null ? 1 : rng.range(...w.bodyScale), altOff: w === null ? 0 : rng.range(...w.bodyAltitude),
        t: 0, dur: 1, timer: w === null ? 0 : rng.range(...w.perchAfter), flush: pr === null ? 0 : pr.flush * rng.range(...pr.flushJitter),
        flapT: 0, burst: 0, glide: rng.range(1, 4), headFrom: 0, headTo: 0, headT: 1, headDur: 1,
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, tx: 0, ty: 0, tz: 0, yaw0: 0, call: false,
      };
      const perch = order[i];
      if (i < perched && perch !== undefined) this.perchOn(b, perch);
      else if (w !== null) { b.t = rng.range(0, 100); this.flight.wheel(b.loop, b, this.time, this.p); b.x = this.p.x; b.y = this.p.y; b.z = this.p.z; }
      this.birds.push(b);
    }
  }

  private loopAt(i: number): AmbientWheelOrbit {
    return this.loops[i % Math.max(1, this.loops.length)] ?? { cx: 0, cz: 0, r: 1, alt: 0, w: 0, p1: 0, p2: 0, p3: 0, p4: 0 };
  }
  private call(x: number, y: number, z: number, cue = this.row.call?.cue, gain = 1): void {
    const c = this.pool[this.calls.length];
    if (c === undefined || cue === undefined) return;
    c.x = x; c.y = y; c.z = z; c.cue = cue; c.gain = gain; this.calls.push(c);
  }
  private perchOn(b: AmbientFlockBird, perch: number): void {
    const p = this.perches[perch], pr = this.row.perch;
    if (p === undefined || pr === null) return;
    this.occupied[perch] = 1;
    b.perch = perch; b.state = PERCHED; b.x = p.x; b.y = p.y + this.row.foot; b.z = p.z;
    b.yaw = this.perchYaw[perch] ?? 0; b.pitch = 0; b.roll = 0; b.flap = -0.3; b.fold = 0.2; b.legs = 0; b.head = 0;
    b.t = 0; b.timer = this.rng.range(...pr.idle); b.headFrom = b.headTo = 0; b.headT = 1; b.headDur = 1;
  }
  private freePerch(b: AmbientFlockBird, player: Point, clear: number): number {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.perches.length; i++) {
      const p = this.perches[i];
      if (this.occupied[i] || p === undefined || Math.hypot(p.x - player.x, p.z - player.z) < clear) continue;
      const score = Math.hypot(p.x - b.x, p.z - b.z) * (0.5 + this.rng.next());
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  private wings(b: AmbientFlockBird, dt: number): void { [b.flap, b.fold] = this.flight.burst(b, dt, b.flap, b.fold, this.row.wingbeat, this.rng, true); }
  private headTurn(b: AmbientFlockBird, dt: number, head: { rate: number; range: number; duration: readonly [number, number] }): void {
    b.headT += dt / b.headDur;
    if (b.headT >= 1) {
      b.head = b.headTo;
      if (this.rng.next() < dt * head.rate) { b.headFrom = b.head; b.headTo = this.rng.range(-head.range, head.range); b.headT = 0; b.headDur = this.rng.range(...head.duration); }
    } else { const u = b.headT; b.head = b.headFrom + (b.headTo - b.headFrom) * u * u * (3 - 2 * u); }
  }
  private rejoin(b: AmbientFlockBird): void {
    b.loop = this.loopAt(this.rng.int(0, Math.max(0, this.loops.length - 1))); b.phase = this.rng.range(0, 6.28);
  }
  private takeoff(b: AmbientFlockBird, player: Point): void {
    const pr = this.row.perch, w = this.row.wheeling;
    if (pr === null || w === null) return;
    if (b.perch >= 0) this.occupied[b.perch] = 0;
    b.perch = -1;
    let ax = b.x - player.x, az = b.z - player.z;
    const d = Math.hypot(ax, az) || 1; ax /= d; az /= d;
    b.ax = b.x; b.ay = b.y; b.az = b.z; b.bx = b.x + ax * pr.takeoff.out; b.by = b.y + pr.takeoff.up; b.bz = b.z + az * pr.takeoff.out;
    this.rejoin(b);
    b.state = TAKEOFF; b.t = 0; b.dur = pr.takeoff.duration; b.legs = 0; b.burst = pr.takeoff.beats; b.flapT = 0;
    b.timer = this.rng.range(...w.perchAfter);
    this.call(b.x, b.y, b.z);
  }
  private land(b: AmbientFlockBird, perch: number): void {
    const p = this.perches[perch], pr = this.row.perch;
    if (p === undefined || pr === null) return;
    this.occupied[perch] = 1; b.perch = perch;
    b.ax = b.x; b.ay = b.y; b.az = b.z; b.tx = p.x; b.ty = p.y + this.row.foot; b.tz = p.z;
    const d = Math.hypot(b.tx - b.x, b.tz - b.z, b.ty - b.y);
    b.bx = b.x + Math.sin(b.yaw) * d * 0.45; b.bz = b.z + Math.cos(b.yaw) * d * 0.45; b.by = Math.max(b.y, b.ty + pr.landing.rise) + d * 0.08;
    b.state = LANDING; b.t = 0; b.dur = Math.max(pr.landing.minimum, d / pr.landing.speed); b.burst = 0; b.glide = 0.5;
  }
  private bez(b: AmbientFlockBird, cx: number, cy: number, cz: number, u: number, out: Point): Point {
    const v = 1 - u, w0 = v * v, w1 = 2 * v * u, w2 = u * u;
    out.x = b.ax * w0 + b.bx * w1 + cx * w2; out.y = b.ay * w0 + b.by * w1 + cy * w2; out.z = b.az * w0 + b.bz * w1 + cz * w2;
    return out;
  }
  private move(b: AmbientFlockBird, to: Point, dt: number, bank: number): void {
    this.flight.face(b, to.x - b.x, to.y - b.y, to.z - b.z, dt, bank); b.x = to.x; b.y = to.y; b.z = to.z;
  }

  /** One frame: every bird's state, then this frame's `calls`. */
  update(dt: number, player: AmbientFlockPlayer): void {
    this.calls.length = 0;
    if (dt <= 0) return;
    this.time += dt;
    const { perch: pr, wheeling: w, guide: gd } = this.row, p = this.p, q = this.q;
    let flying = 0;
    for (const b of this.birds) {
      switch (b.state) {
        case PERCHED: {
          if (pr === null) break;
          if (Math.hypot(b.x - player.x, b.z - player.z) < b.flush && b.t > pr.settle) { this.takeoff(b, player); break; }
          b.t += dt; this.headTurn(b, dt, pr.head);
          b.flap += (-0.3 - b.flap) * Math.min(1, dt * 5); b.fold += (0.2 - b.fold) * Math.min(1, dt * 5);
          b.timer -= dt;
          if (b.timer <= 0) {
            b.timer = this.rng.range(...pr.every);
            if (this.rng.next() < pr.hop.chance) { b.state = HOP; b.t = 0; b.dur = pr.hop.duration; b.yaw0 = b.yaw; b.ay = b.y; b.head = b.headTo = b.headFrom = 0; b.headT = 1; b.bx = this.rng.range(-pr.hop.turn, pr.hop.turn); }
          }
          break;
        }
        case HOP: {
          if (pr === null) break;
          b.t += dt;
          const u = Math.min(1, b.t / b.dur), s = Math.sin(u * Math.PI);
          b.y = b.ay + s * pr.hop.height; b.yaw = b.yaw0 + b.bx * u; b.flap = -0.3 + s * 0.8; b.fold = 0.2; b.legs = s * 0.5;
          if (u >= 1) { b.state = PERCHED; b.y = b.ay; }
          break;
        }
        case TAKEOFF: {
          b.t += dt;
          const u = Math.min(1, b.t / b.dur);
          this.flight.wheel(b.loop, b, this.time, q);
          this.move(b, this.bez(b, q.x, q.y, q.z, u * u * (3 - 2 * u), p), dt, pr?.takeoff.bank ?? 0.35);
          b.legs += (1 - b.legs) * Math.min(1, dt * 2); this.wings(b, dt);
          if (u >= 1) { b.state = WHEEL; b.glide = 0; }
          flying++;
          break;
        }
        case WHEEL: {
          if (w === null) { b.state = HIDDEN; break; }
          this.flight.wheel(b.loop, b, this.time, p);
          this.move(b, p, dt, w.bank); b.legs = 1; this.wings(b, dt);
          b.timer -= dt;
          if (b.timer <= 0 && pr !== null) { const k = this.freePerch(b, player, pr.clear); if (k >= 0) this.land(b, k); else b.timer = 5; }
          flying++;
          break;
        }
        case GUIDE: {
          if (gd === null) break;
          b.t += dt;
          const u = Math.max(0, Math.min(1, b.t / b.dur));
          this.move(b, this.bez(b, b.tx, b.ty, b.tz, u, p), dt, gd.bank); this.wings(b, dt);
          if (b.call && gd.call !== null && u > gd.call) { b.call = false; this.call(b.x, b.y, b.z); }
          if (u >= 1) this.endGuide(b);
          flying++;
          break;
        }
        case LANDING: {
          if (pr === null) break;
          b.t += dt;
          const u = Math.min(1, b.t / b.dur), e = u < 0.5 ? 2 * u * u : 1 - (2 * (1 - u) * (1 - u)) * 0.85 - 0.15 * (1 - u);
          this.move(b, this.bez(b, b.tx, b.ty, b.tz, e, p), dt, pr.landing.bank);
          if (u > pr.landing.flare) {
            b.legs += (0 - b.legs) * Math.min(1, dt * 4); b.pitch += (0.45 - b.pitch) * Math.min(1, dt * 3);
            if (b.burst === 0 && b.glide > 0.2) { b.burst = 3; b.flapT = 0; }
          }
          this.wings(b, dt);
          if (u >= 1) { this.perchOn(b, b.perch); b.roll = 0; }
          flying++;
          break;
        }
        case HIDDEN: break;
        default: break;
      }
    }
    const call = this.row.call;
    if (call === null) return;
    this.callTimer -= dt;
    if (this.callTimer > 0) return;
    this.callTimer = this.rng.range(...call.every);
    const k = this.rng.int(0, this.birds.length - 1);
    let b = this.birds[k];
    if (b === undefined || b.state === HIDDEN) return;
    if (flying > 0 && b.state === PERCHED) for (let j = 0; j < this.birds.length; j++) { const h = this.birds[(k + j) % this.birds.length]; if (h?.state === WHEEL) { b = h; break; } }
    this.call(b.x, b.y, b.z);
  }

  /** Borrow the formation's birds (idle ones at least `guide.borrow` from the player) and fly them past the player
   *  toward (tx, tz). false = no guide row, too near, or too few free birds. */
  guide(player: Point, tx: number, tz: number): boolean {
    const gd = this.row.guide;
    if (gd === null) return false;
    let dx = tx - player.x, dz = tz - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1) return false;
    dx /= dist; dz /= dist;
    const rx = dz, rz = -dx, h = this.heightAt, gy = Math.max(player.y, h(player.x, player.z));
    const sx = player.x - dx * gd.start[0] + rx * gd.start[1], sz = player.z - dz * gd.start[0] + rz * gd.start[1], sy = Math.max(gy, h(sx, sz)) + gd.start[2];
    const px = player.x + dx * gd.pass[0] + rx * gd.pass[1], pz = player.z + dz * gd.pass[0] + rz * gd.pass[1], py = gy + gd.pass[2];
    const L = Math.min(gd.end.max, Math.max(gd.end.min, dist));
    let ground = gy;
    for (let k = 1; k <= 6; k++) { const f = (L * k) / 6; ground = Math.max(ground, h(player.x + dx * f, player.z + dz * f)); }
    const ex = player.x + dx * L, ez = player.z + dz * L, ey = ground + gd.end.up;
    // the quadratic through P at its chord fraction t: control = (P − (1−t)²S − t²E) / 2t(1−t)
    const a = Math.hypot(px - sx, py - sy, pz - sz), c = Math.hypot(ex - px, ey - py, ez - pz), t = Math.min(0.8, Math.max(0.2, a / (a + c))), k2 = 2 * t * (1 - t);
    const cx = (px - (1 - t) ** 2 * sx - t * t * ex) / k2, cy = Math.max(py, (py - (1 - t) ** 2 * sy - t * t * ey) / k2), cz = (pz - (1 - t) ** 2 * sz - t * t * ez) / k2;
    const dur = (a + c) / gd.speed;
    const free = (b: AmbientFlockBird): boolean => b.state === HIDDEN || ((b.state === WHEEL || b.state === PERCHED) && Math.hypot(b.x - player.x, b.z - player.z) >= gd.borrow);
    if (this.birds.filter(free).length < gd.formation.length) return false;
    gd.formation.forEach(([back, side, up], k) => {
      let best: AmbientFlockBird | undefined, bestScore = -Infinity;
      for (const b of this.birds) {
        if (!free(b)) continue;
        const score = Math.hypot(b.x - player.x, b.z - player.z) + (b.state === PERCHED ? 0 : 1e6);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      if (best === undefined) return;
      const b = best;
      if (b.perch >= 0) this.occupied[b.perch] = 0;
      b.perch = -1;
      const ox = -dx * back + rx * side, oz = -dz * back + rz * side;
      b.ax = sx + ox; b.ay = sy + up; b.az = sz + oz; b.bx = cx + ox; b.by = cy + up; b.bz = cz + oz; b.tx = ex + ox; b.ty = ey + up; b.tz = ez + oz;
      b.x = b.ax; b.y = b.ay; b.z = b.az; b.yaw = Math.atan2(dx, dz); b.pitch = 0; b.roll = 0; b.legs = 1; b.head = 0;
      b.state = GUIDE; b.t = -k * gd.stagger; b.dur = dur; b.call = k === 0; b.burst = 3 + k; b.flapT = k * 1.3; b.glide = 0;
    });
    return true;
  }

  /** a guide pass is over: hidden, or on along the heading and up, then back into a loop (the takeoff curve) */
  private endGuide(b: AmbientFlockBird): void {
    const after = this.row.guide?.after ?? null, w = this.row.wheeling;
    if (after === null || w === null) { b.state = HIDDEN; return; }
    const hx = Math.sin(b.yaw), hz = Math.cos(b.yaw);
    b.ax = b.x; b.ay = b.y; b.az = b.z; b.bx = b.x + hx * after.ahead; b.by = b.y + after.up; b.bz = b.z + hz * after.ahead;
    this.rejoin(b);
    this.flight.wheel(b.loop, b, this.time, this.q);
    b.state = TAKEOFF; b.t = 0; b.dur = Math.max(8, Math.hypot(this.q.x - b.x, this.q.z - b.z) / after.speed);
    b.timer = this.rng.range(...w.perchAfter); b.call = false;
  }
}
