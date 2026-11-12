import { expect, test } from 'vitest';
import { finishedAfterSeen } from './finishedAfterSeen';

// TE-ENG8: a quest a save already finished raises no "Quest complete" beat on load. On the wire the page's flags mirror the
// server's only from the world's first frame, so at install the finished quest still reads open.
const wire = (following: boolean) => ({ following, settled: false });

test('a quest finished in the save, read open at install and finished at the first settled frame, raises no beat', () => {
  const quest = { isComplete: false }, on = wire(true), finished = finishedAfterSeen(quest, on);
  expect(finished()).toBe(false);
  quest.isComplete = true; // the mirror: flags arrive in the same frame the world settles
  on.settled = true;
  for (let frame = 0; frame < 5; frame++) expect(finished()).toBe(false);
});

test('a quest open at the first settled frame raises its beat when it finishes later', () => {
  const quest = { isComplete: false }, on = wire(true), finished = finishedAfterSeen(quest, on);
  on.settled = true;
  expect(finished()).toBe(false);
  quest.isComplete = true;
  expect(finished()).toBe(true);
  on.settled = false; // a crossing: what the page first saw stands
  expect(finished()).toBe(true);
});

test('before the first settled frame nothing is news, even a quest that reads finished', () => {
  const quest = { isComplete: true }, on = wire(true), finished = finishedAfterSeen(quest, on);
  expect(finished()).toBe(false);
  on.settled = true;
  expect(finished()).toBe(false);
});

test('a page off the wire reads its own flags at install', () => {
  const done = { isComplete: true }, open = { isComplete: false };
  const already = finishedAfterSeen(done, wire(false)), later = finishedAfterSeen(open, wire(false));
  expect(already()).toBe(false);
  expect(later()).toBe(false);
  open.isComplete = true;
  expect(later()).toBe(true);
});
