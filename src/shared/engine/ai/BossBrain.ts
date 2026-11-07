import { engineString } from '../strings';
import type { Events } from '../events/events';
import type { Vector3 } from 'three';
import { Hfsm } from './hfsm';

/** a boss fight's state: dormant, armed, the intro, the fight, a beat between phases, victory */
export type BossState = 'dormant' | 'armed' | 'intro' | 'fight' | 'beat' | 'victory';
export interface BossSaved { defeated: boolean; rewardTaken: boolean; kills: number }
/** Complete encounter continuation for same-engine fixed-step restoration. */
export interface BossContinuation { state: BossState; phase: number; checkpoint: number; attempts: number; t: number; skipT: number; short: boolean; saved: BossSaved; /** Complete authored cursor, present only for an explicitly installed stage owner. */ director?: string }
export interface BossPhaseDef { at: number; caption: string; name: string }
export interface BossDefinition {
  id: string; name: string; title: string; retryTitle: string;
  intro: number; introShort: number; phases: readonly BossPhaseDef[];
  reward: { trophy?: () => void };
}
export interface BossPorts {
  events?: Events;
  player: { position: Vector3 };
  lockInput: (on: boolean) => void; respawn: (pos: Vector3, yaw: number) => void;
  skipHeld: () => boolean; faceToward: (target: Vector3, dt: number) => void;
  spawnReward: () => void; persist: (saved: BossSaved) => void;
  feed?: ((text: string) => void) | undefined; toast?: ((text: string) => void) | undefined;
  music?: ((event: 'intro' | 'phase' | 'victory' | 'death' | 'pickup', intensity?: number) => void) | undefined;
}
export interface BossPresentation {
  update: (dt: number) => void; readonly barShown: boolean;
  hideBar: () => void; hideNameCard: () => void; hideReward: () => void;
  showRetry: (title: string, attempts: number) => void;
  showNameCard: (name: string, title: string, short: boolean) => void;
  setSkip: (fraction: number) => void; showBar: (name: string, thresholds: number[]) => void;
  setHp: (fraction: number) => void; setShield: (on: boolean) => void;
  setPhase: (phase: number, caption: string) => void;
}
const BEAT = 1.5, SKIP_HOLD = 0.6;

/** what one boss fight does in each state; BossBrain runs it */
export interface BossScript {
  /** the player (feet) is past the threshold: inside the sealed volume */
  inArena: (p: Vector3) => boolean;
  /** set the room and the boss up at the START of phase `phase` (0-based), boss dormant, seal open */
  reset: (phase: number) => void;
  /** seal / unseal the arena */
  seal: (on: boolean) => void;
  /** the intro, `t` seconds in: pose the boss (rise, eyes ignite …); returns the world point the camera eases to face */
  intro: (t: number, short: boolean) => Vector3;
  /** the intro ended (or was skipped): the boss is up and fighting in `phase` */
  begin: (phase: number) => void;
  /** a phase change: the room changes, the new moves unlock (the beat's invulnerability is `setInvulnerable`) */
  enterPhase: (phase: number) => void;
  /** the fight's own tick (AI glue, hazards) while intro / fight / beat / victory */
  update: (dt: number, t: number, fighting: boolean) => void;
  /** boss health 0..1 of max; `shielded` shows the bar's gold shimmer; `dead` ends the fight */
  readonly hpFrac: number;
  readonly shielded: boolean;
  readonly dead: boolean;
  /** clamp the boss's health to exactly `frac` (a phase threshold is never skipped by one big hit) */
  clampHp: (frac: number) => void;
  setInvulnerable: (on: boolean) => void;
  /** the boss fell: the arena's victory dressing (the heap of plaques, the seal drains, the light on the pedestal) */
  victory: () => void;
  /** where the reward orb floats, and where a dead player comes back (feet + yaw) */
  rewardPoint: () => Vector3;
  /** what its intro looks at, for a fight with no body on a row: a page on a server steps no intro, so reads it here */
  rowlessFocus?: () => Vector3;
  respawnPoint: () => { pos: Vector3; yaw: number };
}

/** The boss intro's view ease ("the camera stays first person but eases to face the boss"): the view's yaw and pitch move a
 *  frame-rate-independent share toward the direction from `eye` to `target`, pitch held to -0.6..0.8. The page Boss and a
 *  native host's player both turn through it. */
export function easeViewToward(view: { yaw: number; pitch: number }, eye: Readonly<{ x: number; y: number; z: number }>,
  target: Readonly<{ x: number; y: number; z: number }>, dt: number): void {
  const x = target.x - eye.x, y = target.y - eye.y, z = target.z - eye.z;
  const yaw = Math.atan2(-x, -z), pitch = Math.atan2(y, Math.hypot(x, z));
  let dy = yaw - view.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const k = 1 - Math.exp(-dt * 3.2);
  view.yaw += dy * k;
  view.pitch += (Math.max(-0.6, Math.min(0.8, pitch)) - view.pitch) * k;
}

