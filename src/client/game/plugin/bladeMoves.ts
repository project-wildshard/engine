import { Vector3 } from 'three';
import type { Actor, DamageDealt, DamageRequest } from '@wildshard/engine/combat/pipeline';
import { parseMeleeContacts } from '@wildshard/format/items';
import type { WorldContactDispatcher, WorldContactHit } from '@wildshard/engine/combat/contactWeapon';

type Move = ReturnType<typeof parseMeleeContacts>[number];
type Reaction = Move['hits'][number]['reactions'][number];
/** The ports a body under a blade lends: `hittable` is the owner's test, `impulse` and `stagger` its reactions. */
export interface BladeBody {
  readonly actor: Actor | null; readonly hittable?: boolean;
  readonly impulse?: (velocity: Vector3) => void; readonly stagger?: (dir: Vector3, strength: number) => void;
}
/** What a blade is lent: the page's pipeline, a timed move's aim, the first body along a lane, and its reports. */
export interface BladePorts<T extends BladeBody> {
  readonly hit: (request: DamageRequest) => DamageDealt | null;
  /** a timed landing's aim from the eye; false: no aim, it lands on nothing */
  readonly aim: (from: Vector3, dir: Vector3) => boolean;
  /** the first body along a lane within `reach` (the owner's raycast) */
  readonly body?: (from: Vector3, dir: Vector3, reach: number) => { readonly port: T; readonly point: Vector3 } | null;
  readonly react?: (target: T) => BladeBody;
  readonly fired: () => void;
  readonly struck: (actorId: string, killed: boolean) => void;
  readonly caught: (target: WorldContactHit, second: boolean) => void;
}

/** A hold's release, from a press down to its letting go. */
class HoldClock {
  elapsed = 0; held = false;
  step(dt: number, enabled: boolean, held: boolean, release: () => void): void {
    if (!enabled) this.reset();
    else if (held) this.elapsed += dt;
    else if (this.held) { release(); this.elapsed = 0; }
    this.held = enabled && held;
  }
  reset(): void { this.elapsed = 0; this.held = false; }
}

/**
 * A held blade's swing on a page, feel only (J126): its cooldown lanes, its timed move, its hold and where a landing goes.
 * The server has its own, and settles what the blade lands: this scans no crowd of bodies, and what it says of one body
 * under its lane is the page's own marker and flinch until the rows arrive.
 */
export class BladeMoves<T extends BladeBody> {
  readonly hold: HoldClock = new HoldClock();
  cooldown = 0; secondaryCooldown = 0;
  /** The timed move playing, seconds since its swing (−1: idle) and how many of its contacts landed. */
  move = 0; t = -1; landed = 0;
  private world: WorldContactDispatcher | null = null;
  private readonly moves: readonly Move[];
  constructor(private readonly weaponId: string, rows: unknown, private readonly ports: BladePorts<T>) { this.moves = parseMeleeContacts(rows); }
  bindWorldTargets(owner: WorldContactDispatcher | null): void { this.world = owner; }
  row(move: number): Move { const row = this.moves[move]; if (row === undefined) throw new RangeError(`No contact move ${String(move)}`); return row; }
  /** Claims the move's cooldown lane: false while it runs. */
  claim(move: number): boolean {
    const row = this.row(move), lane = row.lane === 'primary' ? 'cooldown' : 'secondaryCooldown';
    if (this[lane] > 0) return false;
    this[lane] = row.cooldown; return true;
  }
  /** Claims and starts a timed move; its contacts land on `advance`. */
  swing(move: number): boolean {
    if (!this.claim(move)) return false;
    this.move = move; this.t = 0; this.landed = 0; return true;
  }
  cool(dt: number): void { this.cooldown = Math.max(0, this.cooldown - dt); this.secondaryCooldown = Math.max(0, this.secondaryCooldown - dt); }
  /** The timed move advances and lands on time; answers its time, or −1 once it ended (or was idle). */
  advance(dt: number): number {
    if (this.t < 0) return -1;
    this.t += dt;
    const row = this.row(this.move);
    for (let k = this.landed; k < row.lands.length; k++) {
      if (this.t < (row.lands[k] ?? Infinity)) break;
      this.landed = k + 1;
      const from = new Vector3(), dir = new Vector3();
      if (this.ports.aim(from, dir)) this.land(this.move, k, from, dir);
    }
    if (this.t > row.show) { this.t = -1; return -1; }
    return this.t;
  }
  cancel(): void { this.t = -1; }
  /** Lands the move's `k`th contact: 1 when a lane met a body, else 0; a cone's bodies are the server's. */
  land(move: number, k: number, from: Vector3, dir: Vector3): number {
    const row = this.row(move), contact = row.hits[k];
    if (contact === undefined) throw new RangeError(`No contact ${String(k)} on move ${String(move)}`);
    const request = { weapon: this.weaponId, move: contact.moveId, contact: k, reach: row.reach, width: row.size, from, dir };
    if (row.shape === 'cone') { this.world?.contact(request); return 0; }
    const hit = this.ports.body?.(from, dir, row.reach) ?? null;
    if (hit?.port.hittable === true) { this.strike(this.ports.react?.(hit.port) ?? hit.port, row, contact, hit.point, dir, from); this.ports.fired(); return 1; }
    const caught = this.world?.contact(request) ?? null;
    if (caught !== null) this.ports.caught(caught, k > 0);
    return 0;
  }
  private strike(target: BladeBody, row: Move, contact: Move['hits'][number], point: Vector3, dir: Vector3, from: Vector3): void {
    const actor = target.actor, delta = point.clone().sub(from), forward = delta.dot(dir);
    if (actor === null || forward < 0 || forward > row.reach || delta.addScaledVector(dir, -forward).length() > row.size) return;
    for (const reaction of contact.reactions) if (reaction.when === 'before') react(target, actor, reaction, point, dir, from);
    const result = this.ports.hit({ source: 'env', sourceTags: contact.copyTags ? [...contact.tags] : contact.tags, target: actor, amount: contact.damage,
      point: contact.copyVectors ? point.clone() : point, dir: contact.copyVectors ? dir.clone() : dir, from: contact.copyVectors ? from.clone() : from,
      weaponId: this.weaponId, moveId: contact.moveId, surface: 'flesh' });
    if (result === null) return;
    if (row.reports) this.ports.struck(actor.id, result.killed);
    if (!result.killed) for (const reaction of contact.reactions) if (reaction.when === 'survived') react(target, actor, reaction, point, dir, from);
  }
}

function react(target: BladeBody, actor: Actor, reaction: Reaction, point: Vector3, dir: Vector3, from: Vector3): void {
  if (reaction.kind === 'impulse') {
    if (reaction.maxHealth !== undefined && actor.attributes.maxHealth > reaction.maxHealth) return;
    const velocity = reaction.direction === 'aim-backward' ? dir.clone().negate().setY(0) : point.clone().sub(from).setY(0);
    if (reaction.direction === 'radial-away' && velocity.lengthSq() < 1e-4) velocity.set(dir.x, 0, dir.z);
    target.impulse?.(velocity.normalize().multiplyScalar(reaction.speed).setY(reaction.lift));
  } else if (reaction.aboveHealth === undefined || actor.attributes.maxHealth > reaction.aboveHealth) target.stagger?.(dir, reaction.strength);
}
