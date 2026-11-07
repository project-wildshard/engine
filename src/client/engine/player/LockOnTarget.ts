import { app } from '../app/runtime';
import type { InputService } from '../input/InputService';
/**
 * LockOnTarget — the Zelda-style lock-on (E50, project/archive/2026-09-23-lock-on.md; Jake's picks: the J disc, the N locked HUD, a
 * toggle, auto-next within 8 m, a Gentle camera, melee only). Nalati (NALATI-MERGE H3): the sabre and the spear lock too
 * on every authored lockable Nalati hostile, on foot and in the saddle (Mount.pose holds its re-centring while
 * locked, so the view tracks the target and the stick still steers the horse); Jel Ata locks from the arena (`lockRange`).
 * It runs the shared `lockOn` state in AimTargets.ts:
 *
 *   const lock = new LockOnSystem(player, weapons, camera);   // chains player.preUpdate, owns the desktop binds (Z / middle mouse /
 *                                                     // mouse flick / wheel)
 *   lock.toggle()        // the LOCK disc / Z: lock the best candidate, unlock, or (nothing lockable) level the view
 *   lock.flick('left')   // switch to the next target on that side (the SWITCH pad's flick, the wheel)
 *   lock.tapLock(x, y)   // a short tap on an enemy's on-screen body locks it (plan L11)
 *   addLockOffset(dYaw, dPitch)   // a look drag while locked: the ±10° / ±6° glance that springs back
 *
 * Acquire (§2.2): alive hostile enemies within ACQUIRE m (feet → body edge) and ±CONE of the view (3D), in line of sight
 * (src/shared/engine/physics/query.ts `lineOfSight` — terrain, decks, huts, the wreck; creatures don't block); the score `angle / CONE + 0.35 · dist / ACQUIRE`, −0.1 while the enemy winds up an attack,
 * lowest wins — the screen centre first. Locked (§2.3): the view eases onto the target's body (engage 8 /s capped 240°/s,
 * then hold with a ±2° dead zone at 6 /s capped 180°/s — the Settings "Lock-on camera" Follow ×1 / Gentle ×0.5 / Off ×0,
 * Gentle by default); it breaks past BREAK m, after LOS_GRACE s out of sight, in the water, on the board, in a menu or with
 * a ranged weapon; a kill re-locks the next enemy within NEXT_R m after NEXT_DELAY s (Settings "Auto re-lock", on by
 * default) or unlocks. Player.ts turns MOVE into an orbit and DODGE into a side-hop / close-in / backstep round the target;
 * Sword.ts lunges only onto it; the HUD (src/client/engine/ui/LockOn.ts, TouchControls) draws the J disc, the ▼ + brackets, the edge
 * chevrons, SWITCH and ORBIT.
 */
import * as THREE from 'three';
import type { Player } from './Player';
import type { EquipmentService } from '../combat/EquipmentService';
import { lockOn, type AimTarget } from './AimTargets';
import { targetRadius } from '../../../shared/engine/combat/lungeTarget';
import { lineOfSight } from '../../../shared/engine/physics/query';
import { getNumber, getSetting } from '../ui/Settings';

