/** A row-driven wake encounter. Observations and effects are plain values;
 * body ownership, rendering and event transport remain on the existing world. */
import type { BossContinuation, BossState } from '@wildshard/engine/ai/BossBrain';
import { parseWakeEncounter, type WakeEncounterRow } from '@wildshard/format/bossEncounter';

/** Only public body data is observed; no function, subclass or port is accepted. */
export interface WakeBossActor { readonly position: { readonly x: number; readonly z: number }; mem: Record<string, number>; readonly alive: boolean; readonly hp: number; readonly maxHp: number }
export interface WakeBossObservation { readonly player: { readonly x: number; readonly z: number }; readonly animal: WakeBossActor | null; readonly wake: boolean; readonly dead: boolean }
export type WakeBossEffect = { readonly kind: 'outcome'; readonly outcome: 'won' | 'lost' | 'left' }
  | { readonly kind: 'hide' } | { readonly kind: 'bar'; readonly visible: boolean; readonly hp: number };
/** Restore is silent; effects are consumed on the caller's original clock. */
export interface WakeEncounterState { boss: BossContinuation; attempt: boolean; waitForReturn: boolean }

/** Arena, attempt lifetime and phase presentation over an existing AS guest.
 * This is a closed value machine: it exposes no subclass or callback hook. */
export class WakeBossEncounter {
  readonly row: WakeEncounterRow;
  state: BossState = 'dormant'; phase = 0;
  private boss: BossContinuation = { state: 'dormant', phase: 0, checkpoint: 0, attempts: 1, t: 0, skipT: 0, short: false, saved: { defeated: false, rewardTaken: false, kills: 0 } };
  private attempt = false;
  private waitForReturn = false;
  private effects: WakeBossEffect[] = [];
  constructor(input: unknown, private readonly center: { readonly x: number; readonly z: number }) { this.row = parseWakeEncounter(input); }
  snapshot(): BossContinuation { return { ...this.boss, state: this.state, phase: this.phase, saved: { ...this.boss.saved } }; }
  restore(value: BossContinuation): void {
    if (!['dormant', 'armed', 'intro', 'fight', 'beat', 'victory'].includes(value.state)
      || ![value.phase, value.checkpoint].every(n => Number.isInteger(n) && n >= 0 && n < this.row.phases.length)
      || !Number.isSafeInteger(value.attempts) || value.attempts < 1 || ![value.t, value.skipT].every(n => Number.isFinite(n) && n >= 0)
      || typeof value.short !== 'boolean' || typeof value.saved.defeated !== 'boolean' || typeof value.saved.rewardTaken !== 'boolean'
      || !Number.isSafeInteger(value.saved.kills) || value.saved.kills < 0) throw new Error('Invalid boss continuation');
    this.boss = { ...value, saved: { ...value.saved } }; this.state = value.state; this.phase = value.phase;
  }
  encounterSnapshot(): WakeEncounterState { return { boss: this.snapshot(), attempt: this.attempt, waitForReturn: this.waitForReturn }; }
  encounterRestore(value: WakeEncounterState): void { this.restore(value.boss); this.attempt = value.attempt; this.waitForReturn = value.waitForReturn; this.effects = []; }
  /** Consume each effect once; restore produces none. */
  takeEffects(): WakeBossEffect[] { const result = this.effects; this.effects = []; return result; }
  wake(observation: WakeBossObservation): void {
    const animal = observation.animal;
    if (animal === null || !animal.alive || this.waitForReturn) return;
    animal.mem[this.row.fields.awake] = 1;
    if (!this.attempt) { this.attempt = true; this.state = 'fight'; }
  }
  private near(player: { readonly x: number; readonly z: number }): boolean { return Math.hypot(player.x - this.center.x, player.z - this.center.z) < this.row.arena.radius; }
  private finish(outcome: 'won' | 'lost' | 'left'): void { if (this.attempt) { this.attempt = false; this.effects.push({ kind: 'outcome', outcome }); } }
  arm(observation: WakeBossObservation): void { this.wake(observation); }
  disarm(): void { this.finish('left'); this.effects.push({ kind: 'hide' }); this.state = 'dormant'; }
  onPlayerDeath(player: { readonly x: number; readonly z: number }): false {
    if (this.attempt && this.near(player)) { this.finish('lost'); this.waitForReturn = true; this.effects.push({ kind: 'hide' }); this.state = 'dormant'; }
    return false;
  }
  update(observation: WakeBossObservation): void {
    const a = observation.animal, near = this.near(observation.player);
    if (a === null) { this.effects.push({ kind: 'hide' }); return; }
    if (!a.alive || observation.dead) { this.finish('won'); this.state = 'victory'; this.effects.push({ kind: 'hide' }); return; }
    if (!near) { this.finish('left'); this.waitForReturn = false; this.state = 'dormant'; }
    if (near && observation.wake) this.wake(observation);
    this.phase = (a.mem[this.row.fields.phase] ?? 1) - 1;
    this.effects.push({ kind: 'bar', visible: near && (a.mem[this.row.fields.rise] ?? 0) > this.row.presentation.riseAbove, hp: a.hp / Math.max(1, a.maxHp) });
  }
}
