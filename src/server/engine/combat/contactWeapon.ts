import { Vector3 } from 'three';
import type { Actor, CombatTag, DamageDealt, DamageRequest } from '../../../shared/engine/combat/pipeline';

const contactDelta = new Vector3();

/** Distance inside a numeric cone or chest lane, or null; target ordering remains with the native owner. */
export function weaponContactDistance(from: Vector3, dir: Vector3, at: Vector3, kind: 'cone' | 'lane',
  reach: number, size: number, height = 0, allowance = 0): number | null {
  const delta = contactDelta.copy(at).sub(from);
  if (kind === 'cone') {
    const length = delta.length();
    if (length > reach) return null;
    if (length < 1e-3) return length;
    return delta.dot(dir) / (length * Math.max(dir.length(), 1e-6)) >= Math.cos(size) ? length : null;
  }
  delta.y += height;
  const forward = delta.dot(dir);
  if (forward < 0 || forward > reach + allowance) return null;
  return delta.addScaledVector(dir, -forward).length() > size + allowance ? null : forward;
}

/** The actual body's reaction ports, lent by the native owner. */
export interface WeaponContactTarget {
  readonly actor: Actor | null;
  readonly impulse?: (velocity: Vector3) => void;
  readonly stagger?: (dir: Vector3, strength: number) => void;
}
/** Numeric ordered reactions; health predicates read the live actor after an accepted contact. */
export type WeaponContactReaction = { readonly when: 'before' | 'survived'; readonly kind: 'impulse';
  readonly direction: 'radial-away' | 'aim-backward'; readonly speed: number; readonly lift: number; readonly maxHealth?: number }
  | { readonly when: 'before' | 'survived'; readonly kind: 'stagger'; readonly strength: number; readonly aboveHealth?: number };
/** One admitted move's contact fields; vector/tag ownership preserves the existing caller's event lifetime. */
export interface WeaponContactMove {
  readonly source: Actor | 'env'; readonly tags: readonly CombatTag[]; readonly damage: number;
  readonly weaponId: string; readonly moveId: string; readonly copyVectors: boolean; readonly copyTags: boolean;
  readonly reactions: readonly WeaponContactReaction[];
}

/** Renderer-free contact and cooldown host shared by immediate and delayed weapon families. */
export class ContactWeaponHost {
  /** Remaining seconds on the ordinary and independent secondary move lanes. */
  primary = 0; secondary = 0;
  private readonly hit: (request: DamageRequest) => DamageDealt | null;
  constructor(hit: (request: DamageRequest) => DamageDealt | null) { this.hit = hit; }
  /** Claim one lane, preserving refusal while its existing cooldown remains positive. */
  claim(lane: 'primary' | 'secondary', seconds: number): boolean {
    if (this[lane] > 0) return false;
    this[lane] = seconds; return true;
  }
  /** Count both clocks down once in the caller's original phase; never installs a callback. */
  countDown(dt: number): void { this.primary = Math.max(0, this.primary - dt); this.secondary = Math.max(0, this.secondary - dt); }
  /** Execute numeric responses in order, sampling positions and survivor health in their original phase. */
  contact(target: WeaponContactTarget, move: WeaponContactMove, point: Vector3, dir: Vector3, from: Vector3,
    accepted?: (actorId: string, killed: boolean) => void): DamageDealt | null {
    const actor = target.actor;
    if (actor === null) return null;
    for (const reaction of move.reactions) if (reaction.when === 'before') this.react(target, actor, reaction, point, dir, from);
    const result = this.hit({ source: move.source, sourceTags: move.copyTags ? [...move.tags] : move.tags, target: actor,
      amount: move.damage, point: move.copyVectors ? point.clone() : point, dir: move.copyVectors ? dir.clone() : dir,
      from: move.copyVectors ? from.clone() : from, weaponId: move.weaponId, moveId: move.moveId, surface: 'flesh' });
    if (result === null) return null;
    accepted?.(actor.id, result.killed);
    if (!result.killed) for (const reaction of move.reactions) if (reaction.when === 'survived') this.react(target, actor, reaction, point, dir, from);
    return result;
  }
  private react(target: WeaponContactTarget, actor: Actor, reaction: WeaponContactReaction, point: Vector3, dir: Vector3, from: Vector3): void {
    if (reaction.kind === 'impulse') {
      if (reaction.maxHealth !== undefined && actor.attributes.maxHealth > reaction.maxHealth) return;
      const velocity = reaction.direction === 'aim-backward' ? new Vector3(-dir.x, 0, -dir.z) : point.clone().sub(from).setY(0);
      if (reaction.direction === 'radial-away' && velocity.lengthSq() < 1e-4) velocity.set(dir.x, 0, dir.z);
      velocity.normalize().multiplyScalar(reaction.speed).setY(reaction.lift);
      target.impulse?.(velocity);
    } else if (reaction.aboveHealth === undefined || actor.attributes.maxHealth > reaction.aboveHealth) target.stagger?.(dir, reaction.strength);
  }

}