const DEG = Math.PI / 180;
export const LOCK: { readonly ACQUIRE: 12; // m, feet → body edge
readonly BREAK: 18; // m: 1.5 × ACQUIRE (OoT's release ratio)
readonly FLY_ACQUIRE: 24; // m, eye → body edge; species.flight.lockRange overrides this
readonly FLY_PITCH: 1.45; // player's full pitch envelope; flyers can dive above/below the old ground clamp
readonly CONE: number; // ± of the view, 3D
readonly NEXT_R: 8; // m: a kill re-locks within this …
readonly NEXT_CONE: number; // … and this of the view …
readonly NEXT_DELAY: 0.35; // … after this beat, so the kill reads
readonly LOS_GRACE: 1; // s out of sight before the lock drops (a palm trunk passing doesn't)
readonly SCAN: 0.1; // s between candidate scans
readonly ENGAGE_T: 0.45; // s of the fast engage ease after a lock / switch
readonly ENGAGE_RATE: 8; readonly ENGAGE_CAP: number; readonly HOLD_RATE: 6; readonly HOLD_CAP: number; readonly DEAD: number; readonly PITCH_MIN: number; readonly PITCH_MAX: number; readonly TALL_PITCH_MAX: number; readonly OFF_YAW: number; readonly OFF_PITCH: number; readonly OFF_RETURN: 12; // /s: the glance springs back in ~0.25 s
readonly REFRACTORY: 0.25; } = {
  ACQUIRE: 12,           // m, feet → body edge
  BREAK: 18,             // m: 1.5 × ACQUIRE (OoT's release ratio)
  FLY_ACQUIRE: 24,       // m, eye → body edge; species.flight.lockRange overrides this
  FLY_PITCH: 1.45,       // player's full pitch envelope; flyers can dive above/below the old ground clamp
  CONE: 40 * DEG,        // ± of the view, 3D
  NEXT_R: 8,             // m: a kill re-locks within this …
  NEXT_CONE: 90 * DEG,   // … and this of the view …
  NEXT_DELAY: 0.35,      // … after this beat, so the kill reads
  LOS_GRACE: 1.0,        // s out of sight before the lock drops (a palm trunk passing doesn't)
  SCAN: 0.1,             // s between candidate scans
  ENGAGE_T: 0.45,        // s of the fast engage ease after a lock / switch
  ENGAGE_RATE: 8, ENGAGE_CAP: 240 * DEG,
  HOLD_RATE: 6, HOLD_CAP: 180 * DEG, DEAD: 2 * DEG,
  PITCH_MIN: -45 * DEG, PITCH_MAX: 50 * DEG, TALL_PITCH_MAX: 35 * DEG,
  OFF_YAW: 10 * DEG, OFF_PITCH: 6 * DEG, OFF_RETURN: 12, // /s: the glance springs back in ~0.25 s
  REFRACTORY: 0.25,      // s after a switch before the next flick counts
} as const;
/** the weapons that lock: the Driftwood swords and Nalati's sabre + spear (H3). The bow waits for its own lock (H4 / N18) */

export type FlickDir = 'left' | 'right' | 'up' | 'down';
const SECTOR = Math.tan(60 * DEG); // a flick takes what lies within ±60° of its direction

// ── pure helpers (test/lockon.test.ts) ──

/** a candidate's lock score — lower wins: the screen centre first, distance breaks ties, a wind-up wins a tie */
export function lockScore(angle: number, dist: number, attacking: boolean): number {
  return angle / LOCK.CONE + 0.35 * dist / LOCK.ACQUIRE - (attacking ? 0.1 : 0);
}
/** wrap an angle to ±π */
export function wrapAngle(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }
/** the next target a flick would switch to: bearings (yaw / pitch from the eye) relative to the CURRENT target, so repeated
 *  flicks walk along the row. Left = a larger yaw (three.js: yaw turns the view left). null = nothing on that side */
export function pickSwitch<T>(dir: FlickDir, cur: { yaw: number; pitch: number }, cands: readonly { t: T; yaw: number; pitch: number }[]): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const c of cands) {
    const dy = wrapAngle(c.yaw - cur.yaw), dp = c.pitch - cur.pitch;
    let d: number;
    // only what lies within ±60° of the flick's direction (a crab 2° left but 25° up is "up", not "left")
    if (dir === 'left' || dir === 'right') {
      if (Math.abs(dy) > 120 * DEG || (dir === 'left' ? dy <= 0.02 : dy >= -0.02) || Math.abs(dp) > Math.abs(dy) * SECTOR) continue;
      d = Math.abs(dy) + 0.5 * Math.abs(dp);
    } else {
      if ((dir === 'up' ? dp <= 0.05 : dp >= -0.05) || Math.abs(dy) > Math.abs(dp) * SECTOR) continue;
      d = Math.abs(dp) + 0.5 * Math.abs(dy);
    }
    if (d < bestD) { bestD = d; best = c.t; }
  }
  return best;
}
/** the touch flick classifier (§2.5): ≥ 28 px of travel at ≥ 600 px/s over any 60 ms window, within 200 ms of touch-down —
 *  anything slower is the glance. One flick per touch. */
