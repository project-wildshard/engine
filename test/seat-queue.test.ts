import { expect, test } from 'vitest';
import { SeatQueue, QUEUE_TICKET_MS } from '../src/server/host/dedicated/seatQueue';

// FM7b2 (meta MMO-FAILURE-MODES-PLAN, mode 25): a full world's waiting line. Position is the door's ordered, deduplicated ticket,
// never a client's count of tries; a freed seat is held for the head of the line; Title's quit cancels; a ticket nobody renews expires.

test('tickets are ordered and deduplicated, and a retry keeps its place', () => {
  const queue = new SeatQueue();
  expect(queue.turn('a', 0, 0)).toEqual({ admit: false, position: 1 });
  expect(queue.turn('b', 0, 10)).toEqual({ admit: false, position: 2 });
  expect(queue.turn('a', 0, 20)).toEqual({ admit: false, position: 1 });
  expect(queue.turn('c', 0, 30)).toEqual({ admit: false, position: 3 });
  expect(queue.size).toBe(3);
});

test('a freed seat is held for the head: a later ticket or a newcomer waits, the head walks in', () => {
  const queue = new SeatQueue();
  queue.turn('a', 0, 0); queue.turn('b', 0, 0);
  expect(queue.turn('newcomer', 1, 5)).toEqual({ admit: false, position: 3 });
  expect(queue.turn('b', 1, 5)).toEqual({ admit: false, position: 2 });
  expect(queue.turn('a', 1, 5)).toEqual({ admit: true });
  expect(queue.turn('b', 1, 6)).toEqual({ admit: true });
  expect(queue.size).toBe(1);
  // with nobody waiting a free seat is anybody's
  const empty = new SeatQueue();
  expect(empty.turn('x', 1, 0)).toEqual({ admit: true });
  expect(empty.size).toBe(0);
});

test('two free seats admit the first two tickets, and never more than are free', () => {
  const queue = new SeatQueue();
  for (const seat of ['a', 'b', 'c']) queue.turn(seat, 0, 0);
  expect(queue.turn('c', 2, 1)).toEqual({ admit: false, position: 3 });
  expect(queue.turn('b', 2, 1)).toEqual({ admit: true });
  // `free` is the door's own count: b's seat is taken now
  expect(queue.turn('a', 1, 2)).toEqual({ admit: true });
  expect(queue.turn('c', 0, 3)).toEqual({ admit: false, position: 1 });
});

test('Title\'s quit cancels a ticket at once, and the line closes up', () => {
  const queue = new SeatQueue();
  queue.turn('a', 0, 0); queue.turn('b', 0, 0);
  expect(queue.leave('a')).toBe(true);
  expect(queue.leave('a')).toBe(false);
  expect(queue.turn('b', 0, 1)).toEqual({ admit: false, position: 1 });
});

test('a ticket nobody renews expires; one renewed on the retry cadence never does', () => {
  const queue = new SeatQueue();
  queue.turn('gone', 0, 0); queue.turn('here', 0, 0);
  for (let at = 30_000; at < 200_000; at += 30_000) expect(queue.turn('here', 0, at)).toMatchObject({ admit: false });
  expect(queue.turn('here', 0, 200_000)).toEqual({ admit: false, position: 1 });
  expect(QUEUE_TICKET_MS).toBeGreaterThan(30_000);
  expect(queue.turn('late', 1, 200_001 + QUEUE_TICKET_MS)).toEqual({ admit: true });
});

test('the wait is estimated only from measured turnover of the line; too little history is unknown', () => {
  const queue = new SeatQueue();
  // the waiting clients' 30 s retries, with no seat free
  const renew = (at: number, ...seats: string[]): void => { for (const seat of seats) queue.turn(seat, 0, at); };
  renew(0, 'a', 'b', 'c', 'd', 'e');
  expect(queue.turn('e', 0, 1)).toEqual({ admit: false, position: 5 });
  renew(30_000, 'a', 'b', 'c', 'd', 'e');
  expect(queue.turn('a', 1, 60_000)).toEqual({ admit: true });
  renew(60_000, 'b', 'c', 'd', 'e'); renew(90_000, 'b', 'c', 'd', 'e');
  expect(queue.turn('b', 1, 120_000)).toEqual({ admit: true });
  renew(120_000, 'c', 'd', 'e');
  // two admissions: one gap is not a measured rate
  expect(queue.turn('e', 0, 121_000)).toEqual({ admit: false, position: 3 });
  renew(150_000, 'c', 'd', 'e');
  expect(queue.turn('c', 1, 180_000)).toEqual({ admit: true });
  // three admissions 60 s apart: the next one in line is about 60 s out, the second 120 s
  expect(queue.turn('d', 0, 181_000)).toEqual({ admit: false, position: 1, etaMs: 60_000 });
  expect(queue.turn('e', 0, 181_000)).toEqual({ admit: false, position: 2, etaMs: 120_000 });
  // history older than the window is no measurement (and the line, unrenewed, has expired)
  expect(queue.turn('e', 0, 181_000 + 16 * 60_000)).toEqual({ admit: false, position: 1 });
});

test('the line has a bound: past it a refusal carries no position and stores nothing', () => {
  const queue = new SeatQueue({ cap: 2 });
  queue.turn('a', 0, 0); queue.turn('b', 0, 0);
  expect(queue.turn('c', 0, 0)).toEqual({ admit: false });
  expect(queue.size).toBe(2);
});