export class BossBrain {
  private readonly machine = new Hfsm<BossState>({ dormant: {}, armed: {}, intro: {}, fight: {}, beat: {}, victory: {} }, 'dormant', undefined);
  get state(): BossState { return this.machine.state; }
  set state(value: BossState) { this.machine.transition(value); }
  /** the phase being fought (0-based) and the checkpoint (the phase a death sends you back to the start of) */
  phase = 0;
  checkpoint = 0;
  /** attempts this visit (the retry card counts them) */
  attempts = 1;
  private t = 0;
  private skipT = 0;
  private short = false;
  readonly def: BossDefinition;
  readonly script: BossScript;
  protected readonly host: BossPorts;
  protected readonly ui: BossPresentation;
  protected readonly saved: BossSaved;
  constructor(def: BossDefinition, script: BossScript, host: BossPorts, ui: BossPresentation, saved: BossSaved) {
    this.def = def; this.script = script; this.host = host; this.ui = ui; this.saved = saved;
  }

  /** beaten at least once / the reward taken (persisted) */
  get defeated(): boolean { return this.saved.defeated; }
  get rewardTaken(): boolean { return this.saved.rewardTaken; }
  get engaged(): boolean { return this.state === 'intro' || this.state === 'fight' || this.state === 'beat'; }
  /** Snapshot the phase/checkpoint/retry clocks as plain data; actor and arena state belong to their own adapters. */
  /** How far a hold-to-skip has come, 0 to 1. */
  get skipHeldFor(): number { return Math.min(1, this.skipT / SKIP_HOLD); }
  snapshot(): BossContinuation { return { state: this.state, phase: this.phase, checkpoint: this.checkpoint, attempts: this.attempts, t: this.t, skipT: this.skipT, short: this.short, saved: { ...this.saved } }; }
  /** Restore without replaying intro/victory actions or persistence callbacks. */
  restore(value: BossContinuation): void {
    if (!['dormant', 'armed', 'intro', 'fight', 'beat', 'victory'].includes(value.state)
      || ![value.phase, value.checkpoint].every((n) => Number.isInteger(n) && n >= 0 && n < this.def.phases.length)
      || !Number.isSafeInteger(value.attempts) || value.attempts < 1 || ![value.t, value.skipT].every((n) => Number.isFinite(n) && n >= 0)
      || typeof value.short !== 'boolean' || typeof value.saved.defeated !== 'boolean' || typeof value.saved.rewardTaken !== 'boolean' || !Number.isSafeInteger(value.saved.kills) || value.saved.kills < 0) throw new Error('Invalid boss continuation');
    this.state = value.state; this.phase = value.phase; this.checkpoint = value.checkpoint; this.attempts = value.attempts;
    this.t = value.t; this.skipT = value.skipT; this.short = value.short; Object.assign(this.saved, value.saved);
  }

  protected save(): void { this.host.persist(this.saved); }
  /** The reward pickup's record, the one place it changes: once the boss is beaten, the reward is marked taken and saved.
   *  The page's drop callback and a native host's reached prompt both call it; false (nothing saved) when the boss is not
   *  beaten or the reward was already taken. Granting, the drop and its presentation stay with the caller. */
  takeReward(): boolean {
    if (!this.saved.defeated || this.saved.rewardTaken) return false;
    this.saved.rewardTaken = true; this.save(); return true;
  }

  /** Native eligibility hooks preserve observation order; an authored subclass may select the transition. */
  protected introReady(inside: boolean): boolean { return inside; }
  /** Called after the intro pose, camera, skip clock and skip presentation. */
  protected fightReady(elapsed: number, skip: number, length: number): boolean { return elapsed >= length || skip >= SKIP_HOLD; }
  /** Called before the beat's bar update. */
  protected beatReady(elapsed: number): boolean { return elapsed >= BEAT; }
  /** Death is observed before the next phase's health threshold. */
  protected winReady(dead: boolean): boolean { return dead; }
  /** Health is read only when a next phase exists and death did not win. */
  protected phaseReady(at: number): boolean { return this.script.hpFrac <= at; }

  /** ready at the threshold: the room at the checkpoint phase, the seal open */
  arm(): void {
    if (this.state === 'victory' || this.state === 'armed') return;
    this.script.setInvulnerable(false);
    this.script.reset(this.checkpoint);
    this.script.seal(false);
    this.phase = this.checkpoint;
    this.state = 'armed';
  }

  /** the player left: forget the fight (a later visit starts from phase I; a beaten boss is back in his coffin) */
  disarm(): void {
    if (this.engaged) { this.host.events?.emit('boss.attempt', { boss: this.def.id, outcome: 'left' }); this.host.lockInput(false); }
    this.ui.hideBar(); this.ui.hideNameCard(); this.ui.hideReward();
    this.checkpoint = 0; this.attempts = 1;
    this.state = 'dormant';
  }