export class FlickTracker {
  private samples: { x: number; y: number; t: number }[] = [];
  private t0 = 0; private x0 = 0; private y0 = 0; private done = false;
  begin(x: number, y: number, t: number): void { this.samples = [{ x, y, t }]; this.t0 = t; this.x0 = x; this.y0 = y; this.done = false; }
  /** a new position; returns the flick's direction the first time the gesture qualifies */
  move(x: number, y: number, t: number): FlickDir | null {
    if (this.done) return null;
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - (this.samples[0]?.t ?? t) > 60) this.samples.shift();
    if (t - this.t0 > 200) return null;
    const dx = x - this.x0, dy = y - this.y0, travel = Math.hypot(dx, dy);
    const first = this.samples[0];
    if (first === undefined || travel < 28) return null;
    const win = Math.max(8, t - first.t), speed = Math.hypot(x - first.x, y - first.y) / win * 1000;
    if (speed < 600) return null;
    this.done = true;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down'); // the way a look drag turns: right = the target on the right
  }
}

// ── the glance (a look drag while locked) ──
let offsetInputAt = 0;
/** a look drag while locked: the view glances by ±10° / ±6° (clamped), then springs back once the finger lifts */
export function addLockOffset(dYaw: number, dPitch: number): void {
  lockOn.offYaw = Math.max(-LOCK.OFF_YAW, Math.min(LOCK.OFF_YAW, lockOn.offYaw + dYaw));
  lockOn.offPitch = Math.max(-LOCK.OFF_PITCH, Math.min(LOCK.OFF_PITCH, lockOn.offPitch + dPitch));
  offsetInputAt = performance.now();
}

const _eye = new THREE.Vector3(), _aim = new THREE.Vector3(), _proj = new THREE.Vector3(), _edge = new THREE.Vector3(), _right = new THREE.Vector3(), _head = new THREE.Vector3();

/** the point the view locks onto: the body centre; on a tall enemy halfway up to the head (the chest) */
export function aimPoint(t: AimTarget, out: THREE.Vector3): THREE.Vector3 {
  const s = t.scale ?? 1, bodyY = (t.dims?.bodyY ?? 0.5) * s;
  out.copy(t.position); out.y += bodyY;
  if (bodyY > 0.9 && t.headWorld) { const hy = t.headWorld(_head).y; out.y = (out.y + hy) / 2; }
  return out;
}

interface Cand { t: AimTarget; yaw: number; pitch: number; angle: number; dist: number }

/** lock-on: picks, holds, switches and breaks the locked target, and tells the HUD and the camera */
export class LockOnSystem {
  /** hooks (main.ts): the lock chime, the switch ping, the unlock / break tone, the "nothing there" tick */
  onLock?: () => void; onSwitch?: () => void; onUnlock?: () => void; onNone?: () => void;
  /** A shard's traversal target gets first claim on LOCK; true means it handled the press. */
  inputService: InputService | null = null;
  /** TouchControls: flash the LOCK disc's "NO TARGET"; flash an edge chevron that had nothing */
  onNoTarget?: () => void; onFlickMiss?: (dir: FlickDir) => void;

  private scanT = 0; private engageT = 0; private lastBear: { yaw: number; pitch: number } | null = null; private readonly lastAim = new THREE.Vector3(); private losLostT = 0; private deadT = -1; private levelT = 0; private refractoryT = 0;
  private cands: Cand[] = [];
  private mouseSamples: { t: number; dx: number; dy: number }[] = [];

  private player: Player;
  private weapons: EquipmentService;
  private camera: THREE.PerspectiveCamera;
  constructor(player: Player, weapons: EquipmentService, camera: THREE.PerspectiveCamera) {
    this.player = player;
    this.weapons = weapons;
    this.camera = camera;
    const prev = player.preUpdate;
    player.preUpdate = (dt) => { prev?.(dt); this.update(dt); };
    // desktop (§2.1 / L9): Z or the middle mouse button toggles; while locked a mouse flick or the wheel switches
    const scope = (app.levelScope ?? app.engineScope).child('lock-input');
    scope.onDispose(() => { if (prev === undefined) delete player.preUpdate; else player.preUpdate = prev; });
    app.input.observeWheel((dy) => { if (player.locked && lockOn.state === 'locked' && Math.abs(dy) > 4) this.flick(dy < 0 ? 'right' : 'left'); }, scope);
    app.input.observeLook((dx, dy) => {
      if (!player.locked || lockOn.state !== 'locked') return;
      const t = performance.now();
      this.mouseSamples.push({ t, dx, dy });
      while (this.mouseSamples.length > 0 && t - (this.mouseSamples[0]?.t ?? t) > 60) this.mouseSamples.shift();
      let sx = 0, sy = 0; for (const sample of this.mouseSamples) { sx += sample.dx; sy += sample.dy; }
      if (Math.max(Math.abs(sx), Math.abs(sy)) > 40 && this.refractoryT <= 0) {
        this.mouseSamples.length = 0;
        this.flick(Math.abs(sx) >= Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : (sy < 0 ? 'up' : 'down'));
      }
    }, scope);
  }

