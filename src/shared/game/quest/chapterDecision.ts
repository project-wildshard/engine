/**
 * A chapter's decision, renderer-free (CI12: sp-x8's native chapter consumer runs the real phase -> guest -> effects path):
 * the admitted chapter program is asked a signal with the caller's values and the observations its rows declare for that
 * signal (quest flags and steps, saved boss and elite records), and every non-zero output channel commits its declared quest
 * effects, in the program's channel order. `buildQuestChapter` (chapter.ts) projects through this with the page's quest
 * reads and effect commits; a native host passes its own.
 *
 *   chapterDecide(program, decision, 'tick', { t }, source => readQuestObservation(ctx, quest, source), effects => commit(effects));
 */
import type { ChapterStoryPresentation } from '@wildshard/format/questStory';
import type { ReturnProgram } from '../population/returnProgram';

type Decision = NonNullable<ChapterStoryPresentation['decision']>;
type Source = Decision['observations'][string]['source'];
type Effects = Decision['actions'][string];

/** Project `signal` on `program` with `values` and the declared observations (`observe` reads each source), commit each
 *  non-zero channel's effects (`commit`), and return the program's outputs. */
export function chapterDecide(program: Pick<ReturnProgram, 'project'>, decision: Decision | undefined, signal: string, values: Readonly<Record<string, number>>,
  observe: (source: Source) => number, commit: (effects: Effects) => void): Readonly<Record<string, number>> {
  const observed = { ...values };
  for (const [observationId, row] of Object.entries(decision?.observations ?? {})) {
    if (row.on === undefined || row.on === signal) observed[observationId] = observe(row.source);
  }
  const result = program.project(signal, observed);
  for (const [channel, value] of Object.entries(result)) if (value !== 0) {
    const effects = decision?.actions[channel];
    if (effects !== undefined) commit(effects);
  }
  return result;
}