/** A held release clock shared by page weapons and fixed-step native input adapters. */
export class HeldWeaponClock {
  /** Accumulated held seconds and the preceding authoritative hold bit. */
  elapsed = 0; held = false;
  /** Advance once, invoking release before clearing elapsed time; disabled holds cancel without releasing. */
  step(dt: number, enabled: boolean, held: boolean, release: () => void): void {
    if (!enabled) this.reset();
    else if (held) this.elapsed += dt;
    else if (this.held) { release(); this.elapsed = 0; }
    this.held = enabled && held;
  }
  /** Cancel an owned hold without producing a move or callback. */
  reset(): void { this.elapsed = 0; this.held = false; }
}

/** A body a contact family scans: its reaction ports, where it stands, and whether it can be hit now (a lane's test). */
export interface ContactScanTarget extends WeaponContactTarget { readonly position: Vector3; readonly hittable?: boolean }
/** Something in the world a lane move can reach (a lever, a brazier): `react` says whether it answered. */
export interface ContactWorldTarget { readonly at: Vector3; readonly radius: number; crack: (heavy: boolean, second: boolean) => boolean }
/** An actual landing's identity and aim, sampled by the existing contact owner. */
export interface WorldContactRequest { readonly weapon: string; readonly move: string; readonly contact: number; readonly reach: number; readonly width: number; readonly from: Vector3; readonly dir: Vector3 }
export interface WorldContactHit { readonly at: Vector3; readonly radius: number }
/** A platform-owned data dispatcher; no extra weapon, timer or input lane is installed. */
export interface WorldContactDispatcher { contact: (request: WorldContactRequest) => WorldContactHit | null }
/**
 * One move as a row: the clock lane it claims and for how long, its contact shape, and its contacts in landing order.
 * A `cone` lands on every live body within `reach` m and `size` rad of the aim; a `lane` on the first body the `body`
 * port meets, else the nearest hittable chest (`height` over the feet) within `size` m of the ray (`allowance` more for a
 * body), else the nearest world target. A timed move lands its contacts `lands` seconds after the swing and shows for
 * `show`; an immediate move lands when its owner calls `land`.
 */
export interface ContactMoveRow {
  readonly lane: 'primary' | 'secondary'; readonly cooldown: number; readonly heavy: boolean;
  readonly shape: 'cone' | 'lane'; readonly reach: number; readonly size: number; readonly height: number; readonly allowance: number;
  readonly lands: readonly number[]; readonly hits: readonly WeaponContactMove[]; readonly show: number;
  /** a contact accepted by the pipeline is the wielder's hit (`struck`) */
  readonly reports: boolean;
}
/** What a contact family is lent: the pipeline, the bodies, a timed move's aim, a lane's first body and world, its reports. */
export interface ContactFamilyPorts<T extends ContactScanTarget> {
  readonly hit: (request: DamageRequest) => DamageDealt | null;
  readonly targets: () => Iterable<T>;
  /** a timed landing's aim from the eye; false: no aim, it lands on nothing */
  readonly aim?: (from: Vector3, dir: Vector3) => boolean;
  /** the first body along a lane within `reach` (the owner's raycast or volumes) */
  readonly body?: (from: Vector3, dir: Vector3, reach: number) => { port: T; point: Vector3 } | null;
  readonly world?: () => readonly ContactWorldTarget[];
  /** the reaction ports a scanned body lends (default: itself) */
  readonly react?: (target: T) => WeaponContactTarget;
  readonly fired?: () => void;
  readonly struck?: (actorId: string, killed: boolean) => void;
  readonly caught?: (target: WorldContactHit, second: boolean) => void;
}