  /** a melee weapon in hand, the game running, on foot */
  private get usable(): boolean {
    const p = this.player;
    return this.weapons.enabled && this.weapons.current.row.ui.lockOn && !p.swimming && !p.hover;
  }

  toggle(): void {
    if (this.inputService !== null) { this.inputService.press('lock'); return; }
    this.resolveToggle();
  }

  /** Whether LOCK has an enemy claim before a tool offers its miss shot. */
  hasTarget(): boolean { this.scan(); return lockOn.state === 'locked' || (this.usable && this.best() !== null); }

  resolveToggle(): void {
    if (lockOn.state === 'locked') { this.unlock(); return; }
    if (!this.usable) return;
    this.scan();
    const best = this.best();
    if (best === null) { this.levelT = 0.25; this.onNone?.(); this.onNoTarget?.(); app.events.emit('lock.noTarget', true); return; } // OoT: Z with nothing re-levels the view
    this.lock(best.t);
    this.onLock?.();
  }

  flick(dir: FlickDir): void {
    if (lockOn.state !== 'locked' || lockOn.target === null || this.refractoryT > 0) return;
    const cur = this.bearing(lockOn.target);
    if (cur === null) return;
    const next = pickSwitch(dir, cur, this.cands.filter((c) => c.t !== lockOn.target));
    if (next === null) { this.onFlickMiss?.(dir); this.onNone?.(); return; }
    this.lock(next); this.refractoryT = LOCK.REFRACTORY;
    this.onSwitch?.();
  }

  /** a short tap on an enemy's on-screen body locks it (or switches to it); false = no enemy under the tap */
  tapLock(x: number, y: number): boolean {
    if (!this.usable) return false;
    this.scan();
    const vw = innerWidth, vh = innerHeight;
    let hit: AimTarget | null = null, hitD = Infinity;
    for (const c of this.cands) {
      aimPoint(c.t, _proj).project(this.camera);
      if (_proj.z > 1 || _proj.z < -1) continue;
      const sx = (_proj.x + 1) / 2 * vw, sy = (1 - _proj.y) / 2 * vh;
      _right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      aimPoint(c.t, _edge).addScaledVector(_right, targetRadius(c.t) * 1.3).project(this.camera);
      const half = Math.max(22, Math.abs(_edge.x - _proj.x) / 2 * vw);
      const d = Math.hypot(x - sx, y - sy);
      if (Math.abs(x - sx) < half && Math.abs(y - sy) < half * 1.3 && d < hitD) { hitD = d; hit = c.t; }
    }
    if (hit === null) return false;
    const was = lockOn.state === 'locked';
    this.lock(hit);
    if (was) this.onSwitch?.(); else this.onLock?.();
    return true;
  }

  private lock(t: AimTarget): void {
    lockOn.target = t; lockOn.state = 'locked'; lockOn.candidate = null;
    lockOn.offYaw = 0; lockOn.offPitch = 0;
    const p = this.player.position;
    lockOn.r0 = Math.hypot(t.position.x - p.x, t.position.z - p.z);
    this.engageT = LOCK.ENGAGE_T; this.losLostT = 0; this.deadT = -1; this.lastBear = null;
  }

  unlock(broke = false): void {
    if (lockOn.state !== 'locked') return;
    lockOn.target = null; lockOn.state = 'off'; lockOn.left = lockOn.right = null;
    lockOn.offYaw = lockOn.offPitch = 0;
    this.scanT = 0; this.deadT = -1;
    this.onUnlock?.();
    void broke;
  }

