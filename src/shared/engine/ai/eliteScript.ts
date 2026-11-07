import type { ExternalEliteData } from '@wildshard/format/eliteFeature';

/** A script-mode borrowed elite's decisions as numbers only (Nalati's Qara Batyr: his night charge): its readiness, the
 *  10 Hz step that calls its support riders, its paged fight's frame and effects, its strike tell and its damage scale.
 *  No scene, body view, tell or HUD: the page's BorrowedElite (ai/view/eliteEntry.ts) and the Node simulation (CI12's
 *  Nalati tape) apply the same results to their own bodies and effects. */

/** The admitted decision program the elite projects (the entry's condition program). */
export interface EliteProjection { readonly project: (signal: string, observations: Readonly<Record<string, number>>) => Readonly<Record<string, number>> }
/** The fight a script-mode elite drives: its owner's admitted spawn program, paged afresh for each adopted body. `P` is the
 *  player point the fight reads (the page's Vector3). */
export interface EliteScriptFight<P = unknown, B = unknown> {
  readonly adopt: (slot: string, id: string) => void; readonly interrupt: () => void; readonly signal: (slot: string, n: number) => void;
  readonly cue: (id: number) => string; readonly state: (slot: string) => Readonly<Record<string, number | boolean>>;
  readonly frame: (point: P, night: number, observations: Readonly<Record<string, number>>) => void; readonly advanceFrame: (dt: number) => void;
  readonly drainEffects: () => readonly ({ readonly kind: 'cue' | 'retire'; readonly id: number } | { readonly kind: 'hit'; readonly hit: { readonly damage: number } }
    | { readonly kind: 'page-bank'; readonly bank: B })[];
  readonly strikePresentation: () => readonly { readonly phase: string; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly width: number }[];
}
type Row = Pick<ExternalEliteData, 'mode' | 'ready' | 'step' | 'damage' | 'cues'>;

/** The readiness check, on the first observation and every 0.1 s after: a herd-mode elite is always ready, a script-mode
 *  one when its `ready` projection accepts tonight's kills. */
export class EliteReadiness {
  private readyTime = 0; private initialized = false;
  eligible = false;
  observe(row: Row, decisions: EliteProjection, dt: number, kills: number): void {
    this.readyTime += dt;
    if (!this.initialized || this.readyTime + 1e-9 >= .1) {
      this.initialized = true; this.readyTime = 0;
      this.eligible = row.mode === 'herd' || decisions.project(row.ready, { kills, engaged: 0, line: 0 })['accept'] === 1;
    }
  }
  /** CI12: the readiness clock as data (a native checkpoint) */
  snapshot(): EliteReadinessSnapshot { return { readyTime: this.readyTime, initialized: this.initialized, eligible: this.eligible }; }
  restore(saved: EliteReadinessSnapshot): void {
    if (!Number.isFinite(saved.readyTime) || saved.readyTime < 0) throw new Error('Invalid elite readiness snapshot');
    this.readyTime = saved.readyTime; this.initialized = saved.initialized; this.eligible = saved.eligible;
  }
}
export interface EliteReadinessSnapshot { readonly readyTime: number; readonly initialized: boolean; readonly eligible: boolean }

/** The damage a hit on the elite takes, scaled by its fight's mode and the player's distance. */
export function eliteDamageScale(row: Row, decisions: EliteProjection, mode: number, distance: number): number {
  return decisions.project(row.damage, { mode, distance })['scale'] ?? 1;
}

/** What one frame of the fight leaves, in order: support riders to call, page banks, a hit on the player (with the knock
 *  along the elite's facing), a cue (its signature, voice and feed). */
export type EliteScriptEffect<B = unknown> = { readonly kind: 'support'; readonly count: number } | { readonly kind: 'page-bank'; readonly bank: B }
  | { readonly kind: 'hit'; readonly amount: number; readonly knockX: number; readonly knockZ: number }
  | { readonly kind: 'cue'; readonly signature: boolean; readonly voice?: string; readonly feed?: string };
/** The strike tell this frame: the last strike in its windup (1) or active (2), its lane ends and width; null for none. */
export interface EliteStrikeTell { readonly strike: 1 | 2; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly width: number }
export interface EliteScriptInputs { readonly kills: number; readonly engaged: boolean; readonly leashing: boolean; readonly phase2: boolean; readonly time: number; readonly line: number;
  /** the elite's facing when a hit lands (after the fight's frame has moved it) */
  readonly yaw: () => number }

/** One frame of a script-mode elite whose clock (`elapsed`, already advanced by this frame's dt) has run: every 0.1 s
 *  the step projection calls support riders; then the fight reads the player and advances `dt`, and its effects and
 *  strike tell come back. Returns the clock after the frame. */
export function eliteScriptFrame<P, B>(row: Row, decisions: EliteProjection, fight: EliteScriptFight<P, B>, elapsed: number, dt: number, player: P,
  input: EliteScriptInputs): { readonly elapsed: number; readonly effects: EliteScriptEffect<B>[]; readonly tell: EliteStrikeTell | null } {
  const effects: EliteScriptEffect<B>[] = [];
  let clock = elapsed;
  if (clock + 1e-9 >= .1) {
    clock = 0;
    const count = decisions.project(row.step, { kills: input.kills, engaged: Number(input.engaged), line: input.line })['count'] ?? 0;
    if (count > 0) effects.push({ kind: 'support', count });
  }
  fight.frame(player, 0, { engaged: Number(input.engaged), leashing: Number(input.leashing), phase2: Number(input.phase2), clock: input.time }); fight.advanceFrame(dt);
  for (const effect of fight.drainEffects()) {
    if (effect.kind === 'page-bank') effects.push(effect);
    else if (effect.kind === 'hit') effects.push({ kind: 'hit', amount: effect.hit.damage, knockX: Math.sin(input.yaw()), knockZ: Math.cos(input.yaw()) });
    else if (effect.kind === 'cue') {
      const cue = row.cues[fight.cue(effect.id)]; if (cue === undefined) continue;
      effects.push({ kind: 'cue', signature: cue.signature === true, ...(cue.voice === undefined ? {} : { voice: cue.voice }), ...(cue.feed === undefined ? {} : { feed: cue.feed }) });
    }
  }
  let tell: EliteStrikeTell | null = null;
  for (const strike of fight.strikePresentation()) if (strike.phase === 'windup' || strike.phase === 'active') {
    tell = { strike: strike.phase === 'windup' ? 1 : 2, x0: strike.x0, z0: strike.z0, x1: strike.x1, z1: strike.z1, width: strike.width };
  }
  return { elapsed: clock, effects, tell };
}
