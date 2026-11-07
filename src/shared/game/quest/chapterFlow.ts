/**
 * A chapter story line's readouts, renderer-free (CI12: the Node tapes read Nalati's chapters without the chip, dialogue
 * or caption views): what `presentChapterStory` shows of the line, the chip's label and count, the step toasts, the reward
 * caption's text, the map's quest and the feat events, the same arithmetic in the same order.
 *
 *   const flow = chapterFlow(line, rows);   // flow.chip() → { label: 'TULPAR', count: '1/3' }
 */
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { QuestLine, QuestState } from '@wildshard/engine/quest/core';
import type { parseChapterStoryPresentation } from '@wildshard/format/questStory';

type ChapterRows = ReturnType<typeof parseChapterStoryPresentation>;

export interface ChapterFlow {
  /** a row template with the chapter's number, title, objective and reward title in it */
  text: (template: string, q: QuestState) => string;
  /** the chip: the active chapter's label and its step count ('' before it starts), blank when every chapter is done */
  chip: () => { label: string; count: string };
  /** the toast a step change shows (null: none, a cleared step) */
  stepToast: (q: QuestState, step: QuestState['current'], previous: QuestState['current']) => string | null;
  /** the reward caption a completed chapter shows */
  reward: (q: QuestState) => { kicker: string; title: string; subtitle: string };
  /** the map's quest: the active chapter's, else the last one completed (null: no chapters) */
  mapQuest: () => { title: string; objective: string; hint: string } | null;
  /** the feat events earned now, in order: the flag events whose flag is set, then the completed chapters' rewards */
  feats: (flags: Flags) => [event: string, count: number][];
}

/** The readouts of a bound chapter line (`rows`: its parsed presentation) */
export function chapterFlow(line: Pick<QuestLine, 'chapters' | 'active' | 'number'>, rows: ChapterRows): ChapterFlow {
  const text = (template: string, q: QuestState): string => template.replaceAll('{chapter}', String(line.number(q)))
    .replaceAll('{title}', q.def.title).replaceAll('{objective}', q.objective()).replaceAll('{reward}', rows.rewards[q.def.id]?.title ?? '');
  return {
    text,
    chip: () => {
      const q = line.active;
      return q === null ? { label: '', count: '' } : { label: q.def.intro?.chip ?? q.def.title, count: q.isStarted ? `${Math.min(q.def.steps.length, q.index + 1)}/${q.def.steps.length}` : '' };
    },
    stepToast: (q, step, previous) => step === null ? null : text(previous === null ? rows.started : rows.objective, q),
    reward: q => ({ kicker: text(rows.rewardKicker, q), title: q.def.title, subtitle: rows.rewards[q.def.id] === undefined ? '' : text(rows.rewardSubtitle, q) }),
    mapQuest: () => {
      const q = line.active;
      if (q !== null) return { title: q.isStarted ? text(rows.chapterTitle, q) : rows.introTitle, objective: q.objective(), hint: q.hint() };
      const last = line.chapters.at(-1);
      return last === undefined ? null : { title: text(rows.chapterTitle, last), objective: text(rows.completedObjective, last), hint: rows.completedHint };
    },
    feats: flags => {
      const out: [string, number][] = [];
      for (const row of rows.flagEvents) if (flags.has(row.flag)) out.push([row.event, 1]);
      for (const q of line.chapters) { const reward = rows.rewards[q.def.id]; if (reward !== undefined && q.isComplete) out.push([reward.event, 1]); }
      return out;
    },
  };
}
