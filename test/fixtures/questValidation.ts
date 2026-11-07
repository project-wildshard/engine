import { CHIP_MAX, type QuestDef } from '../../src/shared/engine/quest/core';
import type { Cond } from '../../src/shared/engine/world/interact/types';

// Historical contract oracle; production consumers use the data-driven owners.
/** checks a quest def is sound: unique step ids, every step reachable (a done condition that is not trivially true) */
export function validateQuest(q: QuestDef, raised: Set<string>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const reads = (c: Cond | undefined) => (c ? [...(c.all ?? []), ...(c.any ?? []), ...(c.none ?? [])] : []);
  if (q.steps.length === 0) errs.push(`${q.id}: no steps`);
  for (const s of q.steps) {
    if (ids.has(s.id)) errs.push(`${q.id}.${s.id}: duplicate step id`);
    ids.add(s.id);
    if (reads(s.done).length === 0) errs.push(`${q.id}.${s.id}: a step with an empty done condition is always done`);
    for (const f of [...reads(s.done), ...(s.count ?? []), ...(s.markers ?? []).flatMap((m) => reads(m.hideWhen))]) if (!raised.has(f)) errs.push(`${q.id}.${s.id}: reads '${f}' that nothing raises`);
    if (!s.objective.trim()) errs.push(`${q.id}.${s.id}: empty objective`);
    if (s.chip !== undefined && s.chip.length > CHIP_MAX) errs.push(`${q.id}.${s.id}: chip '${s.chip}' is longer than ${CHIP_MAX}`);
    for (const m of s.markers ?? []) if (m.short !== undefined && m.short.length > CHIP_MAX) errs.push(`${q.id}.${s.id}: marker short '${m.short}' is longer than ${CHIP_MAX}`);
  }
  if (q.intro?.chip !== undefined && q.intro.chip.length > CHIP_MAX) errs.push(`${q.id}: intro chip '${q.intro.chip}' is longer than ${CHIP_MAX}`);
  for (const f of reads(q.startWhen)) if (!raised.has(f)) errs.push(`${q.id}: startWhen reads '${f}' that nothing raises`);
  return errs;
}
