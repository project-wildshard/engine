import { expect, test } from 'vitest';
import { SEAT_GRACE_MS, seatedInTime } from '../src/client/game/shardfile/seatGrace';

// OFFLINE OF9 (J298): a world build's load waits for its seat only for the grace, then opens the world without one.
const never = new Promise<never>(() => undefined);
const clock = (): { wait: (ms: number) => Promise<void>; waited: number[]; fire: () => void } => {
  const waited: number[] = [], pending: (() => void)[] = [];
  return { waited, wait: ms => { waited.push(ms); return new Promise<void>(resolve => { pending.push(resolve); }); }, fire: () => { for (const go of pending.splice(0)) go(); } };
};

test('OF9: a seat inside the grace is waited for; no seat by the grace opens the world unseated', async () => {
  const seat = clock();
  expect(await seatedInTime(Promise.resolve({ restored: true }), SEAT_GRACE_MS, true, seat.wait)).toBe(true);
  const none = clock(), answer = seatedInTime(never, SEAT_GRACE_MS, true, none.wait);
  expect(none.waited).toEqual([SEAT_GRACE_MS]);
  none.fire();
  expect(await answer).toBe(false);
});

test('OF9: a page that knows it is offline doesn\'t wait for a seat at all', async () => {
  const offline = clock();
  expect(await seatedInTime(never, SEAT_GRACE_MS, false, offline.wait)).toBe(false);
  expect(offline.waited).toEqual([]);
  expect(SEAT_GRACE_MS).toBeLessThanOrEqual(2000); // the done-when: the world draws within warm LOAD + 2 s
});
