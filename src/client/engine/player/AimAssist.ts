import { app } from '../app/runtime';
/**
 * AimAssist — console-style (CoD / GTA pad) aim help for TOUCH play. Mouse users never get it: only TouchControls
 * drives it. Three classic parts, all against alive animals within RANGE m and in front of the camera, all gated by
 * the pause-menu switch (`getSetting('aimAssist')`), none of them a lock — the player still does the last bit:
 *
 *   1. FRICTION   — inside a screen-space bubble around the animal (its radius + a margin, seen from its distance:
 *                   ≈ 5° hip / 6.5° ADS on a deer at 20 m, clamped 1.5°–12°) the LOOK-pad delta is scaled by
 *                   0.6 (hip) / 0.45 (ADS) at the centre, ramping linearly to 1.0 at the bubble's edge.
 *                   TouchControls multiplies its drag by `assist.lookScale()`.
 *   2. SNAP       — the frame AIM latches ON, if an animal is within the snap cone (≈ 6° at 20 m, 2°–6°) and the
 *                   look pad is not being flicked (> 200 px/s), yaw/pitch ease out onto its aim point over 180 ms,
 *                   landing 0.4° short. Once per engage.
 *   3. TRACKING   — while AIM is on and the animal sits inside the inner cone (≈ 2.5° at 20 m, 1°–5°), 65 % of its
 *                   angular velocity relative to the player (estimated from its aim point's bearing deltas frame to
 *                   frame, so it also covers the player's own strafe) is added to yaw/pitch, capped at 45°/s, and it
 *                   lets go the moment the player drags the pad AWAY from the animal.
 *
 * The aim point is the upper body — halfway between the body centre and the head — so a snapped bolt is a body hit;
 * the head is still the player's to find. No bullet magnetism: bolts fly true.
 *
 *   const assist = new AimAssist()
 *   assist.noteLook(dx, dy)                                   // raw pad delta (px) — for the "dragging away" test
 *   assist.update(dt, player, adsOn, lookDragPxPerSec)        // once per frame, BEFORE the player sets its camera
 *   assist.lookScale()                                        // 0.45..1 — multiply the pad delta by this
 *
 * Targets come from AimTargets.ts (`setAimTargets(animals.animals)` in main.ts).
 */
import * as THREE from 'three';
import type { Player } from './Player';
import type { AimTarget } from './AimTargets';
import { getSetting } from '../ui/Settings';

const DEG = Math.PI / 180;
const RANGE = 60;                                            // m — nothing farther gets any help
// bubble radii are metres around the aim point, turned into an angle by the distance (so it is a screen-space size)
const FRICTION_MARGIN_HIP = 0.8, FRICTION_MARGIN_ADS = 1.2;  // + the animal's own radius (≈ 1 m deer) → ≈ 5° / 6.5° at 20 m
const FRICTION_MIN = 1.5 * DEG, FRICTION_MAX = 12 * DEG;
const FRICTION_HIP = 0.6, FRICTION_ADS = 0.45;               // look-delta scale at the bubble centre → 1.0 at the edge
const SNAP_MARGIN = 1.1, SNAP_MIN = 2 * DEG, SNAP_MAX = 6 * DEG;
const SNAP_MS = 180, SNAP_SHORT = 0.4 * DEG, SNAP_DRAG_LOCKOUT = 200; // px/s: a flick is not an aim
const TRACK_RADIUS = 0.9, TRACK_MIN = DEG, TRACK_MAX_ANGLE = 5 * DEG;
const TRACK_GAIN = 0.65, TRACK_MAX_RATE = 45 * DEG;         // rad/s cap on the added rotation
const TRACK_STALE = 0.25;                                    // s — a bearing sample older than this is not a velocity

interface Bearing { yaw: number; pitch: number; t: number }

const _aim = new THREE.Vector3(), _head = new THREE.Vector3(), _body = new THREE.Vector3(), _bdir = new THREE.Vector3(), _fwd = new THREE.Vector3(), _dir = new THREE.Vector3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;

