import * as THREE from 'three';
import { heightAt } from '../../../shared/engine/world/Heightfield';

/**
 * Scripted camera fly-through used to record the progress video headlessly:
 * `?tour=1` puts the camera under Tour control; `window.__wildshard.world.tour.setTime(seconds)` poses it,
 * then the capture script screenshots frame by frame (see scripts/progress-video.sh).
 */
export class Tour {
  duration = 40;
  private path: THREE.CatmullRomCurve3;
  private look: THREE.CatmullRomCurve3;
  time = 0;
  /** when true the tour owns the camera (set by ?tour=1 or the intro attract mode) */
  active = false;

  private camera: THREE.PerspectiveCamera;
  /** An explicit placement sampler keeps a neutral structures-only shell independent of unadmitted terrain. */
  constructor(camera: THREE.PerspectiveCamera, placementHeight: typeof heightAt = heightAt) {
    this.camera = camera;
    const eye = (x: number, z: number, h = 1.7) => new THREE.Vector3(x, placementHeight(x, z) + h, z);
    // south gate → up the trail → cabin 1 hollow → across to cabin 2 → ridge cabin 3 → ends looking over the planet
    // follows the trail centrelines (guaranteed clear of trunks): south gate → hollow (cabin 1)
    // → south trail → spur → ridge cabin 3, ending on the planet
    this.path = new THREE.CatmullRomCurve3([
      eye(0, -240, 1.7), eye(0, -200, 1.7), eye(-6, -150, 1.8), eye(-24, -105, 1.8), eye(-26, -70, 1.9), eye(-14, -46, 2.0),
      eye(-4, -20, 2.0), eye(10, 20, 2.1), eye(24, 60, 2.1), eye(36, 96, 2.2), eye(60, 114, 2.3), eye(90, 128, 2.2), eye(108, 136, 2.0), eye(120, 152, 2.6),
    ], false, 'centripetal', 0.5);
    this.look = new THREE.CatmullRomCurve3([
      eye(0, -200, 1.6), eye(-4, -150, 1.6), eye(-20, -110, 1.6), eye(-24, -70, 1.6), eye(-14, -34, 2.2), eye(-14, -34, 2.4),
      eye(20, 10, 1.6), eye(62, 30, 2.2), eye(30, 90, 1.6), eye(60, 114, 1.8), eye(118, 142, 2.6), eye(118, 142, 2.6), eye(118, 142, 2.4), eye(-200, 500, 260),
    ], false, 'centripetal', 0.5);
  }

  setTime(t: number): void {
    this.time = t;
    const u = THREE.MathUtils.clamp(t / this.duration, 0, 1);
    const p = this.path.getPointAt(u);
    const l = this.look.getPointAt(u);
    // subtle handheld sway
    p.y += Math.sin(t * 1.3) * 0.03;
    this.camera.position.copy(p);
    this.camera.lookAt(l);
    this.camera.rotation.z += Math.sin(t * 0.7) * 0.004;
  }
}
