// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { QuestRewardController, applyQuestRewardPose } from '../../../shared/game/plugin/quests';
import { QuestRewardBeat } from '../../../client/game/quest/reward';
import { questPhaseSpan, questPhaseAt } from '../../../shared/game/quest/storyLaw';

const player = () => ({ position: new Vector3(2, 3, 4), velocity: new Vector3(1, 0, 1), yaw: 0.3, pitch: 0.1, carried: false });

test('watch continuations and reward poses take the same forward arc through midnight', () => {
  const saved = { from: 0.875, span: 0.25, t: 1, dur: 4, to: 0.125 };
  expect(questPhaseSpan(saved.from, saved.to)).toBe(saved.span);
  expect(questPhaseSpan(saved.to, saved.from)).toBe(0.75);
  expect(questPhaseAt(saved.from, saved.span, saved.t + 1, saved.dur)).toBe(0);
  expect(questPhaseAt(saved.from, saved.span, saved.dur + 1, saved.dur)).toBe(saved.to);
  expect(saved.t).toBe(1);
  const actor = player(), day = { phase: saved.from }, origin = { ...actor, phase: saved.from };
  applyQuestRewardPose(1.75, origin, { phase: saved.to }, actor, day);
  expect(day.phase).toBe(0);
  applyQuestRewardPose(-1, origin, { phase: saved.to }, actor, day);
  expect(day.phase).toBe(saved.from);
});

test('old active reward saves resume quietly and reject invalid ownership before mutation', () => {
  const actor = player(), day = { phase: 0.4 }, events: string[] = [];
  const beat = new QuestRewardController(actor, day, { when: () => true, at: new Vector3(10, 3, 4), finish: () => { events.push('finish'); return false; } },
    { start: () => { events.push('start'); } });
  // The native envelope predates the common controller; the host owns world pose and day phase separately.
  const old = { elapsed: 1.25, carried: false, player: { pitch: 0.2, carried: true },
    from: { x: 2, y: 3, z: 4, yaw: 0.3, pitch: 0.1, phase: 0.4 } };
  beat.restore(old);
  expect(events).toEqual([]); expect(actor.carried).toBe(true); expect(actor.pitch).toBe(old.player.pitch);
  const before = beat.snapshot();
  expect(() => beat.restore({ ...old, player: { pitch: 0.9, carried: false } })).toThrow('must own the player');
  expect(() => beat.restore({ ...old, from: { ...old.from, x: Number.NaN } })).toThrow();
  expect(beat.snapshot()).toEqual(before);
  beat.update(1, false); expect(actor.position.x).toBeGreaterThan(2); expect(actor.position.x).toBeLessThan(10);
  beat.update(0.5, true); expect(actor.carried).toBe(false); expect(events).toEqual(['finish']);
  beat.update(20); expect(events).toEqual(['finish']);
  const finished = new QuestRewardController(player(), day, { when: () => true, finish: () => { throw new Error('Finished save must not pay twice'); } });
  finished.restore(beat.snapshot()); finished.update(20); expect(finished.active).toBe(false);
  beat.dispose(); expect(() => beat.restore(old)).toThrow('disposed');
});

test('a finished reward hands carry to completion, while an active teardown restores its borrower', () => {
  for (const takeover of [false, true]) {
    const actor = player(), events: string[] = [];
    const beat = new QuestRewardController(actor, null, { when: () => true, finish: () => { events.push('finish'); return takeover; } }, {
      start: () => { expect(actor.carried).toBe(true); events.push('start'); },
      finish: () => { events.push('hide'); }, release: () => { expect(actor.carried).toBe(false); events.push('release'); },
    });
    beat.update(0.1, false); beat.update(0.1, true); beat.dispose();
    expect(events).toEqual(takeover ? ['start', 'hide', 'finish'] : ['start', 'hide', 'finish', 'release']);
    expect(actor.carried).toBe(takeover);
  }
  const actor = player(), beat = new QuestRewardController(actor, null, { when: () => true, finish: () => undefined });
  beat.update(0.1); beat.dispose(); expect(actor.carried).toBe(false);
});

test('page rewards keep caption, sting, objective and weapon effects in their original order', () => {
  const scope = new Scope('page-reward'), actor = player(), objective = document.createElement('div'), events: string[] = [];
  const caption = () => document.querySelector('.ws-quest-reward');
  const beat = scope.run(() => new QuestRewardBeat({ scope, player: actor, objective,
    setViewmodel: on => {
      expect(actor.carried).toBe(!on); expect(caption()?.classList.contains('show')).toBe(!on); events.push(on ? 'weapon-up' : 'weapon-down');
    }, sting: () => { expect(objective.classList.contains('ws-quest-hide')).toBe(true); events.push('sting'); } }, {
    kicker: 'Reward', title: 'Quest complete', subtitle: 'Same text', when: () => true,
    finish: () => { expect(caption()?.classList.contains('show')).toBe(false); expect(actor.carried).toBe(true); events.push('finish'); return false; },
  }));
  try {
    beat.update(0.1, false); expect(caption()?.textContent).toContain('Same text');
    beat.update(0.1, true);
    expect(events).toEqual(['weapon-down', 'sting', 'finish', 'weapon-up']);
    expect(objective.classList.contains('ws-quest-hide')).toBe(false);
    expect(beat.active).toBe(false);
  } finally { scope.dispose(); }
  expect(caption()).toBeNull();
});