export class AimAssist {
  private scale = 1;
  private wasAds = false;
  private snap: { target: AimTarget; elapsed: number; prevEase: number } | null = null;
  /** last frame's bearing (world yaw/pitch from the eye) to each candidate's aim point — its delta is the angular velocity */
  private bearings = new Map<AimTarget, Bearing>();
  private dragX = 0; private dragY = 0;
  private clock = 0;
  private readonly removeStaleBearing = (bearing: Bearing, target: AimTarget): void => {
    if (bearing.t !== this.clock) this.bearings.delete(target);
  };
  /** raw LOOK-pad delta (px, screen y down) since the last frame — TouchControls calls this from pointermove */
  noteLook(dx: number, dy: number): void { this.dragX += dx; this.dragY += dy; }

  /** 0.45..1 — the LOOK-pad delta multiplier for this frame (1 when the assist is off or nothing is near the sight) */
  lookScale(): number { return this.scale; }

  update(dt: number, player: Player, adsOn: boolean, lookDragPxPerSec: number): void {
    this.clock += dt;
    const dragX = this.dragX, dragY = this.dragY; this.dragX = this.dragY = 0;
    const engaged = adsOn && !this.wasAds; this.wasAds = adsOn;
    const on = getSetting('aimAssist');
    this.scale = 1;
    if (!on) { this.snap = null; this.bearings.clear(); return; }

    // ── candidates: alive, close, in front — bearings are sampled for all of them so a target that becomes active already has a velocity ──
    const yaw = player.yaw, pitch = player.pitch, p = player.camera.position;
    _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    // The winner is private to this call. Scalar locals preserve nested-update
    // isolation without allocating one temporary object per nearer candidate.
    let best: AimTarget | null = null;
    let bestDist = 0, bestAngle = 0, bestYaw = 0, bestPitch = 0, bestRadius = 0, bestWy = 0, bestWp = 0, bestHasVel = false;
    const margin = adsOn ? FRICTION_MARGIN_ADS : FRICTION_MARGIN_HIP;
    for (const t of app.aimTargets) {
      if (!t.alive || t.hidden) { this.bearings.delete(t); continue; }
      aimPoint(t, _aim);
      _dir.subVectors(_aim, p);
      const dist = _dir.length();
      if (dist > RANGE || dist < 0.5) { this.bearings.delete(t); continue; }
      _dir.divideScalar(dist);
      const yawTo = Math.atan2(-_dir.x, -_dir.z), pitchTo = Math.asin(clamp(_dir.y, -1, 1));
      // angular velocity relative to the player = bearing delta of the BODY CENTRE since last frame (covers the animal's walk
      // AND the player's strafe; the body centre follows `position` only, so a head swing / graze bob never reads as motion)
      bodyCentre(t, _body); _bdir.subVectors(_body, p).normalize();
      const byaw = Math.atan2(-_bdir.x, -_bdir.z), bpitch = Math.asin(clamp(_bdir.y, -1, 1));
      const b = this.bearings.get(t);
      let wy = 0, wp = 0, hasVel = false;
      if (b) {
        const span = this.clock - b.t;
        if (span > 0 && span < TRACK_STALE) { wy = wrap(byaw - b.yaw) / span; wp = (bpitch - b.pitch) / span; hasVel = true; }
        b.yaw = byaw; b.pitch = bpitch; b.t = this.clock;
      } else this.bearings.set(t, { yaw: byaw, pitch: bpitch, t: this.clock });
      const dot = _dir.dot(_fwd);
      if (dot <= 0) continue;
      const angle = Math.acos(Math.min(1, dot));
      const cone = clamp(Math.atan((bodyRadius(t) + margin) / dist), FRICTION_MIN, FRICTION_MAX);
      if (angle > cone) continue;
      if (!best || angle / cone < bestAngle / bestRadius) {
        best = t; bestDist = dist; bestAngle = angle; bestYaw = yawTo; bestPitch = pitchTo;
        bestRadius = cone; bestWy = wy; bestWp = wp; bestHasVel = hasVel;
      }
    }
    // a target gone from the list (a retired region's animals) keeps no bearing, nor the world it points into (live P0)
    this.bearings.forEach(this.removeStaleBearing);

    if (best) {
      // 1. friction: full strength at the centre, none at the edge
      const strength = adsOn ? FRICTION_ADS : FRICTION_HIP;
      this.scale = strength + (1 - strength) * clamp(bestAngle / bestRadius, 0, 1);
    }

    // 2. snap: on the ADS rising edge, onto the nearest animal inside the snap cone — unless the pad is being flicked
    if (engaged && best && lookDragPxPerSec <= SNAP_DRAG_LOCKOUT) {
      const snapCone = clamp(Math.atan((bodyRadius(best) + SNAP_MARGIN) / bestDist), SNAP_MIN, SNAP_MAX);
      if (bestAngle <= snapCone) this.snap = { target: best, elapsed: 0, prevEase: 0 };
    }
    if (!adsOn) this.snap = null;
    if (this.snap) {
      const s = this.snap, t = s.target;
      if (!t.alive || t.hidden) this.snap = null;
      else {
        s.elapsed += dt * 1000;
        const ease = easeOut(Math.min(1, s.elapsed / SNAP_MS));
        const frac = s.prevEase >= 1 ? 0 : (ease - s.prevEase) / (1 - s.prevEase);
        s.prevEase = ease;
        aimPoint(t, _aim); _dir.subVectors(_aim, p).normalize();
        let dy = wrap(Math.atan2(-_dir.x, -_dir.z) - player.yaw), dp = Math.asin(clamp(_dir.y, -1, 1)) - player.pitch;
        const mag = Math.hypot(dy, dp);
        const k = mag > SNAP_SHORT ? (mag - SNAP_SHORT) / mag : 0; // land short of the aim point — not a pixel lock
        dy *= k; dp *= k;
        player.yaw += dy * frac; player.pitch = clamp(player.pitch + dp * frac, -1.45, 1.45);
        if (ease >= 1) this.snap = null;
      }
    }

    // 3. tracking: while ADS holds an animal inside the inner cone, follow 65 % of its bearing rate (capped), unless pushed away
    //    (not during the snap — that already re-aims at the moving aim point every frame)
    if (adsOn && best && !this.snap) {
      const inner = clamp(Math.atan(TRACK_RADIUS / bestDist), TRACK_MIN, TRACK_MAX_ANGLE);
      if (bestAngle <= inner && bestHasVel) {
        let wy = bestWy, wp = bestWp;
        const rate = Math.hypot(wy, wp);
        if (rate > TRACK_MAX_RATE / TRACK_GAIN) { wy *= TRACK_MAX_RATE / TRACK_GAIN / rate; wp *= TRACK_MAX_RATE / TRACK_GAIN / rate; }
        // screen-space direction to the animal (x right, y down) vs the drag: a push away releases the tracking
        const tx = -wrap(bestYaw - player.yaw), ty = -(bestPitch - player.pitch);
        const away = (dragX !== 0 || dragY !== 0) && dragX * tx + dragY * ty < 0;
        if (!away) {
          const ay = wy * TRACK_GAIN * dt, ap = wp * TRACK_GAIN * dt;
          player.yaw += ay; player.pitch = clamp(player.pitch + ap, -1.45, 1.45);
        }
      }
    }
  }
}

/** upper body: halfway from the body centre to the head (a body hit when snapped onto; the head is the player's to find) */
function aimPoint(t: AimTarget, out: THREE.Vector3) {
  bodyCentre(t, out);
  if (t.headWorld) { t.headWorld(_head); if (Number.isFinite(_head.x) && _head.lengthSq() > 0) out.lerp(_head, 0.5); }
  return out;
}
/** body centre from `position` alone (feet + body height) — animation-free, so it is what the velocity estimate watches */
function bodyCentre(t: AimTarget, out: THREE.Vector3) {
  out.copy(t.position); out.y += (t.dims?.bodyY ?? 0.9) * (t.scale ?? 1);
  return out;
}
/** the animal's own half-size (m): the bubble grows with a boar's bulk / a big deer */
function bodyRadius(t: AimTarget) {
  const s = t.scale ?? 1, d = t.dims;
  return Math.max(0.6, ((d?.bodyHalfLen ?? 0.7) + (d?.bodyRadius ?? 0.33)) * 0.5 * 1.4) * s; // ≈ 0.72 m deer, ≈ 1 m boar (bulkier dims)
}
