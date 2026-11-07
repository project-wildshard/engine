import * as THREE from 'three';

export interface ZiplineSpec { top: THREE.Vector3; bottom: THREE.Vector3; /** sag in metres at mid-span per 100 m (default 1.6) */ sag?: number }

export const DECK_H = 0.5, CABLE_ABOVE = 3.6, LANDING_ABOVE = 3.2;
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** the zipline's layout on its ends: the launch deck, the cable's two ends and its sag (world) */
export class ZiplineLayout {
  /** the cable's two ends (world) */
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  readonly len: number;
  readonly sag: number;
  readonly dir = new THREE.Vector3();
  /** the flat direction down the line */
  readonly flat: THREE.Vector3;
  readonly deck = { x: 0, z: 0, yaw: 0, y: 0, hw: 1.2, hd: 1.8 };

  constructor(readonly spec: ZiplineSpec) {
    const flat = this.flat = V(spec.bottom.x - spec.top.x, 0, spec.bottom.z - spec.top.z).normalize();
    // the deck: 3.6 m long, its outer edge at `top`, running back up the slope
    this.deck.yaw = Math.atan2(flat.x, flat.z);
    this.deck.x = spec.top.x - flat.x * this.deck.hd; this.deck.z = spec.top.z - flat.z * this.deck.hd; this.deck.y = spec.top.y + DECK_H;
    this.a.set(spec.top.x + flat.x * 0.4, this.deck.y + CABLE_ABOVE, spec.top.z + flat.z * 0.4);
    this.b.set(spec.bottom.x, spec.bottom.y + LANDING_ABOVE, spec.bottom.z);
    this.len = this.a.distanceTo(this.b);
    this.sag = (spec.sag ?? 1.6) * (this.len / 100);
    this.dir.subVectors(this.b, this.a).normalize();
  }

  /** a point on the cable at arc position s (0 … len), sagging as a parabola */
  at(s: number, out: THREE.Vector3): THREE.Vector3 {
    const t = THREE.MathUtils.clamp(s / this.len, 0, 1);
    return out.lerpVectors(this.a, this.b, t).setY(this.a.y + (this.b.y - this.a.y) * t - this.sag * 4 * t * (1 - t));
  }

  /** where the trolley parks at the top, and its turn about +Y */
  park(out: THREE.Vector3): number { this.at(0.6, out); return Math.atan2(this.dir.x, this.dir.z) + Math.PI / 2; }
}
