import type { AppState, Phase } from '../app/systems';
import type { Vector3 } from 'three';
import type { Actor, DamageDealt, DamageRequest, DeathCause } from '../../../shared/engine/combat/pipeline';

export interface FaultEvent { source: string; message: string; phase?: Phase; limit?: number; error?: unknown }
export interface EventMap {
  'app.state': { prev: AppState; next: AppState };
  /** a quest moved a step (src/shared/engine/quest/core.ts emits it; telemetry reads it) */
  'quest.step': { level: string; quest: string; step: string | null; previous: string | null };
  'level.loaded': { id: string };
  'level.unloaded': { id: string };
  'creature.signal': { name: string; x: number; z: number };
  'ai.windup': { actor: Actor; duration: number };
  'damage.dealt': DamageDealt;
  /** J105: a personal roll paid out; only `player` hears of it. */
  'reward.granted': { player: string; coins: number; body: string; item?: string };
  'actor.died': { actor: Actor; req: DamageRequest };
  'player.died': { actor: Actor; checkpoint: boolean; cause?: DeathCause };
  'player.respawned': { at: Vector3; checkpoint: boolean; player?: string };
  'practice.active': boolean;
  'explore.studio': boolean;
  'explore.turntable': { on: boolean; key?: { x: number; y: number; z: number } };
  'fault': FaultEvent;
  'boss.attempt': { boss: string; outcome: 'started' | 'won' | 'died' | 'lost' | 'left'; level?: string };
  /** DL20: one per boot, once its level download settled (complete, failed or cancelled; cached or downloaded): on the
   *  packs path the parts read and failed, the files a failed part left to their loose copies and the loose fetches made
   *  for them (the loose copies retire only after a week of boots with none); `packs` false is the denominator's rest */
  'download.parts': { id: string; level: string; outcome: 'complete' | 'failed' | 'cancelled'; packs: boolean; parts: number; failed: number; fallbackFiles: number; fetched: number };
  /** the player jumped (a ground, coyote or air jump) / dodged; any number of listeners (E357 AG19: no chained hooks) */
  'player.jump': true;
  'player.dodge': true;
  /** the hover board / swimming started (true) or ended (false) */
  'player.hover': boolean;
  'player.swim': boolean;
  /** a lock-on press found nothing to lock */
  'lock.noTarget': true;
}
export interface CrouchRequest { want: boolean; via: 'toggle' | 'hold' }
export interface CrouchAnswer { allowed: boolean; latched: boolean }
export interface AskMap {
  'player.traversal': readonly [number | boolean, number | boolean];
  'player.crouch': readonly [CrouchRequest, CrouchAnswer];
  /** Scope-owned admission precedes reaction callbacks, cover and damage modifiers; absent rules pass through. */
  'damage.admit': [DamageRequest | null, DamageRequest | null];
  'damage.modify': [DamageRequest | null, DamageRequest | null];
  'death.checkpoint': [{ cause?: DeathCause } | boolean, boolean];
}
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Consumers extend this registry by declaration merging.
export interface TagMap {}
export type AskInput<K extends keyof AskMap> = AskMap[K] extends readonly [infer Input, unknown] ? Input : never;
export type AskOutput<K extends keyof AskMap> = AskMap[K] extends readonly [unknown, infer Output] ? Output : never;
export type Tag = Extract<keyof TagMap, string>;