  /** the player died. In this fight → back at the checkpoint (true); anywhere else → not ours (false) */
  onPlayerDeath(): boolean {
    if (!this.engaged) return false;
    this.host.events?.emit('boss.attempt', { boss: this.def.id, outcome: 'died' });
    this.host.lockInput(false);
    this.attempts++;
    this.ui.hideBar(); this.ui.hideNameCard();
    this.ui.showRetry(this.def.retryTitle, this.attempts);
    this.host.music?.('death');
    const r = this.script.respawnPoint();
    this.host.respawn(r.pos, r.yaw);
    this.state = 'dormant';
    this.arm();
    return true;
  }

  /** dev: jump straight into phase `phase` (0-based) as if the checkpoint were there */
  devStartAt(phase: number): void {
    this.checkpoint = Math.max(0, Math.min(this.def.phases.length - 1, phase));
    this.state = 'dormant'; this.arm();
  }

  update(dt: number, t: number): void {
    this.ui.update(dt);
    const p = this.host.player.position;
    switch (this.state) {
      case 'dormant': break;
      case 'armed':
        if (this.introReady(this.script.inArena(p))) this.startIntro();
        break;
      case 'intro': {
        this.t += dt;
        const len = this.short ? this.def.introShort : this.def.intro;
        const focus = this.script.intro(this.t, this.short);
        this.host.faceToward(focus, dt);
        this.skipT = this.host.skipHeld() ? this.skipT + dt : 0;
        this.ui.setSkip(this.skipT / SKIP_HOLD);
        if (this.fightReady(this.t, this.skipT, len)) this.beginFight();
        break;
      }
      case 'beat':
        this.t += dt;
        if (this.beatReady(this.t)) { this.script.setInvulnerable(false); this.state = 'fight'; }
        this.syncBar();
        break;
      case 'fight': {
        this.syncBar();
        if (this.winReady(this.script.dead)) { this.win(); break; }
        const next = this.def.phases[this.phase + 1];
        if (next !== undefined && this.phaseReady(next.at)) {
          this.phase++;
          this.checkpoint = this.phase;
          this.script.clampHp(next.at);
          this.script.setInvulnerable(true);
          this.script.enterPhase(this.phase);
          this.ui.setPhase(this.phase, next.caption);
          this.host.feed?.(`${this.def.name} · ${next.name}`);
          this.host.music?.('phase', 1);
          this.state = 'beat'; this.t = 0;
        }
        break;
      }
      case 'victory':
        this.t += dt;
        if (this.t > 1.4 && this.ui.barShown) this.ui.hideBar();
        break;
      default: break;
    }
    if (this.state !== 'dormant') this.script.update(dt, t, this.state === 'fight' || this.state === 'beat');
  }

  private syncBar(): void {
    this.ui.setHp(this.script.hpFrac);
    this.ui.setShield(this.script.shielded || this.state === 'beat');
  }

  private startIntro(): void {
    this.host.events?.emit('boss.attempt', { boss: this.def.id, outcome: 'started' });
    this.short = this.attempts > 1 || this.saved.defeated;
    this.script.seal(true);
    this.host.lockInput(true);
    this.ui.showNameCard(this.def.name, this.def.title, this.short);
    this.host.music?.('intro', 1);
    this.t = 0; this.skipT = 0;
    this.state = 'intro';
  }

  private beginFight(): void {
    this.ui.hideNameCard();
    this.host.lockInput(false);
    this.script.begin(this.phase);
    this.ui.showBar(this.def.name, this.def.phases.slice(1).map((ph) => ph.at));
    this.syncBar();
    if (this.phase > 0) { const ph = this.def.phases[this.phase]; if (ph) this.ui.setPhase(this.phase, ph.caption); }
    this.state = 'fight';
  }

  private win(): void {
    this.host.events?.emit('boss.attempt', { boss: this.def.id, outcome: 'won' });
    this.state = 'victory'; this.t = 0;
    this.ui.setHp(0); this.ui.setShield(false);
    this.script.victory();
    this.script.seal(false);
    this.host.music?.('victory');
    this.saved.kills++;
    const first = !this.saved.rewardTaken;
    this.saved.defeated = true;
    this.save();
    this.def.reward.trophy?.();
    if (first) this.host.spawnReward();
    else this.host.toast?.(engineString('s_100cbeedfcec', [this.def.name]));
  }

  /** A declared decision requests an existing phase/win/fail transition, never a second fight owner. */
  validateDecision(verb: number, value: number): void {
    if (!Number.isSafeInteger(value) || (verb === 1 ? value < 0 || value >= this.def.phases.length : value !== 0)
      || ![1, 2, 3].includes(verb)) throw new Error('Invalid encounter decision');
  }
  applyDecision(verb: number, value: number): void {
    this.validateDecision(verb, value);
    if (verb === 1) {
      if (value === this.phase || !this.engaged) return;
      this.phase = value; this.checkpoint = value; this.script.enterPhase(value);
      const phase = this.def.phases[value]; if (phase !== undefined) this.ui.setPhase(value, phase.caption);
    } else if (verb === 2) { if (this.engaged) this.win(); }
    else this.onPlayerDeath();
  }

}
