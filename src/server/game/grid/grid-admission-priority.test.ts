import { expect, test } from 'vitest';
import { GridAdmissionPriority } from '../../../client/game/grid/admissionPriority';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let finish: (value: T) => void = () => { throw new Error('Deferred resolver was not installed'); };
  const promise = new Promise<T>(resolve => { finish = resolve; });
  return { promise, resolve: finish };
}

test('world reads pass waiting speculation without cancelling its in-flight read', async () => {
  const priority = new GridAdmissionPriority(), starts: string[] = [];
  const held = deferred<undefined>();
  const inflight = priority.read('background', () => { starts.push('inflight'); return held.promise; });
  const release = priority.hold('target');
  const background = priority.read('background', () => { starts.push('background'); return Promise.resolve(); });
  const other = priority.read('other', () => { starts.push('other'); return Promise.resolve(); });
  await priority.read('target', () => { starts.push('target'); return Promise.resolve(); });
  expect(starts).toEqual(['inflight', 'target']);
  held.resolve(undefined); await inflight;
  expect(starts).toEqual(['inflight', 'target']);
  release(); await Promise.all([background, other]);
  expect(starts).toEqual(['inflight', 'target', 'background', 'other']);
});

test('promoting an already queued product wakes its existing reader', async () => {
  const priority = new GridAdmissionPriority(), starts: string[] = [];
  const first = priority.hold('first');
  const target = priority.read('target', () => { starts.push('target'); return Promise.resolve(); });
  const background = priority.read('background', () => { starts.push('background'); return Promise.resolve(); });
  const second = priority.hold('target');
  await target; expect(starts).toEqual(['target']);
  second(); expect(starts).toEqual(['target']);
  first(); await background;
  expect(starts).toEqual(['target', 'background']);
});

test('older serialized world construction can drain while a newer target has priority', async () => {
  const priority = new GridAdmissionPriority();
  const older = priority.hold('older'), newer = priority.hold('newer');
  expect(await priority.read('older', () => Promise.resolve('old world'))).toBe('old world');
  expect(await priority.read('newer', () => Promise.resolve('new world'))).toBe('new world');
  older(); newer();
});

test('shared product holds retain priority until the last idempotent release', async () => {
  const priority = new GridAdmissionPriority();
  const first = priority.hold('target'), second = priority.hold('target');
  let started = false;
  const background = priority.read('background', () => { started = true; return Promise.resolve(); });
  first(); first();
  await priority.read('target', () => Promise.resolve());
  expect(started).toBe(false);
  second(); await background; expect(started).toBe(true);
});

test('a new hold rechecks background readers released in the previous turn', async () => {
  const priority = new GridAdmissionPriority();
  const first = priority.hold('first');
  let started = false;
  const background = priority.read('background', () => { started = true; return Promise.resolve(); });
  first(); const second = priority.hold('second');
  await priority.read('second', () => Promise.resolve());
  expect(started).toBe(false);
  second(); await background; expect(started).toBe(true);
});

test('disposing rejects unstarted reads while an in-flight read keeps its owner', async () => {
  const priority = new GridAdmissionPriority(), held = deferred<string>();
  const inflight = priority.read('background', () => held.promise);
  const release = priority.hold('target');
  const queued = priority.read('background', () => Promise.resolve('must not start'));
  const rejected = expect(queued).rejects.toThrow('disposed');
  priority.dispose(); release();
  await rejected;
  await expect(priority.read('target', () => Promise.resolve('closed'))).rejects.toThrow('disposed');
  held.resolve('owned'); expect(await inflight).toBe('owned');
});
