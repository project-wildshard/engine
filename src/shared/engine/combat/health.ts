import type { Vector3 } from 'three';
import type { Events } from '../events/events';
import type { Scope } from '../app/scope';
import type { Actor, CombatTag, DamageRequest, DeathCause, HealthAttributes } from './pipeline';

export type PlayerMode = 'foot' | 'board' | 'swim' | 'ride';

declare module '../../../client/engine/events/maps' {
  interface EventMap { 'player.mode': { prev: PlayerMode; next: PlayerMode } }
}

export interface PlayerHealthPorts {
  now: () => number; dodging: () => boolean; dodgeGuard: () => boolean;
  position: () => Vector3;
  mode?: () => PlayerMode;
  /** World-space transient velocity (m/s), resolved by the player motor. */
  impulse?: (worldVelocityMps: Vector3) => void;
}
/** Health is level-owned. A fall deliberately leaves the six-second regeneration clock unchanged. */
/** what the death fade tells the health model: whether it runs, and its step (bound by the session) */
export interface HealthLifecycle { fading: () => boolean; updateFade: (dt: number) => void }
interface HealthSnapshot {
  version: number; attributes: HealthAttributes; effectTags: CombatTag[]; lastHurt: number; cause: DeathCause | null; previousMode: PlayerMode;
}
export class PlayerHealth implements Actor {
  readonly id: string;
  readonly tags = ['actor.player'] as const;
  effectTags: readonly CombatTag[] = [];
  readonly attributes: HealthAttributes = { health: 100, maxHealth: 100, incomingCap: Infinity };
  lastHurt = 0;
  cause: DeathCause | undefined;
  private lifecycle: HealthLifecycle | null = null;
  bindLifecycle(ports: HealthLifecycle): void { this.lifecycle = ports; }
  private readonly events: Events;
  private previousMode: PlayerMode;
  /** Immediate motor state; the change event is sampled during update. */
  get mode(): PlayerMode { return this.ports.mode?.() ?? 'foot'; }
  private readonly ports: PlayerHealthPorts;
  constructor(events: Events, ports: PlayerHealthPorts, id = 'actor.player') { this.events = events; this.ports = ports; this.id = id; this.previousMode = this.mode; }
  snapshot(): HealthSnapshot {
    return { version: 1, attributes: { ...this.attributes }, effectTags: [...this.effectTags],
      lastHurt: this.lastHurt, cause: this.cause === undefined ? null : { ...this.cause }, previousMode: this.previousMode };
  }
  restore(state: ReturnType<PlayerHealth['snapshot']>): void {
    if (state.version !== 1 || !Number.isFinite(state.lastHurt) || !Number.isFinite(state.attributes.health)
      || !Number.isFinite(state.attributes.maxHealth) || !['foot', 'board', 'swim', 'ride'].includes(state.previousMode)) throw new RangeError('Invalid health snapshot');
    for (const key of Object.keys(this.attributes)) delete this.attributes[key];
    Object.assign(this.attributes, state.attributes); this.effectTags = [...state.effectTags];
    this.lastHurt = state.lastHurt; this.cause = state.cause === null ? undefined : { ...state.cause }; this.previousMode = state.previousMode;
  }
  /** Add a finite world-space velocity; the motor copies it and decays it at 3.5/s. */
  impulse(worldVelocityMps: Vector3): void {
    if (![worldVelocityMps.x, worldVelocityMps.y, worldVelocityMps.z].every(Number.isFinite)) throw new Error('Player impulse must be finite');
    if (this.alive) this.ports.impulse?.(worldVelocityMps);
  }
  get alive(): boolean { return this.attributes.health > 0; }
  get state(): readonly CombatTag[] {
    return [...this.effectTags, ...(this.lifecycle?.fading() === true ? ['state.death-fade' as const] : []),
      ...(this.ports.dodging() ? ['state.dodging' as const] : []), ...(this.ports.dodgeGuard() ? ['guard.dodge' as const] : [])];
  }
  setMaxHealth(max: number): void {
    const was = this.attributes.maxHealth;
    this.attributes.maxHealth = max;
    this.attributes.health = Math.max(0, Math.min(max, this.attributes.health + Math.max(0, max - was)));
  }
  applyDamage(req: DamageRequest): boolean {
    this.attributes.health = Math.max(0, this.attributes.health - req.amount);
    const fall = req.sourceTags.includes('env.fall');
    if (!fall) { this.lastHurt = this.ports.now(); this.cause = req.cause; }
    else if (this.attributes.health <= 0) this.cause = undefined;
    return this.attributes.health <= 0;
  }
  update(dt: number): void {
    const next = this.mode;
    if (next !== this.previousMode) { this.events.emit('player.mode', { prev: this.previousMode, next }); this.previousMode = next; }
    const a = this.attributes;
    if (a.health > 0 && a.health < a.maxHealth && this.ports.now() - this.lastHurt > 6000) a.health = Math.min(a.maxHealth, a.health + dt * 4);
    this.lifecycle?.updateFade(dt);
    if (this.lifecycle?.fading() === true) a.health = a.maxHealth;
    if (a.health > 0) return;
    const cause = this.cause;
    a.health = a.maxHealth;
    const answer: unknown = this.events.ask('death.checkpoint', cause === undefined ? {} : { cause });
    const checkpoint = answer === true;
    this.events.emit('player.died', { actor: this, checkpoint, ...(cause === undefined ? {} : { cause }) });
    this.cause = undefined;
  }
  /** Encounter answerers preserve the old short-circuit: an earlier accepted checkpoint wins. */
  checkpoint(scope: Scope, answer: () => boolean, active: () => boolean = () => true): void {
    this.events.answer('death.checkpoint', (value) => value === true || (active() && answer()), scope);
  }
}
