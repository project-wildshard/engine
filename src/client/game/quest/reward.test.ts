// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { QuestRewardBeat } from './reward';

const player = () => ({ position: new Vector3(2, 3, 4), velocity: new Vector3(1, 0, 1), yaw: 0.3, pitch: 0.1, carried: false });

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
