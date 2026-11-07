/**
 * The javelins' law, renderer-free (CI12: the Nalati tape throws, lands and recovers real javelins without the spear's
 * view): the pool's slots, a throw's start, the flight (gravity at 120 Hz substeps, the head's sweep against the world and
 * the creatures), and how a javelin comes to rest: dropped beside a creature it hit, sunk in water, stuck in what takes a
 * point, or lying on what does not. three's vector maths only (no renderer, no page runtime); the world, the creatures,
 * water, floors, randomness and what a hit does arrive as ports. `HeldPolearm` keeps the aim, the quiver and the drawing.
 *
 *   const flight = new JavelinFlight(slots, profile, ports);
 *   if (flight.free()) flight.launch(origin, rotation, forward, mount);   flight.fly(dt);
 */
import * as THREE from 'three';
import type { ImpactSurface } from '@wildshard/engine/combat/Weapon';
import { sticksIn, type Hit } from '@wildshard/engine/physics/query';
import type { Material } from '@wildshard/engine/physics/surface';

/** a pool slot: 0 none · 1 flying · 2 lying where it landed */
export interface JavelinSlot { state: 0 | 1 | 2; pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; age: number }
export interface JavelinFlightProfile {
  readonly speed: number; readonly gravity: number; readonly damage: number; readonly headMultiplier: number;
  readonly radius: number; readonly headOffset: number;
}
/** a creature the head swept into */
export interface JavelinTargetHit { readonly animal: { readonly alive: boolean }; readonly point: THREE.Vector3; readonly headshot: boolean }
export interface JavelinPorts<H extends JavelinTargetHit> {
  /** the world along the head's sweep (the physics query), null: clear */
  readonly worldHit: (from: THREE.Vector3, to: THREE.Vector3, radius: number) => Hit | null;
  /** the creatures along a ray up to `max` (null: no creature targets) */
  readonly raycast: ((origin: THREE.Vector3, dir: THREE.Vector3, max: number) => H | null) | null;
  /** a creature took `damage` from the javelin flying along `dir`: its damage, stagger and the weapon's hit / flesh impact */
  readonly strike: (hit: H, damage: number, dir: THREE.Vector3) => void;
  /** a javelin met a surface at `at` */
  readonly impact: (surface: ImpactSurface, at: THREE.Vector3) => void;
  /** the water surface over (x, z), null: none */
  readonly water: (x: number, z: number) => number | null;
  /** the floor under (x, y, z): a deck, a rock or the turf */
  readonly floor: (x: number, y: number, z: number) => number;
  readonly random: () => number;
  /** what a world material sounds and looks like when struck */
  readonly surface: (material: Material) => ImpactSurface;
  /** the weapon's damage scale now */
  readonly damageScale: () => number;
}

const Y = new THREE.Vector3(0, 1, 0);

export class JavelinFlight<H extends JavelinTargetHit = JavelinTargetHit> {
  private readonly v1 = new THREE.Vector3(); private readonly v2 = new THREE.Vector3(); private readonly v3 = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(); private readonly head = new THREE.Vector3(); private readonly nrm = new THREE.Vector3();
  private readonly stickDir = new THREE.Vector3();
  constructor(readonly slots: readonly JavelinSlot[], private readonly profile: JavelinFlightProfile, private readonly ports: JavelinPorts<H>) {}

  /** a slot is free for a throw */
  free(): boolean { return this.slots.some(x => x.state === 0); }
  /** Throw from the aim (`origin`, `rotation`, `forward`): the first free slot flies from the hand, nudged up, at the throw's
   *  speed, less the horse's motion when mounted. False when every slot is taken. */
  launch(origin: THREE.Vector3, rotation: THREE.Quaternion, forward: THREE.Vector3, mount: { readonly yaw: number; readonly speed: number } | null): boolean {
    const j = this.slots.find((x) => x.state === 0);
    if (j === undefined) return false;
    this.v1.set(0.22, 0.05, -0.3).applyQuaternion(rotation).add(origin);
    this.v2.set(1, 0, 0).applyQuaternion(rotation);
    this.dir.copy(forward).applyAxisAngle(this.v2, 0.035).normalize();
    j.state = 1; j.age = 0; j.pos.copy(this.v1); j.vel.copy(this.dir).multiplyScalar(this.profile.speed);
    if (mount !== null) { j.vel.x -= Math.sin(mount.yaw) * mount.speed; j.vel.z -= Math.cos(mount.yaw) * mount.speed; }
    j.q.setFromUnitVectors(Y, this.dir);
    return true;
  }

