import { Vector3, type Matrix4 } from 'three';
import type { Hit } from '../physics/query';
import type { ImpactSurface } from './Weapon';
import type { TargetAnimal, TargetHit } from '../../../client/engine/combat/types';
import { projectileFlightStep, ProjectileSlots, type FlightSlot, type ProjectileFlight } from './projectileFlight';
import { ProjectileContact, StoppedProjectileSlots, type StoppedProjectile } from './projectileContact';

/**
 * A drawn projectile's whole law with no scene (an arrow, a patrol's arrow at the player): the flight slots, the wind,
 * the player's body (an enemy arrow), the targets and the world, the glance, the stick and the recovery. The browser's
 * Projectiles (combat/view/projectile.ts) draws it through the view ports; a Node simulation (CI12's tapes) runs the same
 * law over its own physics world and player feet.
 */
export interface ProjectileLawKind extends ProjectileFlight {
  /** metres from the tip to the nock; how deep the tip sits (m); the chance a stuck one survives a pickup */
  length: number; bury: number; recover: number;
  /** flying at once (older ones recycled), authored substeps and lifetime (s), stuck ones kept */
  maxFlying: number; substeps?: number; lifetime?: number; maxStuck: number;
  /** false: never sticks; false: flies through animals; the player's body an enemy arrow strikes; the swept ball (m) */
  stick?: boolean; hitsAnimals?: boolean; hurtsPlayer?: { radius: number; height: number }; radius?: number;
}
/** the wind the projectiles drift in: m/s in XZ at a world point */
export interface ProjectileWind { vecAt: (x: number, z: number, out: Vector3) => Vector3 }
/** A flight's own numbers: where it left, its damage scale and the hit's extra multiplier. */
export interface ProjectileFlightData { readonly origin: Vector3; scale: number; hitScale: ((hit: TargetHit) => number) | undefined; /** The command `seq` of an own shot off the wire, 0 for none. */ shot: number }
export type LawFlight<V extends object> = FlightSlot<ProjectileFlightData & V>;
export type LawStuck<S> = StoppedProjectile<S, TargetAnimal>;
export interface ProjectileLawPorts<V extends object, S> {
  /** the player's feet (read live), the play extent (m from the centre), the floor under a point, the world's first hit */
  readonly feet: Vector3; readonly extent: number; readonly floorAt: (x: number, y: number, z: number) => number;
  readonly world: (from: Vector3, to: Vector3, radius: number) => Hit | null;
  readonly targets: (from: Vector3, direction: Vector3, distance: number) => TargetHit | null;
  readonly wind: () => ProjectileWind | null; readonly surface: (wall: Hit) => ImpactSurface;
  readonly random: () => number; readonly canRecover: () => boolean; readonly recover: (survived: boolean) => void;
  /** a flight's / a stuck one's view state, made once per slot */
  readonly flight: (slot: number) => V; readonly stuck: (index: number) => S;
  /** the view: a flight moved / ended; a stuck one placed (`from` its flight) / changed / removed; an impact's puff */
  readonly moved: (flight: LawFlight<V>, dt: number) => void; readonly ended: (flight: LawFlight<V>) => void;
  readonly settled: (stuck: LawStuck<S>, from: LawFlight<V>) => void;
  readonly changed: (stuck: LawStuck<S>) => void; readonly removed: (stuck: LawStuck<S>) => void;
  readonly impact: (surface: ImpactSurface, at: Vector3, direction: Vector3) => void;
  /** an enemy projectile struck the player; a shot struck a target (before / after its damage) */
  readonly playerHit: (point: Vector3, direction: Vector3) => void;
  readonly targetHit: (hit: TargetHit) => void;
  readonly hit: (kind: string, headshot: boolean, killed: boolean, point: Vector3, damage: number) => void;
  /** Who lands a shot's damage, and whether it killed. Absent, it lands on the target with no owner. */
  readonly strike?: (flight: V, animal: TargetAnimal, damage: number, point: Vector3, direction: Vector3) => boolean;
}

/** the ball an arrow sweeps through the world (the broadhead) */
export const ARROW_RADIUS = 0.02;
const GLANCE = { lift: 0.03, keep: 0.35, bounce: 0.25, maxSpeed: 9 };
/** m: the pickup's horizontal reach from the feet, the highest midpoint the player can pull out, and below */
const RECOVER_REACH = { radius: 1.25, up: 2.1, down: 1.2 };
const _wind = new Vector3(), _hit = new Vector3();

/** where along o + d·[0, len] the segment first comes within `r` of the vertical axis from `feet` to `feet + h`, or −1 */
export function segmentCapsule(o: Vector3, d: Vector3, len: number, feet: Vector3, r: number, h: number): number {
  // horizontal: solve |(o + d t − feet)_xz| = r; then check the height at that t (the caps are ignored: a body, not a pill)
  const ox = o.x - feet.x, oz = o.z - feet.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return -1;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = c < 0 ? 0 : -1;                       // starts inside the body's circle
  if (t < 0 || t > len) return -1;
  const y = o.y + d.y * t - feet.y;
  return y >= 0 && y <= h ? t : -1;
}

