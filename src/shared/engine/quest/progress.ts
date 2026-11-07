import { engineString } from '../strings';
import type { QuestDef, QuestStep } from './core';

/** Where a player stands in one quest: the whole of what a client is told (P1-E3.3). `step` is null once it is finished. */
export interface QuestProgress { readonly quest: string; readonly started: boolean; readonly step: string | null; readonly n: number }
/** A step's `{n}` of its `{of}` counted flags; null for a step that counts nothing. */
export interface QuestCount { readonly n: number; readonly of: number }

/** The objective line, server and client alike. */
export function questObjective(def: QuestDef, started: boolean, step: QuestStep | null, count: QuestCount | null): string {
  if (!started) return def.intro?.objective ?? '';
  if (!step) return `${def.title} — complete`;
  return count ? step.objective.replace('{n}', String(count.n)).replace('{of}', String(count.of)) : step.objective;
}
/** The HUD chip's two parts: a short label and the counter ('' when the step has none). The counter is kept apart so the
 *  chip can truncate the label and never the count. */
export function questChip(def: QuestDef, started: boolean, step: QuestStep | null, count: QuestCount | null): { label: string; count: string } {
  if (!started) return { label: def.intro?.chip ?? def.intro?.objective ?? '', count: '' };
  if (!step) return { label: engineString('s_f316ae64883e'), count: '' };
  return { label: step.chip ?? step.objective.replace(/\s*·?\s*\{n\}\s*\/\s*\{of\}/, ''), count: count ? `${count.n}/${count.of}` : '' };
}
/** The hint under the objective. */
export function questHint(def: QuestDef, started: boolean, step: QuestStep | null): string {
  return !started ? def.intro?.hint ?? '' : step?.hint ?? '';
}
