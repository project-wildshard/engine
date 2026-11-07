import {expect, test} from 'vitest';
import {postControlWindow} from '../scripts/phone-loading/post-control';
import type {Mark, RequestRow} from '../scripts/phone-loading/model';

const task = (start: number, duration: number): Mark => ({name: 'self', start, duration, detail: null});
const request = (start: number): RequestRow => ({url: `https://game.test/${start}`, start, end: null,
  source: 'network', bytes: 0, status: 0, failure: null});

test('the first four seconds clip crossing tasks and preserve exact request initiation', () => {
  const tasks = [task(900, 200), task(1100, 200), task(4900, 400), task(5000, 50)];
  const requests = [request(999), request(1000), request(4999), request(5000)];
  const result = postControlWindow(1000, 7000, 4000, tasks, requests, true);
  expect(result).toMatchObject({start: 1000, end: 5000, observedMs: 4000, requestedMs: 4000, complete: true,
    longTaskMs: 400, longTasks: tasks.slice(0, 3), requests: requests.slice(1, 3)});
  expect(tasks.map(row => row.duration)).toEqual([200, 200, 400, 50]);
  // A later network completion cannot rewrite the recorded observation.
  const original = requests[1];
  if (original === undefined) throw new Error('Missing request');
  original.bytes = 40;
  expect(result?.requests[0]?.bytes).toBe(0);
});

test('a short observation remains partial and excludes work beyond its actual end', () => {
  expect(postControlWindow(1000, 1500, 4000, [task(1400, 300), task(1600, 100)], [request(1499), request(1500)], true))
    .toMatchObject({end: 1500, observedMs: 500, complete: false, longTaskMs: 100,
      longTasks: [task(1400, 300)], requests: [request(1499)]});
  expect(postControlWindow(1000, 999, 4000, [], [], true))
    .toMatchObject({observedMs: 0, complete: false, longTaskMs: 0});
});

test('missing control has no background verdict and invalid windows refuse', () => {
  expect(postControlWindow(null, 5000, 4000, [], [], true)).toBeNull();
  expect(() => postControlWindow(1, 2, -1, [], [], true)).toThrow('Invalid post-control window');
  expect(() => postControlWindow(1, Number.NaN, 4000, [], [], true)).toThrow('Invalid post-control window');
});

test('an engine without the Long Tasks API has no zero-work pass', () => {
  expect(postControlWindow(1000, 5000, 4000, [], [request(1400)], false))
    .toMatchObject({complete: true, longTaskMs: null, requests: [request(1400)]});
});
