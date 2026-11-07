// CI12 Nalati chapter: the chapter's decision, split out of buildQuestChapter (chapterDecide, renderer-free), observes,
// projects and commits exactly as the chapter's inline project did: the same declared observations read for each signal, the
// same program inputs, and the same effects committed in the program's channel order.
import { expect, test } from 'vitest';
import { chapterDecide } from '../src/shared/game/quest/chapterDecision';
import { parseChapterStoryPresentation } from '@wildshard/format/questStory';

const rows = parseChapterStoryPresentation({ chapters: ['ch1'], talks: [], rewards: {}, flagEvents: [], introTitle: 'A', chapterTitle: 'B', completedObjective: 'C', completedHint: 'D',
  rewardKicker: 'E', rewardSubtitle: 'F', started: 'G', objective: 'H', rewardMs: 1000,
  decision: {
    observations: { tamed: { source: { flag: 'tamed' } }, kokpar: { source: { quest: 'ch1', state: 'active', step: 'kokpar' }, on: 'tick' },
      king: { source: { saved: { record: 'bosses', id: 'golden-king', field: 'defeated' } }, on: 'dusk' } },
    actions: { home: [{ kind: 'flag', flag: 'ride-home' }], toast: [{ kind: 'toast', text: 'The herd follows' }, { kind: 'flag', flag: 'herd' }],
      done: [{ kind: 'flag', flag: 'ch1-done' }] },
  } });
const decision = rows.decision;

test('the chapter decides as its inline project did', () => {
  for (let n = 0; n < 1500; n++) {
    const signal = ['tick', 'dusk', 'step', 'talk'][n % 4] ?? 'tick', values = { t: n * .1, phase: n % 3 };
    const outputs = { home: n % 3 === 0 ? 1 : 0, toast: (n >> 1) % 2, done: n % 17 === 0 ? 1 : 0, quiet: 0, extra: n % 5 === 0 ? 2 : 0 };
    const run = (split: boolean): string[] => {
      const log: string[] = [];
      const observe = (source: unknown): number => { log.push(`observe ${JSON.stringify(source)}`); return n % 7; };
      const commit = (effects: unknown): void => { log.push(`commit ${JSON.stringify(effects)}`); };
      const brain = { project: (s: string, observed: Readonly<Record<string, number>>) => { log.push(`project ${s} ${JSON.stringify(observed)}`); return outputs; } };
      let result: Readonly<Record<string, number>>;
      if (split) result = chapterDecide(brain, decision, signal, values, observe, commit);
      else {
        // buildQuestChapter's project before the split (chapter.ts, before CI12)
        const observed: Record<string, number> = { ...values };
        for (const [observationId, row] of Object.entries(decision?.observations ?? {})) if (row.on === undefined || row.on === signal) observed[observationId] = observe(row.source);
        result = brain.project(signal, observed);
        for (const [channel, value] of Object.entries(result)) if (value !== 0) { const effects = decision?.actions[channel]; if (effects !== undefined) commit(effects); }
      }
      log.push(`result ${JSON.stringify(result)}`);
      return log;
    };
    expect(run(true)).toEqual(run(false));
  }
});
