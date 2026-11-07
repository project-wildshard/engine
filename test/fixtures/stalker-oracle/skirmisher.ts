// Pre-SF82 shipping policy at e7855dd802fa1ecf7cd44df54d205c4993654e1a; only imports and class name differ.
// Original SHA-256: 9e0fa34fe16f6035af43566baabe0c3edeef1a3394808335aca22952e1166ba8
import type { AnimalSim } from '../../../src/shared/engine/entities/AnimalSim';
import type { SimValue } from '../../../src/server/engine/sim';
import type { Rng } from '../../../src/shared/engine/core/rng';

/** Parameters for a circling melee archetype with idle wandering and subordinate scattering. */
export interface SkirmisherSpec {
  awareRadius: number; shyRadius: number; disengageRadius: number; holdRadius: number; attackRadius: number;
  attackDuration: number; attackCooldown: number; alertCooldown: number; fleeSpeed: number;
  subordinateVariant: string; leaderVariant: string; noticeCue: string;
}
/** Host-owned perception, navigation and attack-token authority; no rendering or application singleton. */
export interface SkirmisherPorts<A extends AnimalSim> {
  dt: number; player: { x: number; y: number; z: number }; calm: boolean;
  rng: Pick<Rng, 'next' | 'range'>;
  herd: readonly { variant: string; alive: boolean }[] | null;
  sound: (cue: string) => void;
  steer: (actor: A, yaw: number, speed: number, turnRate: number) => void;
  confine: (actor: A) => void; claim: (actor: A) => boolean; mayAttack: (actor: A) => boolean;
}
interface SkirmisherMemory extends Record<string, number> {
  init: number; hx: number; hz: number; st: number; tm: number; sd: number; cd: number; hitT: number; shy: number; scat: number;
  wander: number; tx: number; tz: number; hit: number;
}
const ST_IDLE = 0, ST_ENGAGE = 1, ST_ATTACK = 2, ST_FLEE = 3;
/** Renderer-free decisions; every timer, random continuation and remembered goal lives in the actor snapshot. */
export class CapturedSkirmisherBrain<A extends AnimalSim> {
  private readonly actor: A;
  private readonly spec: SkirmisherSpec;
  private readonly contract: string;
  constructor(actor: A, spec: SkirmisherSpec) {
    const numbers = [spec.awareRadius, spec.shyRadius, spec.disengageRadius, spec.holdRadius, spec.attackRadius, spec.attackDuration, spec.attackCooldown, spec.alertCooldown, spec.fleeSpeed];
    if (numbers.some(n => !Number.isFinite(n) || n < 0 || n > 600) || spec.shyRadius > spec.awareRadius || spec.awareRadius > spec.disengageRadius || spec.attackRadius > spec.awareRadius || spec.attackDuration <= 0 || spec.fleeSpeed > 15
      || [spec.subordinateVariant, spec.leaderVariant, spec.noticeCue].some(value => value.length === 0 || value.length > 128)) throw new Error('Invalid skirmisher parameters');
    this.actor = actor; this.spec = { ...spec }; this.contract = JSON.stringify({ version: 1, spec: this.spec });
  }
  /** Actor/RNG snapshots own mutable state; this adapter fences the admitted policy on restore. */
  snapshot(): SimValue { return this.contract; }
  /** Reject a changed policy before accepting an actor continuation; never replay decisions during restore. */
  restore(saved: SimValue): void { if (saved !== this.contract) throw new Error('Incompatible skirmisher continuation'); }
  /** One caller-owned AI tick; strike clocks and collision motors remain separate fixed-step authorities. */
  think(c: SkirmisherPorts<A>): void {
    // dt 0 is an interrupt's wake in the frame it already decided (the manager's 'decide now', whatever the clock)
    if (!Number.isFinite(c.dt) || c.dt < 0 || c.dt > 1) throw new Error('Invalid skirmisher step');
    const a = this.actor;
    const m = a.mem as SkirmisherMemory, rng = c.rng;
    if (!m.init) { m.init = 1; m.hx = a.position.x; m.hz = a.position.z; m.st = ST_IDLE; m.tm = rng.range(1, 3); m.sd = rng.next() < 0.5 ? -1 : 1; m.cd = 0; m.hitT = 0; m.shy = 0; m.scat = 0; }
    const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, d = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    m.cd = Math.max(0, m.cd - c.dt);
    // a blow interrupts whatever it was doing: it turns on you
    if (a.lastHitT > m.hitT) { m.hitT = a.lastHitT; a.cancelAttack(); if (m.st !== ST_FLEE) { m.st = ST_ENGAGE; m.cd = Math.max(m.cd, this.spec.alertCooldown); } }
    // A dead leader makes its subordinate variants scatter and remain shy.
    if (a.variant === this.spec.subordinateVariant && !m.scat && c.herd?.some((h) => h.variant === this.spec.leaderVariant && !h.alive)) { m.scat = 1; m.shy = 1; m.st = ST_FLEE; m.tm = rng.range(5, 7); a.cancelAttack(); c.sound(this.spec.noticeCue); }
    const engageR = m.shy ? this.spec.shyRadius : this.spec.awareRadius;
    switch (m.st) {
      case ST_IDLE: {
        a.state = 'idle';
        if (!c.calm && d < engageR) { m.st = ST_ENGAGE; m.tm = rng.range(1, 2.5); c.sound(this.spec.noticeCue); break; }
        m.tm -= c.dt;
        if (m.tm <= 0) {
          // Alternate resting and a short wander around the remembered home.
          if (m.wander) { m.wander = 0; m.tm = rng.range(2, 6); a.setMotion(a.desiredYaw, 0, 2); a.setStrafe(0); }
          else { m.wander = 1; m.tm = rng.range(1.5, 3); const ang = rng.range(0, Math.PI * 2); m.tx = m.hx + Math.cos(ang) * 3; m.tz = m.hz + Math.sin(ang) * 3; }
        }
        if (m.wander) {
          const wx = m.tx - a.position.x, wz = m.tz - a.position.z;
          if (Math.hypot(wx, wz) < 0.5) { m.wander = 0; m.tm = rng.range(2, 6); a.setMotion(a.desiredYaw, 0, 2); }
          else { const yaw = Math.atan2(wx, wz); a.setMotion(yaw, 0, 3); a.setStrafe(Math.sin(yaw - a.yaw) > 0 ? 0.55 : -0.55); if (Math.abs(Math.sin(yaw - a.yaw)) < 0.3) { a.setStrafe(0); a.setMotion(yaw, 0.5, 3); } }
        }
        a.lookWeight = d < 14 ? 0.5 : 0; a.lookTarget.copy(c.player);
        break;
      }
      case ST_ENGAGE: {
        a.state = 'sidestep';
        a.lookTarget.copy(c.player); a.lookWeight = 1;
        if (c.calm || d > this.spec.disengageRadius) { m.st = ST_IDLE; m.tm = 2; a.setStrafe(0); a.setMotion(a.yaw, 0, 2); break; }
        m.tm -= c.dt;
        if (m.tm <= 0) { m.sd = -m.sd; m.tm = rng.range(1.0, 2.5); }
        // An authoritative attack token holds waiting actors outside strike range.
        const wait = !c.mayAttack(a), far = wait ? this.spec.holdRadius + 0.6 : 2.6, near = wait ? this.spec.holdRadius - 0.6 : 1.4;
        if (d > far) { a.setMotion(toPlayer, 1.7, 5); a.setStrafe(m.sd * 0.5); }
        else if (!wait && m.cd <= 0 && d > 1.75) { a.setMotion(toPlayer, 1.2, 5); a.setStrafe(m.sd * 0.3); } // Its turn: close to strike range.
        else if (d < near) { a.setMotion(toPlayer, wait ? -1.1 : -0.6, 5); a.setStrafe(m.sd * 1.3); }      // too close: back off a step while circling
        else { a.setMotion(toPlayer, 0, 5); a.setStrafe(m.sd * 1.3); }
        if (!wait && d < this.spec.attackRadius && m.cd <= 0 && c.claim(a)) { m.st = ST_ATTACK; m.hit = 0; a.startAttack(this.spec.attackDuration); a.setStrafe(0); a.setMotion(toPlayer, 0, 6); c.sound(this.spec.noticeCue); }
        break;
      }
      case ST_ATTACK: {
        a.state = 'attack';
        a.setMotion(toPlayer, 0, 6); a.setStrafe(0);
        const p = a.attackPhase;
        if (p >= 1 || p < 0) { m.st = ST_ENGAGE; m.cd = this.spec.attackCooldown; m.tm = rng.range(0.6, 1.6); a.cancelAttack(); }
        break;
      }
      case ST_FLEE: {
        a.state = 'flee';
        m.tm -= c.dt;
        c.steer(a, Math.atan2(-dx, -dz), this.spec.fleeSpeed, 4); a.setStrafe(0);
        a.lookWeight = 0;
        if (m.tm <= 0) { m.st = ST_IDLE; m.tm = 2; m.hx = a.position.x; m.hz = a.position.z; a.setMotion(a.yaw, 0, 2); }
        break;
      }
      default: break;
    }
    c.confine(a);
  }
}
