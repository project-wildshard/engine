import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { Rng } from '../../../shared/engine/core/rng';
import type { SimValue } from '../sim';
import { emitFault } from '../../../shared/engine/core/faults';

/** A hidden interior guardian's perception, holding ring, retreat and strike timing. */
export interface GuardianSpec {
  wakeRadius: number; guardRadius: number; approachRadius: number; swingRadius: number; swingDuration: number;
  speed: number; holdRadius: number; sideSpeed: number; sideFlipSeconds: number; sinkAfterSeconds: number;
  cooldownSeconds: number; hideOffset: number; noticeCue: string;
}
/** Trusted interior floor and vertical-motion recipes publish completion through the actor's numeric memory. */
export interface GuardianPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean; rng: Pick<Rng, 'next'>;
  world: { hold?: { x: number; z: number; r: number; guardR: number; floorAt: (x: number, z: number) => number | undefined };
    splash?: (at: A['position'], strength: number) => void };
  heightAt: (x: number, z: number) => number; sound: (cue: string) => void;
  reach: (actor: A) => boolean; claim: (actor: A) => boolean; mayAttack: (actor: A) => boolean;
}

/** Ranged perch hunting followed by a bounded ground attack and return to a native perch recipe. */
export interface PerchHunterSpec {
  throwRadius: number; throwDuration: number; biteRadius: number; biteDuration: number;
  underRadius: number; underSeconds: number; holdRadius: number; runSpeed: number; activeGroundSeconds: number;
  biteCooldown: number; throwCooldownMin: number; throwCooldownMax: number; alertCue: string; noticeCue: string;
}
/** Native perch/drop/climb recipes and shared cooldown RNG retain authority outside the decision policy. */
export interface PerchHunterPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean; rng: Pick<Rng, 'next' | 'range'>; attackRandom: Pick<Rng, 'range'>;
  herd: readonly A[] | null; sound: (cue: string) => void;
  steer: (actor: A, yaw: number, speed: number, turnRate: number) => void; confine: (actor: A) => void;
  claim: (actor: A) => boolean; mayAttack: (actor: A) => boolean;
  pickPerch: (actor: A, minDistance: number, maxDistance: number, awayFrom?: A['position']) => number;
  setPerch: (actor: A, index: number) => void;
}
/** Home/floor or perch pattern, with the existing native tuning and body authority. */
export type GuardianProfile =
  | { pattern: 'interior'; spec: GuardianSpec }
  | { pattern: 'perch'; spec: PerchHunterSpec };
/** Tagged perception prevents a home policy from running against the other pattern's recipes. */
export type GuardianObservation<A extends AnimalSim> =
  | (GuardianPorts<A> & { pattern: 'interior' })
  | (PerchHunterPorts<A> & { pattern: 'perch' });
