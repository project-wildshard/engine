import { Matrix4, Vector3 } from 'three';
import * as v from 'valibot';
import { sticksIn, type Hit } from '../physics/query';
import type { TargetHit } from '../../../client/engine/combat/types';

/** Caller-owned contact vectors. No collision query, clock, allocation or random draw is performed here. */
export interface ProjectileReach { radius: number; up: number; down: number }
export interface ProjectileGlance { lift: number; keep: number; bounce: number; maxSpeed: number }

/** Move a swept sphere's centre to the tip's surface contact along its flight. */
export function projectileContactTip(at: Vector3, direction: Vector3, normal: Vector3, radius: number): void {
  at.addScaledVector(direction, radius / Math.max(0.25, -normal.dot(direction)));
}

/** Retain tangential motion and the authored fraction of normal bounce, in the shipping operation order. */
export function projectileGlance(at: Vector3, velocity: Vector3, normal: Vector3, policy: ProjectileGlance): void {
  at.addScaledVector(normal, policy.lift);
  const vn = velocity.dot(normal);
  velocity.addScaledVector(normal, -vn).multiplyScalar(policy.keep).addScaledVector(normal, -vn * policy.bounce);
  if (velocity.length() > policy.maxSpeed) velocity.setLength(policy.maxSpeed);
}

/** Lie across the contacted surface. `along` is scratch/output; the supplied axes are not written. */
export function projectileRest(at: Vector3, direction: Vector3, normal: Vector3, radius: number, length: number,
  along: Vector3, yAxis: Vector3, xAxis: Vector3): void {
  along.copy(direction).addScaledVector(normal, -direction.dot(normal));
  if (along.lengthSq() < 1e-6) along.crossVectors(normal, Math.abs(normal.y) < 0.9 ? yAxis : xAxis);
  along.normalize();
  at.addScaledVector(normal, -radius * 0.8).addScaledVector(along, length * 0.5);
}

/** Insert a tip by the caller's material-specific depth, preserving the input point. */
export function projectileBury(point: Vector3, direction: Vector3, depth: number, out: Vector3): Vector3 {
  return out.copy(point).addScaledVector(direction, depth);
}

/** Detach into the supplied floor height. The caller decides when its attachment is dead or hidden. */
export function projectileDrop(position: Vector3, direction: Vector3, floor: number, bury: number): void {
  direction.set(direction.x * 0.35, -1, direction.z * 0.35).normalize();
  position.set(position.x, floor, position.z).addScaledVector(direction, bury * 1.5);
}

/** Test the shaft midpoint. Eligibility, capacity, reverse-order removal and survival draws remain caller-owned. */
export function projectileWithinReach(position: Vector3, direction: Vector3, length: number, feet: Vector3,
  reach: ProjectileReach): boolean {
  const mx = position.x - direction.x * length * 0.5;
  const my = position.y - direction.y * length * 0.5;
  const mz = position.z - direction.z * length * 0.5;
  return !(Math.hypot(mx - feet.x, mz - feet.z) > reach.radius || my - feet.y > reach.up || my - feet.y < -reach.down);
}

/** Authored continuation of stopped shafts; flight, damage and collision stay with their owners. */
export interface StoppedProjectileRow {
  readonly capacity: number; readonly length: number; readonly bury: number; readonly radius: number;
  readonly reach: ProjectileReach; readonly recover: number; readonly recoveryStride: number;
}
export interface StoppedProjectileBody { readonly position: Vector3; readonly yaw?: number; readonly alive: boolean; readonly hidden?: boolean }
export interface StoppedProjectile<T, B> {
  readonly data: T; readonly position: Vector3; readonly direction: Vector3;
  body: B | null; readonly local: Vector3; readonly localDirection: Vector3;
  frame: { readonly matrixWorld: Matrix4 } | null; recoverable: boolean;
}
export interface StoppedProjectilePorts<T, B> {
  readonly feet: Vector3; readonly floorAt: (x: number, y: number, z: number) => number;
  readonly body: (key: B) => StoppedProjectileBody | undefined;
  readonly attachment?: (key: B, point: Vector3) => { readonly matrixWorld: Matrix4 } | null;
  readonly canRecover: () => boolean; readonly recover: (survived: boolean) => void; readonly random: () => number;
  readonly changed?: (slot: StoppedProjectile<T, B>) => void; readonly removed?: (slot: StoppedProjectile<T, B>) => void;
}
const stoppedFinite = v.pipe(v.number(), v.finite());
const stoppedVector = v.tuple([stoppedFinite, stoppedFinite, stoppedFinite]);
/** The retained version-one native save envelope; the capacity is the admitted row's bound. */
const stoppedSavedSlot = v.strictObject({ position: stoppedVector, direction: stoppedVector, body: v.nullable(v.string()),
  local: stoppedVector, localDirection: stoppedVector, recoverable: v.boolean() });
