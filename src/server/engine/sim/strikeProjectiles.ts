import { Vector3 } from 'three';
import * as v from 'valibot';
import type { BrainPoint, StrikeSpec } from '../../../shared/engine/ai/strikes';
import { ProjectileSlots, projectileFlightStep, type FlightSlot } from '../../../shared/engine/combat/projectileFlight';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import { sweepBall, worldHit } from '../../../shared/engine/physics/query';
import type { SimHost, SimStateAdapter, SimValue } from '../sim';

const SLOT_COUNT = 128;
const LIFETIME = 30;
const finite = v.pipe(v.number(), v.finite());
const vector = v.tuple([finite, finite, finite]);
const savedFlight = v.strictObject({
  source: v.string(), strike: v.string(), at: vector, velocity: vector,
  age: v.pipe(finite, v.minValue(0), v.maxValue(LIFETIME)),
});
const Saved = v.pipe(v.array(v.nullable(savedFlight)), v.length(SLOT_COUNT));
interface Identity { source: string; spec: StrikeSpec | null }

const asTuple = ({ x, y, z }: Vector3): [number, number, number] => [x, y, z];

export function validateStrikeProjectile(projectile: NonNullable<StrikeSpec['projectile']>): void {
  if (![projectile.speed, projectile.gravity, projectile.radius].every(Number.isFinite)
    || projectile.speed <= 0 || projectile.gravity < 0 || projectile.radius <= 0) {
    throw new Error('Invalid strike projectile');
  }
}

/** A flight belongs to its strike and a slot in the sim, with no replicated actor. */
export class StrikeProjectiles implements SimStateAdapter {
  private readonly pool: ProjectileSlots<Identity>;
  private readonly host: SimHost;
  private readonly resolve: (source: string, strike: string) => StrikeSpec | undefined;
  private readonly contactPoint = new Vector3();
  private readonly direction = new Vector3();
  constructor(host: SimHost, resolve: (source: string, strike: string) => StrikeSpec | undefined) {
    this.host = host;
    this.resolve = resolve;
    this.pool = new ProjectileSlots<Identity>(SLOT_COUNT, () => ({ source: '', spec: null }), {
      substeps: 1, extent: CHUNK_HALF, floor: -CHUNK_HALF, lifetime: LIFETIME,
      integrate: (slot, dt) => {
        const projectile = slot.spec?.projectile;
        if (projectile === undefined) throw new Error('Missing active strike flight');
        projectileFlightStep(slot.pos, slot.vel, dt, { gravity: projectile.gravity, drag: 0, windCoupling: 0 });
      },
      contact: (slot, previous) => this.contact(slot, previous),
    });
  }
  launch(source: string, spec: StrikeSpec, from: Readonly<Vector3>, at: BrainPoint): void {
    const projectile = spec.projectile;
    if (projectile === undefined) throw new Error('Missing strike flight definition');
    const slot = this.pool.take();
    slot.source = source;
    slot.spec = spec;
    slot.pos.copy(from);
    slot.vel.set(at.x, at.y, at.z).sub(from).normalize().multiplyScalar(projectile.speed);
  }
  step(dt: number): void { this.pool.step(dt); }
  removeSource(source: string): void {
    for (const slot of this.pool.slots) {
      if (slot.source === source) { slot.active = false; slot.spec = null; }
    }
  }
  private contact(slot: FlightSlot<Identity>, previous: Vector3): boolean {
    const { host } = this, spec = slot.spec, projectile = spec?.projectile;
    if (projectile === undefined || spec === null) return true;
    const world = worldHit(host.physics, previous, slot.pos, projectile.radius);
    const playerHit = sweepBall(host.physics, previous, slot.pos, projectile.radius, ['PLAYER'], undefined, 'CREATURE');
    if (playerHit === null || (world !== null && world.distance <= playerHit.distance)) return world !== null;
    const victim = typeof playerHit.owner === 'string' ? host.players.get(playerHit.owner) : undefined;
    if (victim === undefined || host.parked.has(victim.id) || !victim.health.alive) return world !== null;
    const source = host.entities.get(slot.source);
    if (source === undefined) return true;
    this.contactPoint.copy(playerHit.point);
    this.direction.copy(slot.vel).normalize();
    host.combat.hit({ source: source.combatActor(), sourceTags: spec.tags, target: victim.health, amount: spec.damage,
      point: this.contactPoint, dir: this.direction, from: previous, moveId: spec.id,
      cause: { kind: source.kind, label: source.label },
      ...(spec.knockbackDistance === undefined ? {} : { shoveDistance: spec.knockbackDistance }),
    });
    return true;
  }
  snapshot(): SimValue {
    return this.pool.slots.map(slot => slot.active && slot.spec !== null ?
      { source: slot.source, strike: slot.spec.id, at: asTuple(slot.pos), velocity: asTuple(slot.vel), age: slot.age } : null);
  }
  restore(value: SimValue): void {
    const rows = v.parse(Saved, value).map(row => {
      if (row === null) return null;
      const spec = this.resolve(row.source, row.strike);
      if (spec?.projectile === undefined) throw new Error('Incompatible saved strike flight');
      return { row, spec };
    });
    for (const [index, slot] of this.pool.slots.entries()) {
      const saved = rows[index];
      if (saved === undefined || saved === null) { slot.active = false; slot.spec = null; continue; }
      const { row, spec } = saved;
      slot.source = row.source; slot.spec = spec; slot.age = row.age;
      slot.pos.set(...row.at); slot.vel.set(...row.velocity); slot.active = true;
    }
  }
}