export class ProjectileLaw<V extends object, S> {
  readonly pool: ProjectileSlots<ProjectileFlightData & V>;
  readonly stopped: StoppedProjectileSlots<S, TargetAnimal>;
  private readonly contacts: ProjectileContact<LawFlight<V>>;
  private readonly kind: ProjectileLawKind;
  private readonly ports: ProjectileLawPorts<V, S>;
  constructor(kind: ProjectileLawKind, ports: ProjectileLawPorts<V, S>) {
    this.kind = kind; this.ports = ports;
    this.pool = new ProjectileSlots<ProjectileFlightData & V>(kind.maxFlying, slot => Object.assign(ports.flight(slot), { origin: new Vector3(), scale: 1, hitScale: undefined, shot: 0 }), {
      substeps: kind.substeps ?? 4, extent: ports.extent, floor: -150, lifetime: kind.lifetime ?? 12,
      integrate: (slot, h) => { this.step(slot.pos, slot.vel, h); }, contact: (slot, previous) => this.testHit(slot, previous),
      expired: slot => { this.end(slot); }, moved: (slot, dt) => { ports.moved(slot, dt); },
    });
    this.stopped = new StoppedProjectileSlots<S, TargetAnimal>({ capacity: kind.maxStuck, length: kind.length, bury: kind.bury,
      radius: kind.radius ?? ARROW_RADIUS, reach: RECOVER_REACH, recover: kind.recover, recoveryStride: 8 }, {
      feet: ports.feet, floorAt: ports.floorAt,
      body: animal => animal,
      attachment: (animal, point): { readonly matrixWorld: Matrix4 } | null => animal.stuckFrame?.(point) ?? null,
      canRecover: () => ports.canRecover(), recover: survived => { ports.recover(survived); }, random: ports.random,
      changed: slot => { ports.changed(slot); }, removed: slot => { ports.removed(slot); },
    }, index => ports.stuck(index));
    this.contacts = new ProjectileContact<LawFlight<V>>({ glance: GLANCE, spentRest: 'any', impactAfterLift: false, impactOnRepeatedGlance: true }, {
      beforeWorld: (flight, from, direction, length) => {
        const hp = this.kind.hurtsPlayer;
        if (hp === undefined) return false;
        const t = segmentCapsule(from, direction, length, ports.feet, hp.radius, hp.height);
        if (!(t >= 0)) return false;
        _hit.copy(from).addScaledVector(direction, t); ports.playerHit(_hit, direction);
        this.stop(flight, _hit, direction, 'flesh', null, false); return true;
      },
      world: ports.world,
      target: (from, direction, distance) => this.kind.hitsAnimals !== false ? ports.targets(from, direction, distance) : null,
      hit: (flight, hit, direction) => {
        const animal = hit.animal;
        // an own shot off the wire is the server's to settle: here it only stops where it struck
        if (flight.shot !== 0) { this.stop(flight, hit.point, direction, 'flesh', animal.alive ? animal : null, true); return; }
        ports.targetHit(hit);
        const damage = Math.max(1, Math.round(animal.damageFor(hit.headshot, hit.point.distanceTo(flight.origin)) * flight.scale * (flight.hitScale?.(hit) ?? 1)));
        const killed = ports.strike?.(flight, animal, damage, hit.point, direction) ?? animal.applyDamage(damage, hit.point, direction);
        ports.hit(animal.kind, hit.headshot, killed, hit.point, damage);
        this.stop(flight, hit.point, direction, 'flesh', animal.alive ? animal : null, true);
        if (!animal.alive) this.stopped.dropLast();
      },
      stop: (flight, at, direction, wall) => { this.stop(flight, at, direction, ports.surface(wall), null, true); },
      rest: (flight, at, direction) => { this.end(flight); this.stopped.settle(at, direction, slot => { ports.settled(slot, flight); }); },
      impact: (at, direction, wall) => { ports.impact(ports.surface(wall), at, direction); },
      expire: flight => { this.end(flight); },
    });
  }
  /** loose one from `origin` (world) with `velocity` (m/s, any carrier velocity already added); the flight it took */
  launch(origin: Vector3, velocity: Vector3, opts: { readonly damageScale: number; readonly onHitScale?: ((hit: TargetHit) => number) | undefined; readonly shot?: number }): LawFlight<V> {
    const f = this.pool.take();
    f.pos.copy(origin); f.origin.copy(origin); f.vel.copy(velocity);
    f.scale = opts.damageScale; f.hitScale = opts.onHitScale; f.shot = opts.shot ?? 0;
    return f;
  }
  /** The server settled this own shot (J47): its predicted flight ends where it has got to. */
  endShot(shot: number): void { for (const f of this.pool.slots) if (f.active && f.shot === shot) this.end(f); }
  /** one frame: every flight's substeps and contacts, then the stuck ones' attachments and recovery */
  update(dt: number): void { this.pool.step(dt); this.stopped.update(); }
  /** the one integrator (flight and the preview share it) */
  step(pos: Vector3, vel: Vector3, h: number): void {
    const k = this.kind, field = this.ports.wind();
    const wind = field !== null && k.windCoupling > 0 ? field.vecAt(pos.x, pos.z, _wind) : null;
    projectileFlightStep(pos, vel, h, k, wind);
  }
  private testHit(flight: LawFlight<V>, from: Vector3): boolean { return this.contacts.step(flight, from, this.kind.radius ?? ARROW_RADIUS, this.kind.length, this.kind.stick !== false); }
  private stop(f: LawFlight<V>, point: Vector3, dir: Vector3, surface: ImpactSurface, animal: TargetAnimal | null, stick: boolean): void {
    this.end(f);
    this.ports.impact(surface, point, dir);
    if (!stick || this.kind.stick === false) return;
    this.stopped.stop(point, dir, surface === 'flesh', animal, slot => { this.ports.settled(slot, f); });
  }
  private end(f: LawFlight<V>): void { f.active = false; this.ports.ended(f); }
}