  private bearing(t: AimTarget): { yaw: number; pitch: number } | null {
    this.eye(_eye); aimPoint(t, _aim);
    const dx = _aim.x - _eye.x, dy = _aim.y - _eye.y, dz = _aim.z - _eye.z, h = Math.hypot(dx, dz);
    if (t.flying === true && h < 0.3) return { yaw: this.lastBear?.yaw ?? this.player.yaw, pitch: Math.atan2(dy, h) }; // heading is undefined directly overhead: retain it through the pole
    if (h < 1e-3) return null;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, h) };
  }

  private eye(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.player.camera.position); }

  private range(t: AimTarget): number { return t.lockRange ?? (t.flying === true ? LOCK.FLY_ACQUIRE : LOCK.ACQUIRE); }

  private distance(t: AimTarget): number {
    if (t.flying === true) return aimPoint(t, _aim).distanceTo(this.player.camera.position) - targetRadius(t);
    return Math.hypot(t.position.x - this.player.position.x, t.position.z - this.player.position.z) - targetRadius(t);
  }

  /** line of sight eye → the target's body through the physics world (terrain, decks, huts, the wreck); true while there is
   *  no physics world yet */
  private visible(t: AimTarget): boolean {
    const physics = app.physics;
    if (physics === null) return true;
    this.eye(_eye); aimPoint(t, _aim);
    return lineOfSight(physics, _eye, _aim, targetRadius(t), this.player.motor.collider);
  }

  /** every lockable enemy right now (range + LOS; the cone is applied by best()) */
  private scan(): void {
    const yaw = this.player.yaw, pitch = this.player.pitch;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    this.cands.length = 0;
    this.eye(_eye);
    for (const t of app.aimTargets) {
      if (!t.alive || t.hidden || !(t.lockable ?? t.flying === true)) continue;
      const dist = this.distance(t);
      if (dist > this.range(t) && t !== lockOn.target) continue;
      aimPoint(t, _aim);
      const dx = _aim.x - _eye.x, dy = _aim.y - _eye.y, dz = _aim.z - _eye.z, len = Math.hypot(dx, dy, dz);
      if (len < 1e-3) continue;
      if (t !== lockOn.target && !this.visible(t)) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / len)));
      this.cands.push({ t, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), angle, dist });
    }
  }

  /** the best candidate inside `within` of the view and `maxDist` m (default: each target's own acquire range) */
  private best(within: number = LOCK.CONE, maxDist?: number): Cand | null {
    let best: Cand | null = null, bestS = Infinity;
    for (const c of this.cands) {
      const range = this.range(c.t);
      if (c.t === lockOn.target || c.angle > within || c.dist > (maxDist ?? range)) continue;
      const s = lockScore(c.angle, c.dist * LOCK.ACQUIRE / range, c.t.state === 'attack'); // a far-lock giant scores by its own range
      if (s < bestS) { bestS = s; best = c; }
    }
    return best;
  }

  private update(dt: number): void {
    this.refractoryT = Math.max(0, this.refractoryT - dt);
    const p = this.player;
    if (lockOn.state === 'locked' && !this.usable) this.unlock(true);

    // the scan: candidates for the J disc / the ▽, the edge chevrons while locked
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = LOCK.SCAN;
      if (this.usable) this.scan(); else this.cands.length = 0;
      if (lockOn.state === 'locked' && lockOn.target !== null) {
        const cur = this.bearing(lockOn.target), others = this.cands.filter((c) => c.t !== lockOn.target);
        lockOn.left = cur ? pickSwitch('left', cur, others) : null;
        lockOn.right = cur ? pickSwitch('right', cur, others) : null;
        const hd = (t: AimTarget | null) => (t === null ? 0 : Math.max(0, this.distance(t)));
        lockOn.leftDist = hd(lockOn.left); lockOn.rightDist = hd(lockOn.right);
      } else {
        const b = this.usable ? this.best() : null;
        lockOn.candidate = b?.t ?? null;
        lockOn.state = b ? 'available' : 'off';
      }
    }

    const t = lockOn.target;
    if (lockOn.state === 'locked' && t !== null) {
      // the kill: a beat, then the next enemy close by (Auto re-lock) or unlock
      if (!t.alive || t.hidden) {
        if (this.deadT < 0) this.deadT = LOCK.NEXT_DELAY;
        this.deadT -= dt;
        if (this.deadT <= 0) {
          this.scan();
          const next = getSetting('autoLock') ? this.best(LOCK.NEXT_CONE, LOCK.NEXT_R) : null;
          if (next) { this.lock(next.t); this.onSwitch?.(); } else this.unlock();
        }
        return;
      }
      // breaks: too far, out of sight too long
      const dist = this.distance(t);
      if (dist > (t.flying === true || t.lockRange !== undefined ? this.range(t) * 1.5 : LOCK.BREAK)) { this.unlock(true); return; }
      this.losLostT = this.visible(t) ? 0 : this.losLostT + dt;
      if (this.losLostT > LOCK.LOS_GRACE) { this.unlock(true); return; }

      // the camera track (§2.3): engage, then hold inside the dead zone; × the Lock-on camera setting
      const b = this.bearing(t);
      const mult = getNumber('lockCam');
      // feed-forward: the bearing change the PLAYER's own move caused since the last frame (the orbit, a side-hop — measured
      // against where the target was then) is applied 1:1, so a turn you cause yourself never lags or whips; the target's own
      // movement stays eased and capped (a boar running past must not whip the view)
      if (t.flying !== true && b !== null && mult > 0 && this.lastBear !== null) {
        this.eye(_eye);
        const dx = this.lastAim.x - _eye.x, dy = this.lastAim.y - _eye.y, dz = this.lastAim.z - _eye.z, h = Math.hypot(dx, dz);
        if (h > 1e-3) {
          p.yaw += wrapAngle(Math.atan2(-dx, -dz) - this.lastBear.yaw);
          p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch + (Math.atan2(dy, h) - this.lastBear.pitch)));
        }
      }
      this.lastBear = b; aimPoint(t, this.lastAim);
      if (b !== null && mult > 0) {
        const tall = (t.dims?.bodyY ?? 0.5) * (t.scale ?? 1) > 0.9;
        const pitchT = (t.flying === true
          ? Math.max(-LOCK.FLY_PITCH, Math.min(LOCK.FLY_PITCH, b.pitch))
          : Math.max(LOCK.PITCH_MIN, Math.min(tall ? LOCK.TALL_PITCH_MAX : LOCK.PITCH_MAX, b.pitch))) + lockOn.offPitch;
        const yawErr = wrapAngle(b.yaw + lockOn.offYaw - p.yaw), pitchErr = pitchT - p.pitch;
        // engage (fast) until the aim is inside the dead zone once — at least ENGAGE_T s — then hold
        const err = Math.hypot(yawErr, pitchErr);
        const engaging = this.engageT > 0 || (this.engageT > -1 && err > LOCK.DEAD);
        if (this.engageT > 0) this.engageT = Math.max(0, this.engageT - dt);
        else if (err <= LOCK.DEAD) this.engageT = -1; // settled: hold from here on
        const rate = (engaging ? LOCK.ENGAGE_RATE : LOCK.HOLD_RATE) * mult, cap = (engaging ? LOCK.ENGAGE_CAP : LOCK.HOLD_CAP) * mult * dt;
        const step = (off: number) => {
          const e = engaging ? off : Math.sign(off) * Math.max(0, Math.abs(off) - LOCK.DEAD); // hold: only what sits outside the dead zone
          return Math.max(-cap, Math.min(cap, e * (1 - Math.exp(-dt * rate))));
        };
        p.yaw += step(yawErr);
        p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch + step(pitchErr)));
      }
      // the glance springs back once the finger lifts
      if (performance.now() - offsetInputAt > 80) { const k = Math.exp(-dt * LOCK.OFF_RETURN); lockOn.offYaw *= k; lockOn.offPitch *= k; }
    } else if (this.levelT > 0) {
      // nothing to lock: re-level the view toward the horizon (OoT's Z re-centre)
      this.levelT = Math.max(0, this.levelT - dt);
      p.pitch += (0 - p.pitch) * (1 - Math.exp(-dt * 14));
    }
  }
}