const stoppedSavedFields = { version: v.literal(1), frame: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)) };
const stoppedSavedSchema: v.GenericSchema<StoppedProjectileSaveDataInput, StoppedProjectileSaveData> = v.strictObject({ ...stoppedSavedFields, stuck: v.array(stoppedSavedSlot) });
export type StoppedProjectileSaved = v.InferOutput<typeof stoppedSavedSchema>;
export function stoppedProjectileSaved(capacity: number): v.GenericSchema<unknown, StoppedProjectileSaved> {
  return v.strictObject({ ...stoppedSavedFields, stuck: v.pipe(v.array(stoppedSavedSlot), v.maxLength(capacity)) });
}
/** One bounded stopped-shaft roster, attachment update and reverse-order recovery owner.
 * Native ids and page actor references are borrowed; each page slot keeps its original draw id.
 * `update` advances the source update count, not elapsed seconds. Bone frames remain page-owned.
 */
export class StoppedProjectileSlots<T, B> {
  readonly slots: StoppedProjectile<T, B>[] = [];
  private readonly free: StoppedProjectile<T, B>[];
  private frame = 0;
  private readonly along = new Vector3();
  private readonly y = new Vector3(0, 1, 0);
  private readonly x = new Vector3(1, 0, 0);
  private readonly inverse = new Matrix4();
  private readonly row: StoppedProjectileRow;
  private readonly ports: StoppedProjectilePorts<T, B>;
  constructor(row: StoppedProjectileRow, ports: StoppedProjectilePorts<T, B>, make: (index: number) => T) {
    if (!Number.isInteger(row.capacity) || row.capacity < 0 || row.capacity > 128
      || !Number.isInteger(row.recoveryStride) || row.recoveryStride < 1 || row.recoveryStride > 128)
      throw new RangeError('Invalid stopped projectile roster');
    this.row = row; this.ports = ports;
    this.free = Array.from({ length: row.capacity }, (_, index) => ({ data: make(index), position: new Vector3(), direction: new Vector3(),
      body: null, local: new Vector3(), localDirection: new Vector3(), frame: null, recoverable: true }));
  }
  get count(): number { return this.slots.length; }
  stop(point: Vector3, direction: Vector3, flesh: boolean, key: B | null, initialize?: (slot: StoppedProjectile<T, B>) => void): void {
    const slot = this.take(); if (slot === undefined) return;
    projectileBury(point, direction, flesh ? this.row.bury * 2.2 : this.row.bury, slot.position);
    slot.direction.copy(direction); slot.body = key; slot.frame = null;
    slot.local.set(0, 0, 0); slot.localDirection.set(0, 0, 0); slot.recoverable = true;
    if (key !== null) {
      const frame = this.ports.attachment?.(key, point) ?? null, body = this.ports.body(key);
      if (frame !== null) {
        this.inverse.copy(frame.matrixWorld).invert(); slot.frame = frame;
        slot.local.copy(slot.position).applyMatrix4(this.inverse); slot.localDirection.copy(direction).transformDirection(this.inverse);
      } else if (body !== undefined) {
        slot.local.copy(slot.position).sub(body.position).applyAxisAngle(this.y, -(body.yaw ?? 0));
        slot.localDirection.copy(direction).applyAxisAngle(this.y, -(body.yaw ?? 0));
      }
    } else {
      const midY = slot.position.y - direction.y * this.row.length * 0.5;
      slot.recoverable = midY - this.ports.floorAt(slot.position.x, midY, slot.position.z) < this.row.reach.up - 0.2;
    }
    initialize?.(slot); this.slots.push(slot); this.ports.changed?.(slot);
  }
  rest(point: Vector3, direction: Vector3, normal: Vector3, initialize?: (slot: StoppedProjectile<T, B>) => void): void {
    const slot = this.take(); if (slot === undefined) return;
    slot.position.copy(point); projectileRest(slot.position, direction, normal, this.row.radius, this.row.length, this.along, this.y, this.x);
    slot.direction.copy(this.along); slot.body = null; slot.frame = null;
    slot.local.set(0, 0, 0); slot.localDirection.set(0, 0, 0); slot.recoverable = true;
    initialize?.(slot); this.slots.push(slot); this.ports.changed?.(slot);
  }
  /** A surface phase owner has already solved the stopped shaft pose. */
  settle(point: Vector3, direction: Vector3, initialize?: (slot: StoppedProjectile<T, B>) => void): void {
    const slot = this.take(); if (slot === undefined) return;
    slot.position.copy(point); slot.direction.copy(direction); slot.body = null; slot.frame = null;
    slot.local.set(0, 0, 0); slot.localDirection.set(0, 0, 0); slot.recoverable = true;
    initialize?.(slot); this.slots.push(slot); this.ports.changed?.(slot);
  }
  dropLast(): void { const slot = this.slots.at(-1); if (slot !== undefined) this.drop(slot); }
  drop(slot: StoppedProjectile<T, B>): void {
    slot.body = null; slot.frame = null;
    projectileDrop(slot.position, slot.direction, this.ports.floorAt(slot.position.x, slot.position.y, slot.position.z), this.row.bury);
    slot.recoverable = true; this.ports.changed?.(slot);
  }
  update(): void {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i]; if (slot?.body === null || slot === undefined) continue;
      const body = this.ports.body(slot.body);
      if (body?.alive !== true || body.hidden) { this.drop(slot); continue; }
      if (slot.frame !== null) {
        slot.position.copy(slot.local).applyMatrix4(slot.frame.matrixWorld); slot.direction.copy(slot.localDirection).transformDirection(slot.frame.matrixWorld);
      } else {
        slot.position.copy(slot.local).applyAxisAngle(this.y, body.yaw ?? 0).add(body.position); slot.direction.copy(slot.localDirection).applyAxisAngle(this.y, body.yaw ?? 0);
      }
      this.ports.changed?.(slot);
    }
    if (++this.frame % this.row.recoveryStride !== 0) return;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      if (slot === undefined || slot.body !== null || !slot.recoverable
        || !projectileWithinReach(slot.position, slot.direction, this.row.length, this.ports.feet, this.row.reach)) continue;
      if (!this.ports.canRecover()) return;
      this.remove(i); this.ports.recover(this.ports.random() < this.row.recover);
    }
  }
  clear(): void { while (this.slots.length > 0) this.remove(0); }
  snapshot(id: (body: B) => string): StoppedProjectileSaved {
    if (this.slots.some(slot => slot.frame !== null)) throw new Error('Stopped bone frames require their owning page save');
    return { version: 1 as const, frame: this.frame, stuck: this.slots.map(slot => ({ position: [slot.position.x, slot.position.y, slot.position.z] as [number, number, number],
      direction: [slot.direction.x, slot.direction.y, slot.direction.z] as [number, number, number], body: slot.body === null ? null : id(slot.body),
      local: [slot.local.x, slot.local.y, slot.local.z] as [number, number, number],
      localDirection: [slot.localDirection.x, slot.localDirection.y, slot.localDirection.z] as [number, number, number], recoverable: slot.recoverable })) };
  }
  restore(value: unknown, body: (id: string) => B): void {
    const saved = v.parse(stoppedProjectileSaved(this.row.capacity), value); this.clear(); this.frame = saved.frame;
    for (const row of saved.stuck) {
      const slot = this.free.pop(); if (slot === undefined) break;
      slot.position.set(...row.position); slot.direction.set(...row.direction); slot.body = row.body === null ? null : body(row.body);
      slot.local.set(...row.local); slot.localDirection.set(...row.localDirection); slot.frame = null; slot.recoverable = row.recoverable;
      this.slots.push(slot); this.ports.changed?.(slot);
    }
  }
  private take(): StoppedProjectile<T, B> | undefined { if (this.slots.length >= this.row.capacity) this.remove(0); return this.free.pop(); }
  private remove(index: number): void { const slot = this.slots.splice(index, 1)[0]; if (slot !== undefined) { this.ports.removed?.(slot); this.free.push(slot); } }
}