  /** Step every flying javelin `dt` seconds. */
  fly(dt: number): void {
    const profile = this.profile, ports = this.ports, v1 = this.v1, v3 = this.v3, dir = this.dir, head = this.head;
    for (const j of this.slots) {
      if (j.state !== 1) continue;
      j.age += dt;
      let rem = dt;
      while (rem > 0) { // every way out of the flight breaks the loop
        const h = Math.min(rem, 1 / 120); rem -= h;
        v1.copy(j.pos);
        j.vel.y -= profile.gravity * h; j.pos.addScaledVector(j.vel, h);
        const seg = this.v2.subVectors(j.pos, v1), len = seg.length();
        if (len < 1e-6) continue;
        dir.copy(seg).multiplyScalar(1 / len);
        v3.copy(v1).addScaledVector(dir, profile.headOffset);
        head.copy(v3).addScaledVector(dir, len);
        const wall = ports.worldHit(v3, head, profile.radius);
        if (ports.raycast !== null) {
          const hit = ports.raycast(v3, dir, wall ? wall.distance : len);
          if (hit?.animal.alive === true) {
            const dmg = Math.round(profile.damage * (hit.headshot ? profile.headMultiplier : 1) * ports.damageScale());
            ports.strike(hit, dmg, dir);
            this.drop(j, hit.point);
            break;
          }
        }
        if (wall) {
          v3.set(wall.point.x, wall.point.y, wall.point.z);
          if (wall.material === 'ground') {
            const ws = ports.water(v3.x, v3.z);
            if (ws !== null && ws > v3.y) { j.state = 0; ports.impact('ground', v3); break; }
          }
          if (sticksIn(wall.material)) { this.stick(j, v3.addScaledVector(dir, profile.radius), dir, ports.surface(wall.material)); break; }
          this.nrm.set(wall.normal.x, wall.normal.y, wall.normal.z);
          if (this.nrm.dot(dir) > 0) this.nrm.negate();
          this.lie(j, v3, this.nrm, ports.surface(wall.material));
          break;
        }
        if (j.age > 8 || j.pos.y < -200) { j.state = 0; break; }
        j.q.setFromUnitVectors(Y, dir);
      }
    }
  }

  /** stuck by its point in what it struck, along its flight */
  private stick(j: JavelinSlot, at: THREE.Vector3, dir: THREE.Vector3, surface: ImpactSurface): void {
    j.state = 2; j.age = 0; j.vel.set(0, 0, 0);
    j.q.setFromUnitVectors(Y, this.stickDir.copy(dir).normalize());
    j.pos.copy(at).addScaledVector(this.stickDir, -0.58);
    this.ports.impact(surface, at);
  }
  /** lying on what it glanced off: along the surface, its flight's direction flattened onto it */
  private lie(j: JavelinSlot, at: THREE.Vector3, n: THREE.Vector3, surface: ImpactSurface): void {
    const along = this.v2.copy(this.dir).addScaledVector(n, -this.dir.dot(n));
    if (along.lengthSq() < 1e-6) along.set(1, 0, 0);
    along.normalize();
    j.state = 2; j.age = 0; j.vel.set(0, 0, 0);
    j.q.setFromUnitVectors(Y, along);
    j.pos.copy(at).addScaledVector(n, 0.04).addScaledVector(along, -0.58);
    this.ports.impact(surface, at);
  }
  /** dropped on the floor beside the creature it hit, at a random side */
  private drop(j: JavelinSlot, at: THREE.Vector3): void {
    const a = this.ports.random() * Math.PI * 2;
    this.v1.set(at.x + Math.cos(a) * 0.6, 0, at.z + Math.sin(a) * 0.6);
    this.v1.y = this.ports.floor(this.v1.x, at.y + 1, this.v1.z);   // the turf, a deck, a rock under it
    this.dir.set(Math.cos(a + 1.3) * 0.7, -0.55, Math.sin(a + 1.3) * 0.7).normalize();
    j.state = 2; j.age = 0; j.vel.set(0, 0, 0);
    j.q.setFromUnitVectors(Y, this.dir);
    j.pos.copy(this.v1).addScaledVector(this.dir, -0.45);
  }
}
