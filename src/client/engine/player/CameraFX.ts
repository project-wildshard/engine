import type * as THREE from 'three';
import type { Game } from '../core/Game';
import { worldTime } from '../../../shared/engine/core/time';

/**
 * CameraFX — the first-person camera's combat feel (Driftwood C3), layered ON TOP of whatever Player.ts wrote this frame:
 *
 *   • KICK — spring-damped pitch / roll impulses (`kick(pitchDeg, rollDeg)`): the sword leans the view 1–3° along each
 *     swing as its blade comes through (Sword.ts), a little more on contact. Under-damped springs: a snap, one soft
 *     overshoot, settled in ~0.3 s.
 *   • FOV PUNCH — `fovPunch(deg)`: a sprung field-of-view offset (the heavy's −2°), read back as `fovOffset` by the weapon
 *     that owns `camera.fov` (Sword.ts adds it to its target FOV).
 *   • SHAKE — `addTrauma(0..1)` when the player is hit: a trauma² shake (yaw / pitch / roll from smooth sines), trauma
 *     decaying at TRAUMA_DECAY / s, so a small hit is a shiver and a big one a jolt.
 *
 * All of it runs on `worldTime.realDt` — it keeps moving through a hit-stop. One instance per physical camera (`CameraFX.for(game)`
 * registers its own player-lifetime updater, so create it after bootstrap: its updater then runs after Player.update). If
 * nothing rewrote the camera since the last frame (the tour camera, a paused player), the previous frame's offset is
 * taken back first, so offsets never accumulate. No allocations per frame.
 */

const K = 190, DAMP = 15;           // spring stiffness / damping for the kick (ω ≈ 13.8 rad/s, ζ ≈ 0.54)
const KICK_V = 29;                  // velocity impulse per unit of peak angle (measured: the spring then peaks at ~the asked angle)
const FOV_K = 120, FOV_DAMP = 14;
const TRAUMA_DECAY = 1.7;           // trauma / s
const SHAKE_YAW = 0.035, SHAKE_PITCH = 0.03, SHAKE_ROLL = 0.05; // rad at trauma 1
const DEG = Math.PI / 180;

export class CameraFX {
  private static byCamera = new WeakMap<THREE.PerspectiveCamera, CameraFX>();
  static for(game: Game): CameraFX {
    const camera = game.camera;
    let fx = CameraFX.byCamera.get(camera);
    if (fx === undefined) {
      const scope = game.playerScope;
      if (scope.disposed) throw new Error('Cannot bind camera effects after the player lifetime');
      fx = new CameraFX(camera);
      const bound = fx;
      game.onPlayerUpdate((_dt, t) => { bound.update(t); }, 'engine.player.for');
      CameraFX.byCamera.set(camera, bound);
      scope.onDispose(() => { if (CameraFX.byCamera.get(camera) === bound) CameraFX.byCamera.delete(camera); });
    }
    return fx;
  }

  /** the sprung FOV offset in degrees (the weapon that owns camera.fov adds it) */
  fovOffset = 0;
  private pitch = 0; private pitchV = 0; private roll = 0; private rollV = 0;
  private fovV = 0;
  private trauma = 0;
  // what was added to the camera last frame, and the camera pose after it (to detect "nobody rewrote the camera")
  private addX = 0; private addY = 0; private addZ = 0;
  private lastX = Number.NaN; private lastY = Number.NaN; private lastZ = Number.NaN;

  private readonly camera: THREE.PerspectiveCamera;
  private constructor(camera: THREE.PerspectiveCamera) { this.camera = camera; }

  /** a spring impulse peaking at ~`pitchDeg` (+ = look up) and `rollDeg` (+ = roll counter-clockwise, the view tips left) */
  kick(pitchDeg: number, rollDeg: number): void { this.pitchV += pitchDeg * DEG * KICK_V; this.rollV += rollDeg * DEG * KICK_V; }
  /** a sprung FOV change peaking at ~`deg` (−2 = the heavy's punch in) */
  fovPunch(deg: number): void { this.fovV += deg * KICK_V * 0.85; }
  /** shake: add trauma (clamped to 1); the shake is trauma² */
  addTrauma(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }

  private update(t: number): void {
    const cam = this.camera, r = cam.rotation;
    // the camera was not rewritten since our last offset (no Player.update this frame): take the old offset back first
    if (r.x === this.lastX && r.y === this.lastY && r.z === this.lastZ) { r.x -= this.addX; r.y -= this.addY; r.z -= this.addZ; }
    const dt = worldTime.realDt;
    for (let rem = dt; rem > 1e-6; rem -= 1 / 120) {
      const h = Math.min(rem, 1 / 120);
      this.pitchV += (-this.pitch * K - this.pitchV * DAMP) * h; this.pitch += this.pitchV * h;
      this.rollV += (-this.roll * K - this.rollV * DAMP) * h; this.roll += this.rollV * h;
      this.fovV += (-this.fovOffset * FOV_K - this.fovV * FOV_DAMP) * h; this.fovOffset += this.fovV * h;
    }
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const s = this.trauma * this.trauma;
    // smooth pseudo-noise: summed incommensurate sines per axis
    const nY = s > 0 ? Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7 + 1.3) * 0.4 : 0;
    const nP = s > 0 ? Math.sin(t * 41.3 + 2.1) * 0.6 + Math.sin(t * 29.9 + 0.4) * 0.4 : 0;
    const nR = s > 0 ? Math.sin(t * 33.7 + 4.2) * 0.6 + Math.sin(t * 19.3 + 2.7) * 0.4 : 0;
    this.addX = this.pitch + s * SHAKE_PITCH * nP;
    this.addY = s * SHAKE_YAW * nY;
    this.addZ = this.roll + s * SHAKE_ROLL * nR;
    if (Math.abs(this.fovOffset) < 1e-4 && Math.abs(this.fovV) < 1e-4) { this.fovOffset = 0; this.fovV = 0; }
    r.x += this.addX; r.y += this.addY; r.z += this.addZ;
    this.lastX = r.x; this.lastY = r.y; this.lastZ = r.z;
  }
}