/** Surface phase policy; target/damage and draw owners remain borrowed ports. */
export interface ProjectileContactRow {
  readonly glance: ProjectileGlance;
  readonly spentRest: 'any' | 'upward';
  readonly impactAfterLift: boolean;
  readonly impactOnRepeatedGlance: boolean;
}
export interface ProjectileContactSlot { readonly pos: Vector3; readonly vel: Vector3; glanced: boolean }
export interface ProjectileContactPorts<T extends ProjectileContactSlot, H = TargetHit> {
  readonly world: (from: Vector3, to: Vector3, radius: number) => Hit | null;
  readonly target: (from: Vector3, direction: Vector3, distance: number) => H | null;
  readonly hit: (slot: T, hit: H, direction: Vector3) => void;
  readonly stop: (slot: T, at: Vector3, direction: Vector3, wall: Hit) => void;
  readonly rest: (slot: T, at: Vector3, direction: Vector3, normal: Vector3) => void;
  readonly impact: (at: Vector3, direction: Vector3, wall: Hit) => void;
  readonly expire: (slot: T) => void;
  readonly beforeWorld?: (slot: T, from: Vector3, direction: Vector3, length: number) => boolean;
}
/** Resolve a posed segment once, retaining its wall fence and the authored surface phase.
 * Radius, shaft length and sticking are live observations from the caller's existing profile.
 * Native hosts may supply their existing hit-result type through H; page callers retain TargetHit.
 * Scratch vectors are borrowed by synchronous ports only; no actor or physics service is owned here.
 */
