import { Vector3 } from 'three';

/** The flight numbers of a drawn projectile (an arrow, a thrown bolt): gravity (m/s²), speed-squared drag and the sideways
 *  pull toward the wind velocity (/s). `ProjectileKind` (combat/view/projectile.ts) carries them with its view. */
export interface ProjectileFlight { gravity: number; drag: number; windCoupling: number }

/** Deterministic flight substep. Only the supplied position/velocity are written; no world or clock is read. Renderer-free:
 *  the browser's Projectiles (combat/view/projectile.ts) and a headless runtime's arrows fly the one law. */
export function projectileFlightStep(pos: Vector3, vel: Vector3, h: number,
  kind: ProjectileFlight, wind: Readonly<Vector3> | null = null): void {
  vel.y -= kind.gravity * h;
  if (wind !== null && kind.windCoupling > 0) {
    const sp = vel.length();
    if (sp > 1e-3) {
      let x = wind.x - vel.x, y = -vel.y, z = wind.z - vel.z;
      const along = -(x * vel.x + y * vel.y + z * vel.z) / (sp * sp);
      x += vel.x * along; y += vel.y * along; z += vel.z * along;
      const coupling = kind.windCoupling * h;
      vel.x += x * coupling;
      vel.y += y * coupling;
      vel.z += z * coupling;
    }
  }
  vel.multiplyScalar(1 - kind.drag * h * vel.length() * 0.1);
  pos.addScaledVector(vel, h);
}


/** Mechanical flight-slot state; presentation/ammunition data is borrowed. */
export interface FlightSlotState { pos: Vector3; vel: Vector3; active: boolean; age: number; glanced: boolean }
export type FlightSlot<Data extends object> = FlightSlotState & Data;
/** Declared slot bounds and trusted integration/contact/presentation ports. */
export interface FlightSlotPorts<Data extends object> {
  readonly substeps: number; readonly extent: number; readonly floor: number; readonly lifetime: number;
  readonly integrate: (slot: FlightSlot<Data>, h: number) => void;
  readonly contact: (slot: FlightSlot<Data>, previous: Vector3) => boolean;
  readonly advanced?: (slot: FlightSlot<Data>) => void;
  readonly moved?: (slot: FlightSlot<Data>, dt: number) => void;
  readonly expired?: (slot: FlightSlot<Data>) => void;
}
/** Bounded renderer-free reuse, age and substep owner. The same pool serves
 * physical held bolts and drawn arrows; it knows no target, damage or view.
 */
export class ProjectileSlots<Data extends object> {
  readonly slots: FlightSlot<Data>[];
  private readonly ports: FlightSlotPorts<Data>;
  private readonly previous = new Vector3();
  constructor(count: number, data: (slot: number) => Data, ports: FlightSlotPorts<Data>) {
    if (!Number.isInteger(count) || count < 1 || count > 1024 || !Number.isInteger(ports.substeps)
      || ports.substeps < 1 || ports.substeps > 64 || !Number.isFinite(ports.extent) || ports.extent < 0
      || !Number.isFinite(ports.floor) || !Number.isFinite(ports.lifetime) || ports.lifetime < 0) throw new RangeError('Invalid flight slot bounds');
    this.ports = ports;
    this.slots = Array.from({ length: count }, (_, slot) => Object.assign(data(slot), {
      pos: new Vector3(), vel: new Vector3(), active: false, age: 0, glanced: false,
    }));
  }
  /** First free slot, otherwise the oldest; equal ages keep the first slot. */
  take(): FlightSlot<Data> {
    let picked = this.slots[0];
    if (picked === undefined) throw new Error('Flight slot pool is empty');
    for (let i = 0; i < 1024; i++) {
      const slot = this.slots[i]; if (slot === undefined) break;
      if (!slot.active) { picked = slot; break; }
      if (slot.age > picked.age) picked = slot;
    }
    picked.active = true; picked.age = 0; picked.glanced = false;
    return picked;
  }
  /** Step each live slot once. A consumed contact stops before presentation. */
  step(dt: number): void {
    const ports = this.ports, h = dt / ports.substeps;
    for (let i = 0; i < 1024; i++) {
      const slot = this.slots[i]; if (slot === undefined) break;
      if (!slot.active) continue;
      slot.age += dt;
      let stopped = false;
      for (let sub = 0; sub < 64; sub++) {
        if (sub >= ports.substeps) break;
        this.previous.copy(slot.pos); ports.integrate(slot, h);
        if (ports.contact(slot, this.previous)) { slot.active = false; stopped = true; break; }
        ports.advanced?.(slot);
      }
      if (stopped) continue;
      if (Math.abs(slot.pos.x) > ports.extent || Math.abs(slot.pos.z) > ports.extent
        || slot.pos.y < ports.floor || slot.age > ports.lifetime) { slot.active = false; ports.expired?.(slot); continue; }
      ports.moved?.(slot, dt);
    }
  }
}
