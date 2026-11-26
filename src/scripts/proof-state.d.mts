import type { GameplayState } from '../client/engine/debug/probe.ts';
import type { QuestProgress } from '../shared/engine/quest/progress.ts';

/** A worker quest keeps its full count with a dev net reader; the ordinary report supplies its step. */
export type ProofQuest = Omit<QuestProgress, 'n'> & { readonly n?: number };
/** One observation, read without changing the player, world or server. */
export type ProofState = Omit<GameplayState, 'quest' | 'creatures'> & {
  readonly quest: Readonly<Record<string, unknown>> & {
    readonly flags: readonly string[];
    readonly phased: readonly string[] | null;
    readonly quests: readonly ProofQuest[];
  };
  readonly creatures: readonly { readonly kind: string; readonly pos: { readonly x: number; readonly y: number; readonly z: number } }[];
  readonly seat: {
    readonly cell: number;
    readonly instance: string | null;
    readonly slug: string | null;
    readonly inside: string | null;
    readonly status: 'cell' | 'road' | 'local' | 'unknown';
  } | null;
};
/** Closure-free browser reader for page.evaluate; null means no gameplay probe yet. Request the creature kinds the proof checks. */
export function readProofState(options?: { readonly creatureKinds?: readonly string[] }): ProofState | null;
