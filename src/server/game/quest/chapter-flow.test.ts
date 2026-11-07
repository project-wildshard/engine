// CI12: a chapter line's readouts from the renderer-free kernel equal the inline presentation code it replaced, at every
// step of a two-chapter line (the chip, the step toasts, the reward caption, the map quest and the feat events).
import { expect, test } from 'vitest';
import { QuestLine, type QuestDef, type QuestState } from '@wildshard/engine/quest/core';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { parseChapterStoryPresentation } from '@wildshard/format/questStory';
import { chapterFlow } from '../../../shared/game/quest/chapterFlow';

const defs: QuestDef[] = [
  { id: 'ch1', title: 'Tulpar', intro: { objective: 'Speak to the elder', chip: 'TULPAR', hint: 'At the camp' }, startWhen: { all: ['talked'] }, completeFlag: 'ch1-done',
    steps: [{ id: 'tame', objective: 'Tame a stallion', hint: 'Crouch downwind', done: { all: ['tamed'] } },
      { id: 'kokpar', objective: 'Win kokpar ({n}/{of})', count: ['r1', 'r2'], done: { all: ['r1', 'r2'] } },
      { id: 'home', objective: 'Ride home', done: { all: ['home'] } }] },
  { id: 'ch2', title: 'The Golden King', startWhen: { all: ['ch1-done'] }, completeFlag: 'ch2-done',
    steps: [{ id: 'balbals', objective: 'Topple the balbals', done: { all: ['balbals'] } }] },
];
const rows = parseChapterStoryPresentation({ chapters: ['ch1', 'ch2'], talks: [], rewards: { ch1: { event: 'ch1.reward', title: 'A horse of your own' } },
  flagEvents: [{ flag: 'tamed', event: 'feat.tamed' }, { flag: 'home', event: 'feat.home' }],
  introTitle: 'A new story', chapterTitle: 'Chapter {chapter}: {title}', completedObjective: 'Done: {title}', completedHint: 'Ride free',
  rewardKicker: 'Chapter {chapter} complete', rewardSubtitle: 'Reward: {reward}', started: 'New: {title}', objective: '{chapter} · {objective}', rewardMs: 2000 });

/** what presentChapterStory computed inline before the kernel (story.ts, before CI12) */
function inline(line: QuestLine, flags: Flags) {
  const text = (template: string, q: QuestState): string => template.replaceAll('{chapter}', String(line.number(q)))
    .replaceAll('{title}', q.def.title).replaceAll('{objective}', q.objective()).replaceAll('{reward}', rows.rewards[q.def.id]?.title ?? '');
  const chip = () => { const q = line.active; return q === null ? { label: '', count: '' } : { label: q.def.intro?.chip ?? q.def.title, count: q.isStarted ? `${Math.min(q.def.steps.length, q.index + 1)}/${q.def.steps.length}` : '' }; };
  const toast = (q: QuestState, step: QuestState['current'], previous: QuestState['current']): string | null => step === null ? null : text(previous === null ? rows.started : rows.objective, q);
  const reward = (q: QuestState) => ({ kicker: text(rows.rewardKicker, q), title: q.def.title, subtitle: rows.rewards[q.def.id] === undefined ? '' : text(rows.rewardSubtitle, q) });
  const map = () => {
    const q = line.active;
    if (q !== null) return { title: q.isStarted ? text(rows.chapterTitle, q) : rows.introTitle, objective: q.objective(), hint: q.hint() };
    const last = line.chapters.at(-1);
    return last === undefined ? null : { title: text(rows.chapterTitle, last), objective: text(rows.completedObjective, last), hint: rows.completedHint };
  };
  const feats = () => {
    const out: [string, number][] = [];
    for (const row of rows.flagEvents) if (flags.has(row.flag)) out.push([row.event, 1]);
    for (const q of line.chapters) { const r = rows.rewards[q.def.id]; if (r !== undefined && q.isComplete) out.push([r.event, 1]); }
    return out;
  };
  return { chip, toast, reward, map, feats };
}

test('the kernel reads a chapter line as the inline presentation did, step by step', () => {
  const flags = new Flags('chapter-flow-test', false), line = new QuestLine(defs, flags);
  const flow = chapterFlow(line, rows), old = inline(line, flags);
  const toasts: [string | null, string | null][] = [], rewards: [unknown, unknown][] = [];
  line.onStep = (q, step, previous) => { toasts.push([flow.stepToast(q, step, previous), old.toast(q, step, previous)]); };
  line.onComplete = q => { rewards.push([flow.reward(q), old.reward(q)]); };
  const seen: string[] = [];
  for (const flag of ['', 'talked', 'tamed', 'r1', 'r2', 'home', 'balbals']) {
    if (flag !== '') flags.set(flag);
    expect(flow.chip()).toEqual(old.chip()); expect(flow.mapQuest()).toEqual(old.map()); expect(flow.feats(flags)).toEqual(old.feats());
    seen.push(`${flow.chip().label} ${flow.chip().count} | ${flow.mapQuest()?.title ?? ''} | ${flow.mapQuest()?.objective ?? ''}`);
  }
  for (const [now, before] of toasts) expect(now).toBe(before);
  for (const [now, before] of rewards) expect(now).toEqual(before);
  // the readouts move as the chapters do (not just equal): intro, each step, the second chapter, the finished line
  expect(seen).toEqual(['TULPAR  | A new story | Speak to the elder', 'TULPAR 1/3 | Chapter 1: Tulpar | Tame a stallion',
    'TULPAR 2/3 | Chapter 1: Tulpar | Win kokpar (0/2)', 'TULPAR 2/3 | Chapter 1: Tulpar | Win kokpar (1/2)', 'TULPAR 3/3 | Chapter 1: Tulpar | Ride home',
    'The Golden King 1/1 | Chapter 2: The Golden King | Topple the balbals', '  | Chapter 2: The Golden King | Done: The Golden King']);
  expect(toasts.map(([now]) => now).filter(t => t !== null)).toEqual(['New: Tulpar', '1 · Win kokpar (0/2)', '1 · Ride home', 'New: The Golden King']); // a count within a step is no step change
  expect(rewards.map(([now]) => now)).toEqual([{ kicker: 'Chapter 1 complete', title: 'Tulpar', subtitle: 'Reward: A horse of your own' },
    { kicker: 'Chapter 2 complete', title: 'The Golden King', subtitle: '' }]);
  expect(flow.feats(flags)).toEqual([['feat.tamed', 1], ['feat.home', 1], ['ch1.reward', 1]]);
  line.dispose();
});