/**
 * A contact weapon family run from move rows (SHARD-PLATFORM SF85), renderer-free: the cooldown lanes, a timed move's
 * landings, the cone and lane contacts and the world reach. A browser weapon and a fixed-step host run the same rows;
 * its continuation is the two cooldowns and the timed move (`move`, `t`, `landed`).
 */
export class ContactFamily<T extends ContactScanTarget = ContactScanTarget> {
  /** The existing held clock belongs to this contact owner on page and native hosts. */
  readonly hold: HeldWeaponClock = new HeldWeaponClock();
  readonly host: ContactWeaponHost;
  moves: readonly ContactMoveRow[];
  /** The timed move playing, seconds since its swing (−1: idle) and how many of its contacts landed. */
  move = 0; t = -1; landed = 0;
  /** Live bodies the last cone landing reached. */
  touched = 0;
  private readonly ports: ContactFamilyPorts<T>;
  private readonly overflow = new RangeError('Contact targets exceed the admitted contact scan');
  private readonly accepted = (id: string, killed: boolean): void => { this.ports.struck?.(id, killed); };
  private worldContacts: WorldContactDispatcher | null = null;
  constructor(moves: readonly ContactMoveRow[], ports: ContactFamilyPorts<T>) { this.moves = moves; this.ports = ports; this.host = new ContactWeaponHost(request => ports.hit(request)); }
  get cooldown(): number { return this.host.primary; }
  set cooldown(value: number) { this.host.primary = value; }
  get secondaryCooldown(): number { return this.host.secondary; }
  set secondaryCooldown(value: number) { this.host.secondary = value; }
  /** Attach the admitted world contacts to this existing owner's landing phase. Null restores its legacy roster. */
  bindWorldTargets(owner: WorldContactDispatcher | null): void { this.worldContacts = owner; }
  /** The move's row (a missing move is a programming error). */
  row(move: number): ContactMoveRow { const row = this.moves[move]; if (row === undefined) throw new RangeError(`No contact move ${move}`); return row; }
  /** Claims the move's cooldown lane: false while it runs. */
  claim(move: number): boolean { const row = this.row(move); return this.host.claim(row.lane, row.cooldown); }
  /** Claims and starts a timed move; its contacts land on `advance`. */
  swing(move: number): boolean {
    if (!this.claim(move)) return false;
    this.move = move; this.t = 0; this.landed = 0; return true;
  }
  /** The cooldowns run down. */
  cool(dt: number): void { this.host.countDown(dt); }
  /** The current timed move's whole showing time. */
  get length(): number { return this.row(this.move).show; }
  /** The timed move advances by `dt` and lands its contacts on time; answers its time, or −1 once it ended (or was idle). */
  advance(dt: number): number {
    if (this.t < 0) return -1;
    this.t += dt;
    const row = this.row(this.move);
    for (let k = this.landed; k < row.lands.length; k++) {
      if (this.t < (row.lands[k] ?? Infinity)) break;
      this.landed = k + 1;
      const from = new Vector3(), dir = new Vector3();
      if (this.ports.aim?.(from, dir) === true) this.land(this.move, k, from, dir);
    }
    if (this.t > row.show) { this.t = -1; return -1; }
    return this.t;
  }
  /** Drops the timed move in flight (the weapon put away). */
  cancel(): void { this.t = -1; }
  /** Lands the move's `k`th contact from `from` along `dir`: a cone answers the accepted hits, a lane 1 when it met a body. */
  land(move: number, k: number, from: Vector3, dir: Vector3): number {
    const row = this.row(move), contact = row.hits[k];
    if (contact === undefined) throw new RangeError(`No contact ${k} on move ${move}`);
    if (row.shape === 'cone') {
      const struck = this.cone(row, contact, from, dir);
      this.worldContacts?.contact({ weapon: contact.weaponId, move: contact.moveId, contact: k, reach: row.reach, width: row.size, from, dir });
      return struck;
    }
    const react = (port: T): WeaponContactTarget => this.ports.react?.(port) ?? port;
    const hit = this.ports.body?.(from, dir, row.reach) ?? null;
    if (hit?.port.hittable === true) { this.strike(react(hit.port), move, k, hit.point, dir, from); this.ports.fired?.(); return 1; }
    const lane = this.nearest(row, from, dir);
    if (lane !== null) { this.strike(react(lane.port), move, k, lane.point, dir, from); this.ports.fired?.(); return 1; }
    const caught = this.worldContacts === null ? this.crackWorld(from, dir, row.reach, k > 0)
      : this.worldContacts.contact({ weapon: contact.weaponId, move: contact.moveId, contact: k, reach: row.reach, width: row.size, from, dir });
    if (caught !== null) this.ports.caught?.(caught, k > 0);
    return 0;
  }
  private cone(row: ContactMoveRow, contact: WeaponContactMove, from: Vector3, dir: Vector3): number {
    const targets = [...this.ports.targets()];
    if (targets.length > 4096) throw this.overflow;
    let struck = 0; this.touched = 0;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]; if (target === undefined) break;
      const actor = target.actor;
      if (actor === null || !actor.alive || weaponContactDistance(from, dir, target.position, 'cone', row.reach, row.size) === null) continue;
      this.touched++;
      if (this.host.contact(target, contact, target.position, dir, from, row.reports ? this.accepted : undefined) !== null) struck++;
    }
    return struck;
  }
  /** The nearest hittable body whose chest sits inside the lane. */
  private nearest(row: ContactMoveRow, from: Vector3, dir: Vector3): { port: T; point: Vector3 } | null {
    let best: { port: T; point: Vector3 } | null = null, bestT = Infinity;
    const targets = this.ports.targets()[Symbol.iterator]();
    for (let i = 0; i < 1024; i++) {
      const next = targets.next(); if (next.done === true) return best;
      const port = next.value;
      if (port.hittable === false) continue;
      const forward = weaponContactDistance(from, dir, port.position, 'lane', row.reach, row.size, row.height, row.allowance);
      if (forward === null || forward >= bestT) continue;
      best = { port, point: from.clone().addScaledVector(dir, Math.min(forward, row.reach)) }; bestT = forward;
    }
    if (targets.next().done !== true) throw this.overflow;
    return best;
  }
  /** The current move reaches a world target inside its lane: the nearest one along the aim reacts (null: none, or it did not). */
  crackWorld(from: Vector3, dir: Vector3, reach: number, second: boolean): ContactWorldTarget | null {
    const row = this.row(this.move);
    let best: ContactWorldTarget | null = null, bestT = Infinity;
    for (const c of this.ports.world?.() ?? []) {
      const delta = c.at.clone().sub(from), forward = delta.dot(dir);
      if (forward < 0 || forward > reach + c.radius || forward >= bestT) continue;
      if (delta.addScaledVector(dir, -forward).length() > row.size + c.radius) continue;
      best = c; bestT = forward;
    }
    return best?.crack(row.heavy, second) === true ? best : null;
  }
  /** The move's `k`th contact on one body at `point`, refused outside its lane; true when the pipeline accepted it. */
  strike(target: WeaponContactTarget, move: number, k: number, point: Vector3, dir: Vector3, from: Vector3): boolean {
    const row = this.row(move), contact = row.hits[k], delta = point.clone().sub(from), forward = delta.dot(dir);
    if (contact === undefined || forward < 0 || forward > row.reach || delta.addScaledVector(dir, -forward).length() > row.size) return false;
    return this.host.contact(target, contact, point, dir, from, row.reports ? this.accepted : undefined) !== null;
  }
}
