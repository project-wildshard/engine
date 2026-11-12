import { expect, test } from 'vitest';
import { finishedAfterSeen, type SeenWire } from './finishedAfterSeen';

// TE-ENG8: a quest a save already finished raises no "Quest complete" beat on load. On the wire the page's flags mirror the
// server's only from the world's first frame, so at install the finished quest still reads open.
class Wire implements SeenWire {
  readonly following: boolean;
  private readonly waiting = new Set<() => void>();
  settled = false;
  constructor(following: boolean) { this.following = following; }
  readonly whenSettled = (then: () => void): () => void => {
    if (this.settled) { then(); return () => undefined; }
    this.waiting.add(then); return () => { this.waiting.delete(then); };
  };
  /** The world's first frame: flags mirrored, then who waited. */
  settle(): void { this.settled = true; for (const then of this.waiting) { this.waiting.delete(then); then(); } }
  get waits(): number { return this.waiting.size; }
}
const kept: (() => void)[] = [], keep = (cancel: () => void): void => { kept.push(cancel); };

test('a quest finished in the save, read open at install and finished at the first frame, raises no beat', () => {
  const quest = { isComplete: false }, wire = new Wire(true), finished = finishedAfterSeen(quest, wire, keep);
  expect(finished()).toBe(false);
  quest.isComplete = true; // the mirror: flags arrive in the frame the world settles
  wire.settle();
  for (let frame = 0; frame < 5; frame++) expect(finished()).toBe(false);
});

test('a quest open at the first frame raises its beat when it finishes, even when the beat was not polled in between', () => {
  const quest = { isComplete: false }, wire = new Wire(true), finished = finishedAfterSeen(quest, wire, keep);
  wire.settle(); // no poll here: the presentation is parked
  quest.isComplete = true;
  expect(finished()).toBe(true);
  wire.settled = false; // a crossing: what the page first saw stands
  expect(finished()).toBe(true);
});

test('before the first frame nothing is news, even a quest that reads finished', () => {
  const quest = { isComplete: true }, wire = new Wire(true), finished = finishedAfterSeen(quest, wire, keep);
  expect(finished()).toBe(false);
  wire.settle();
  expect(finished()).toBe(false);
});

test('installed after the first frame, it reads the mirrored flags at once', () => {
  const done = { isComplete: true }, open = { isComplete: false }, wire = new Wire(true);
  wire.settle();
  const already = finishedAfterSeen(done, wire, keep), later = finishedAfterSeen(open, wire, keep);
  expect(already()).toBe(false);
  open.isComplete = true;
  expect(later()).toBe(true);
});

test('a page off the wire reads its own flags at install, and a disposed wait is cancelled', () => {
  const done = { isComplete: true }, open = { isComplete: false };
  const already = finishedAfterSeen(done, new Wire(false), keep), later = finishedAfterSeen(open, new Wire(false), keep);
  expect(already()).toBe(false);
  open.isComplete = true;
  expect(later()).toBe(true);
  const wire = new Wire(true), cancels: (() => void)[] = [];
  finishedAfterSeen(open, wire, cancel => { cancels.push(cancel); });
  expect(wire.waits).toBe(1);
  for (const cancel of cancels) cancel();
  expect(wire.waits).toBe(0);
});
