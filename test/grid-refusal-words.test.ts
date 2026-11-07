import { expect, test } from 'vitest';
import { classifyRefusal } from '../src/client/game/grid/refusal';

test('a tab older than the deployment says it needs the upgrade, not that the shard is too big', () => {
  expect(classifyRefusal(new Error('Build must publish source residency'))).toBe('upgrade');
  expect(classifyRefusal(new Error('Build must publish post cost'))).toBe('upgrade');
});

test('real memory refusals still read as too big', () => {
  expect(classifyRefusal(new Error('Regional checkpoint basis exceeds residency budget'))).toBe('too-big');
  expect(classifyRefusal(new Error('cache capacity exceeded'))).toBe('too-big');
});