type GuardianMemory = Record<string, number> & {
  init: number; hx: number; hz: number; cd: number; hitT: number; away: number;
  rise: number; rising: number; sinking: number; floor: number; floorS?: number; st: number; hit: number; sd?: number; sdT?: number;
};
const INTERIOR_HIDE = 0, INTERIOR_RISE = 1, INTERIOR_ATTACK = 2, INTERIOR_GUARD = 3, INTERIOR_SINK = 4;
interface PerchMemory extends Record<string, number> {
  init: number; cd: number; under: number; hitT: number; fled: number; onGround: number; st: number; hx: number; hz: number;
  perch: number; px: number; pz: number; bx: number; bz: number; perchH: number;
  drop: number; vy: number; land: number; climb: number; bite: number; hit: number; gt: number; fleeTo: number; bit: number;
}
const PERCH_PERCH = 0, PERCH_GROUND_IDLE = 1, PERCH_ATTACK = 2, PERCH_DROP = 3, PERCH_GROUND = 4, PERCH_RETURN = 5, PERCH_CLIMB = 6;
function admitProfile(profile: GuardianProfile): GuardianProfile {
  if (profile.pattern === 'interior') {
    const { spec } = profile;
    const { noticeCue, hideOffset } = spec;
    const numbers = [spec.wakeRadius, spec.guardRadius, spec.approachRadius, spec.swingRadius, spec.swingDuration,
      spec.speed, spec.holdRadius, spec.sideSpeed, spec.sideFlipSeconds, spec.sinkAfterSeconds, spec.cooldownSeconds];
    if (numbers.some(n => !Number.isFinite(n) || n < 0 || n > 600) || !Number.isFinite(hideOffset) || Math.abs(hideOffset) > 15
      || spec.swingDuration <= 0 || spec.speed > 15 || spec.sideSpeed > 15 || spec.wakeRadius > spec.guardRadius
      || spec.swingRadius > spec.approachRadius || noticeCue.length === 0 || noticeCue.length > 128) throw new Error('Invalid guardian parameters');
    return { pattern: profile.pattern, spec: { ...spec } };
  }
  {
    const { spec } = profile;
    const numbers = [spec.throwRadius, spec.throwDuration, spec.biteRadius, spec.biteDuration, spec.underRadius,
      spec.underSeconds, spec.holdRadius, spec.runSpeed, spec.activeGroundSeconds, spec.biteCooldown, spec.throwCooldownMin, spec.throwCooldownMax];
    if (numbers.some(n => !Number.isFinite(n) || n < 0 || n > 600) || spec.throwDuration <= 0 || spec.biteDuration <= 0
      || spec.runSpeed > 15 || spec.biteRadius > spec.throwRadius || spec.throwCooldownMin > spec.throwCooldownMax
      || [spec.alertCue, spec.noticeCue].some(cue => cue.length === 0 || cue.length > 128)) throw new Error('Invalid perch hunter parameters');
    return { pattern: profile.pattern, spec: { ...spec } };
  }
}
/** Parametric home/perch guardian; actor memory and host RNG remain the only mutable continuation owners. */
export class GuardianPolicy<A extends AnimalSim> {
  private readonly actor: A;
  private readonly profile: GuardianProfile;
  private readonly contract: string;
  private reportedFrames: Set<string> | undefined;
  private rejectFrame(message: string): void {
    const reported = this.reportedFrames ??= new Set();
    if (!reported.has(message)) {reported.add(message); emitFault({system: 'ai.guardian', error: new Error(message), verdict: 'retry'});}
  }
  constructor(actor: A, profile: GuardianProfile) {
    this.actor = actor; this.profile = admitProfile(profile);
    this.contract = JSON.stringify({ version: 1, spec: this.profile.spec });
  }
  /** Exact preset policy bytes; mutable motion decisions already belong to the actor snapshot. */
  snapshot(): SimValue { return this.contract; }
  /** Reject drift without executing a body recipe, observing the player or drawing either RNG. */
  restore(saved: SimValue): void {
    if (saved !== this.contract) throw new Error(`Incompatible ${this.profile.pattern === 'perch' ? 'perch hunter' : 'guardian'} continuation`);
  }
  /** Run the selected pattern with its original floor, token, perch and vertical-completion observations. */
  think(c: GuardianObservation<A>): void {
    if (c.pattern !== this.profile.pattern) {this.rejectFrame('Incompatible guardian observation'); return;}
    // Zero is an interrupt's second wake in the same frame.
    if (!Number.isFinite(c.dt) || c.dt < 0 || c.dt > 1) {
      this.rejectFrame(`Invalid ${c.pattern === 'perch' ? 'perch hunter' : 'guardian'} step`); return;
    }
    const p = this.profile;
    if (p.pattern === 'interior' && c.pattern === 'interior') this.thinkInterior(c, p.spec);
    else if (p.pattern === 'perch' && c.pattern === 'perch') this.thinkPerch(c, p.spec);
  }
  private thinkInterior(c: GuardianPorts<A>, spec: GuardianSpec): void {
    const a = this.actor;
  const m = a.mem as GuardianMemory, H = c.world.hold;
  if (!m.init) {
    m.init = 1; m.hx = a.position.x; m.hz = a.position.z; m.cd = 0; m.hitT = 0; m.away = 0;
    m.rise = 0; m.rising = 0; m.sinking = 0; m.floor = 0;
    m.st = INTERIOR_HIDE; a.state = 'hide';
    a.yOffset = spec.hideOffset;
  }
  const cx = H?.x ?? m.hx, cz = H?.z ?? m.hz, wakeR = H?.r ?? spec.wakeRadius, guardR = H?.guardR ?? spec.guardRadius;
  const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, d = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(dx, dz);
  const dPlayerHold = Math.hypot(c.player.x - cx, c.player.z - cz);
  m.cd = Math.max(0, m.cd - c.dt);
  // the deck under its feet (the hold's floor), else the sand
  const fl = H?.floorAt(a.position.x, a.position.z);
  m.floor = fl !== undefined ? fl - c.heightAt(a.position.x, a.position.z) : 0;
  a.lookTarget.copy(c.player); a.lookWeight = m.st === INTERIOR_HIDE ? 0 : 1;
  const hit = a.lastHitT > m.hitT; if (hit) m.hitT = a.lastHitT;
  switch (m.st) {
    case INTERIOR_HIDE: {
      a.state = 'hide'; a.setMotion(a.yaw, 0, 2); a.setStrafe(0);
      if ((!c.calm && dPlayerHold < wakeR) || hit) { m.st = INTERIOR_RISE; m.rising = 1; m.sinking = 0; a.state = 'rise'; c.sound(spec.noticeCue); c.world.splash?.(a.position, 1); }
      break;
    }
    case INTERIOR_RISE: {
      a.state = 'rise'; a.setMotion(toPlayer, 0, 1.5);
      if (!m.rising) { m.st = INTERIOR_GUARD; m.away = 0; }
      break;
    }
    case INTERIOR_GUARD: {
      a.state = 'stalk';
      const dh = Math.hypot(a.position.x - cx, a.position.z - cz);
      if (hit) a.cancelAttack();
      const reach = c.reach(a);
      if (!c.calm && d < spec.swingRadius && m.cd <= 0 && reach && c.claim(a)) { m.st = INTERIOR_ATTACK; m.hit = 0; a.setStrafe(0); a.startAttack(spec.swingDuration); a.setMotion(toPlayer, 0, 6); c.sound(spec.noticeCue); break; } // no swing through the mast or a beam (E296)
      if (!c.calm && dPlayerHold < guardR && d < spec.approachRadius) {
        m.away = 0;
        const wait = !c.mayAttack(a), stand = wait ? spec.holdRadius : spec.swingRadius * 0.8; // E297: two others attacking — it stands off and waits
        if (d > stand) { if (dh < guardR || (dx * (cx - a.position.x) + dz * (cz - a.position.z)) > 0) a.setMotion(toPlayer, spec.speed, 2.5); else a.setMotion(toPlayer, 0, 2.5); }
        else if (wait && d < spec.holdRadius - 0.6) a.setMotion(toPlayer, -0.6, 4);
        else a.setMotion(toPlayer, 0, 4);
        // E297 (E296 follow-up): close, but a beam or the mast between — it steps round it for a clear cut instead of waiting there
        if (!reach && d < spec.swingRadius + 1.2) {
          m.sdT = (m.sdT ?? 0) - c.dt;
          if (m.sd === undefined || m.sdT <= 0) { m.sd = m.sd === undefined ? (c.rng.next() < 0.5 ? -1 : 1) : -m.sd; m.sdT = spec.sideFlipSeconds; }
          a.setStrafe(m.sd * spec.sideSpeed);
        } else a.setStrafe(0);
      } else {
        // nobody in the hold: drift back to its spot, glare, and after a while sink out of sight
        m.away += c.dt; a.setStrafe(0);
        const hx = m.hx - a.position.x, hz = m.hz - a.position.z, hd = Math.hypot(hx, hz);
        if (hd > 0.6) a.setMotion(Math.atan2(hx, hz), spec.speed * 0.8, 2.5);
        else { a.setMotion(d < 30 ? toPlayer : a.desiredYaw, 0, 2); if (m.away > spec.sinkAfterSeconds) { m.st = INTERIOR_SINK; m.sinking = 1; m.rising = 0; c.world.splash?.(a.position, 0.5); } }
      }
      break;
    }
    case INTERIOR_ATTACK: {
      a.state = 'attack'; a.setMotion(toPlayer, 0, 6);
      const p = a.attackPhase;
      if (p >= 1 || p < 0) { a.cancelAttack(); m.st = INTERIOR_GUARD; m.cd = spec.cooldownSeconds; }
      break;
    }
    case INTERIOR_SINK: {
      a.state = 'hide'; a.setMotion(a.yaw, 0, 2);
      if ((!c.calm && dPlayerHold < wakeR) || hit) { m.st = INTERIOR_RISE; m.rising = 1; m.sinking = 0; a.state = 'rise'; }
      else if (!m.sinking) m.st = INTERIOR_HIDE;
      break;
    }
    default: break;
  }

  }
  private thinkPerch(c: PerchHunterPorts<A>, spec: PerchHunterSpec): void {
    const a = this.actor;
  const m = a.mem as PerchMemory, rng = c.rng;
  if (!m.init) {
    m.init = 1; m.cd = rng.range(1, 3); m.under = 0; m.hitT = 0; m.fled = 0; m.onGround = 0;
    const i = c.pickPerch(a, 0, 12);
    if (i >= 0) { c.setPerch(a, i); a.position.x = m.px; a.position.z = m.pz; a.yOffset = m.perchH; m.st = PERCH_PERCH; }
    else { m.st = PERCH_GROUND_IDLE; m.perch = -1; m.onGround = 1; m.hx = a.position.x; m.hz = a.position.z; }
  }
  const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, d = Math.hypot(dx, dz);
  const toPlayer = Math.atan2(dx, dz);
  m.cd = Math.max(0, m.cd - c.dt);
  a.lookTarget.copy(c.player); a.lookWeight = d < 25 ? 1 : 0;
  // one of the troop is dead: everyone abandons this palm for one further off
  if (!m.fled && c.herd?.some((h) => h !== a && !h.alive)) {
    m.fled = 1; a.cancelAttack(); c.sound(spec.alertCue);
    if (m.st === PERCH_PERCH || m.st === PERCH_CLIMB || (m.st === PERCH_ATTACK && !m.bite)) { m.climb = 0; m.drop = 1; m.vy = 0; m.st = PERCH_DROP; m.gt = 0; m.fleeTo = 1; }
    else if (m.st !== PERCH_GROUND_IDLE) { m.st = PERCH_RETURN; m.fleeTo = 1; }
    if (m.fleeTo) { const i = c.pickPerch(a, 12, 45, c.player); if (i >= 0) c.setPerch(a, i); m.fleeTo = 0; }
  }
  if (a.lastHitT > m.hitT) { m.hitT = a.lastHitT; a.cancelAttack(); if (m.st === PERCH_ATTACK) m.st = m.onGround ? PERCH_GROUND : PERCH_PERCH; }
  switch (m.st) {
    case PERCH_PERCH: {
      a.state = 'perch'; m.onGround = 0;
      a.setMotion(d < 30 ? toPlayer : a.desiredYaw, 0, 3); a.setStrafe(0);
      if (c.calm) break;
      // standing under the palm: it drops on you
      const du = Math.hypot(c.player.x - m.px, c.player.z - m.pz);
      m.under = du < spec.underRadius ? m.under + c.dt : 0;
      if (m.under > spec.underSeconds) { m.st = PERCH_DROP; m.drop = 1; m.vy = 0; m.under = 0; m.gt = spec.activeGroundSeconds; c.sound(spec.alertCue); break; }
      if (d < spec.throwRadius && d > 2.5 && m.cd <= 0 && c.claim(a)) { m.st = PERCH_ATTACK; m.bite = 0; m.hit = 0; a.startAttack(spec.throwDuration); c.sound(spec.noticeCue); } // E297: a throw is an attack too (a token)
      break;
    }
    case PERCH_ATTACK: {
      a.state = 'attack';
      a.setMotion(toPlayer, 0, 6); a.setStrafe(0);
      const p = a.attackPhase;
      if (p >= 1 || p < 0) { a.cancelAttack(); if (m.bite) { m.cd = spec.biteCooldown; m.st = PERCH_GROUND; m.bit = 1; } else { m.cd = c.attackRandom.range(spec.throwCooldownMin, spec.throwCooldownMax); m.st = m.onGround ? PERCH_GROUND_IDLE : PERCH_PERCH; } }
      break;
    }
    case PERCH_DROP: {
      a.state = 'charge'; a.setMotion(toPlayer, 0, 4);
      if (!m.drop) { m.st = m.gt > 0 ? PERCH_GROUND : PERCH_RETURN; m.onGround = 1; m.bit = 0; if (m.st === PERCH_RETURN) { const i = c.pickPerch(a, 12, 45, c.player); if (i >= 0) c.setPerch(a, i); } }
      break;
    }
    case PERCH_GROUND: {
      // on the sand: chase and bite, then back to the trunk
      a.state = 'charge'; m.onGround = 1;
      m.gt -= c.dt;
      // E297: two others attacking — it hangs back just out of reach, chattering, until a token frees
      if (!c.mayAttack(a)) { if (d < spec.holdRadius - 0.5) c.steer(a, toPlayer + Math.PI, spec.runSpeed * 0.6, 5); else if (d > spec.holdRadius + 0.8) c.steer(a, toPlayer, spec.runSpeed, 5); else a.setMotion(toPlayer, 0, 6); }
      else if (d > spec.biteRadius * 0.85) c.steer(a, toPlayer, spec.runSpeed, 5); else a.setMotion(toPlayer, 0, 6);
      if (d < spec.biteRadius && m.cd <= 0 && c.claim(a)) { m.st = PERCH_ATTACK; m.bite = 1; m.hit = 0; a.startAttack(spec.biteDuration); break; }
      if (m.gt <= 0 || (m.bit && d > 5) || c.calm) { m.st = PERCH_RETURN; if (m.perch < 0) { m.st = PERCH_GROUND_IDLE; } }
      break;
    }
    case PERCH_RETURN: {
      a.state = 'wander';
      const rx = m.bx - a.position.x, rz = m.bz - a.position.z, rd = Math.hypot(rx, rz);
      if (rd < 0.6) { m.st = PERCH_CLIMB; m.climb = 1; a.yOffset = 0; a.setMotion(Math.atan2(m.px - m.bx, m.pz - m.bz) || a.yaw, 0, 4); a.setStrafe(0); break; }
      c.steer(a, Math.atan2(rx, rz), spec.runSpeed, 5);
      // bitten on the way back: turns and fights
      if (!c.calm && d < spec.biteRadius && m.cd <= 0 && c.claim(a)) { m.st = PERCH_ATTACK; m.bite = 1; m.hit = 0; a.startAttack(spec.biteDuration); }
      break;
    }
    case PERCH_CLIMB: {
      a.state = 'rise'; a.setMotion(a.desiredYaw, 0, 4);
      if (!m.climb) { m.st = PERCH_PERCH; m.under = 0; m.onGround = 0; m.cd = 1; }
      break;
    }
    case PERCH_GROUND_IDLE: {
      // no palms to live in: a ground troop that throws from the sand and bites up close
      a.state = 'idle'; m.onGround = 1;
      a.setMotion(d < 20 ? toPlayer : a.desiredYaw, 0, 3); a.setStrafe(0);
      if (c.calm) break;
      if (d < spec.biteRadius && m.cd <= 0 && c.claim(a)) { m.st = PERCH_ATTACK; m.bite = 1; m.hit = 0; a.startAttack(spec.biteDuration); }
      else if (d < spec.throwRadius && d > 2.5 && m.cd <= 0 && c.claim(a)) { m.st = PERCH_ATTACK; m.bite = 0; m.hit = 0; a.startAttack(spec.throwDuration); c.sound(spec.noticeCue); }
      break;
    }
    default: break;
  }
  if (m.onGround && !m.drop) c.confine(a);

  }
}