export class ProjectileContact<T extends ProjectileContactSlot, H = TargetHit> {
  private readonly row: ProjectileContactRow;
  private readonly ports: ProjectileContactPorts<T, H>;
  private readonly withoutLift: ProjectileGlance;
  private readonly direction = new Vector3(); private readonly normal = new Vector3(); private readonly at = new Vector3();
  private readonly along = new Vector3(); private readonly y = new Vector3(0, 1, 0); private readonly x = new Vector3(1, 0, 0);
  constructor(row: ProjectileContactRow, ports: ProjectileContactPorts<T, H>) {
    this.row = row; this.ports = ports; this.withoutLift = { ...row.glance, lift: 0 };
  }
  step(slot: T, from: Vector3, radius: number, shaftLength: number, stick = true): boolean {
    const direction = this.direction.subVectors(slot.pos, from), length = direction.length();
    if (length < 1e-6) return false;
    direction.multiplyScalar(1 / length);
    if (this.ports.beforeWorld?.(slot, from, direction, length) === true) return true;
    const wall = this.ports.world(from, slot.pos, radius);
    const hit = this.ports.target(from, direction, wall ? wall.distance : length);
    if (hit !== null) { this.ports.hit(slot, hit, direction); return true; }
    if (wall === null) return false;
    const normal = this.normal.set(wall.normal.x, wall.normal.y, wall.normal.z);
    if (normal.dot(direction) > 0) normal.negate();
    const at = this.at.set(wall.point.x, wall.point.y, wall.point.z);
    if (slot.glanced && (this.row.spentRest === 'any' || normal.y >= 0.5)) {
      projectileRest(at, direction, normal, radius, shaftLength, this.along, this.y, this.x);
      this.ports.rest(slot, at, this.along, normal); return true;
    }
    if (!slot.glanced && sticksIn(wall.material)) {
      projectileContactTip(at, direction, normal, radius); this.ports.stop(slot, at, direction, wall); return true;
    }
    if (this.row.impactAfterLift) at.addScaledVector(normal, this.row.glance.lift);
    if (!slot.glanced || this.row.impactOnRepeatedGlance) this.ports.impact(at, direction, wall);
    if (!stick) { this.ports.expire(slot); return true; }
    projectileGlance(at, slot.vel, normal, this.row.impactAfterLift ? this.withoutLift : this.row.glance);
    slot.pos.copy(at); slot.glanced = true; return false;
  }
}

/** Complete admitted continuation, independent of validator implementation metadata. */
type StoppedProjectileSaveDataInput = StoppedProjectileSaveData;
interface StoppedProjectileSaveDataFields {
    stuck: {
        position: [
            number,
            number,
            number
        ];
        direction: [
            number,
            number,
            number
        ];
        body: string | null;
        local: [
            number,
            number,
            number
        ];
        localDirection: [
            number,
            number,
            number
        ];
        recoverable: boolean;
    }[];
    version: 1;
    frame: number;
}
type StoppedProjectileSaveData = { [Key in keyof StoppedProjectileSaveDataFields]: StoppedProjectileSaveDataFields[Key] };
