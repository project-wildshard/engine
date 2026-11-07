import {admissionPage} from './fixtures/nalati-admission-loan';
import { expect, test } from 'vitest';
import { ProjectedMotionSample } from '../src/shared/game/population/returnProgram';

test('AS owns named-elite gates, captain support and herd display/adoption decisions', () => {
  const policy = admissionPage();
  for (let rule = 0; rule < 4; rule++) for (let phase = 0; phase < 3; phase++) for (const storm of [0, 1]) {
    expect(policy.project('eliteRule', { rule, phase, storm })['accept']).toBe(Number(rule === 0 || rule === 1 && storm === 1 || rule === 2 && phase === 2 || rule === 3 && phase >= 1));
  }
  expect(policy.project('eliteAux', { kills: 4, engaged: 1, line: 0 })).toEqual({ accept: 0, count: 3 });
  expect(policy.project('eliteAux', { kills: 5, engaged: 1, line: 2 })).toEqual({ accept: 1, count: 0 });
  expect(policy.project('eliteDamage', { mode: 4, distance: 3.79 })).toEqual({ scale: 3 });
  expect(policy.project('eliteDamage', { mode: 4, distance: 3.8 })).toEqual({ scale: 1 });
  const row = { dt: .1, state: 1, previousState: 0, laneT: 0, runT: 0, phase2: 1, engaged: 1, bonded: 1, same: 0, health: .25 };
  const display = policy.project('argymaqTick', row);
  expect(display).toMatchObject({ capture: 1, signature: 1, lead: 1, runT: 8, adopt: 1, fraction: 0 });
  expect(display['laneT']).toBeCloseTo(1.1);
  const held = policy.project('argymaqTick', { ...row, previousState: 1, state: 3, bonded: 0, health: 1 });
  expect(held['lead']).toBeUndefined(); expect(held['adopt']).toBe(0); expect(held['fraction']).toBe(1);
});

test('motion observations hold their scalar between ten-Hz AS projections', () => {
  const motion = new ProjectedMotionSample(admissionPage(), 'speed');
  expect(motion.update(.05, 0, 0)).toBe(0);
  expect(motion.update(.05, 1, 0)).toBeCloseTo(6);
  expect(motion.update(.05, 2, 0)).toBeCloseTo(6);
  expect(motion.update(.05, 3, 0)).toBeCloseTo(10.8);
  expect(motion.update(.1, 3, 0)).toBeCloseTo(4.32);
});
