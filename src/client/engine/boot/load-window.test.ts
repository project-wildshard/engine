import {expect, test} from 'vitest';
import {LoadWindow, type LoadLease} from './loadWindow';

const MB = 1024 * 1024;
const turn = (): Promise<void> => new Promise(resolve => {setTimeout(resolve, 0);});

test('the window admits parts while they fit, queues the rest in order and counts its peak', async () => {
  const window = new LoadWindow(() => 10 * MB), granted: number[] = [];
  const a = await window.admit(6 * MB);
  const b = window.admit(6 * MB).then((lease: LoadLease) => {granted.push(1); return lease;});
  const c = window.admit(MB).then((lease: LoadLease) => {granted.push(2); return lease;});
  await turn();
  expect(granted).toEqual([]); // FIFO: the small part does not pass the waiting head
  a.release();
  const [leaseB, leaseC] = await Promise.all([b, c]);
  expect(granted).toEqual([1, 2]);
  expect(window.stats()).toMatchObject({bytes: 7 * MB, peak: 7 * MB, admitted: 3, waited: 2, past: 0});
  leaseB.release(); leaseC.release(); leaseC.release();
  expect(window.stats().bytes).toBe(0);
});

test('a part of unknown size waits for room and is charged when its bytes arrive', async () => {
  const window = new LoadWindow(() => 10 * MB);
  const first = await window.admit(0); first.charge(10 * MB);
  let second = false; const pending = window.admit(0).then((lease: LoadLease) => {second = true; return lease;});
  await turn(); expect(second).toBe(false);
  first.release(); (await pending).charge(3 * MB);
  expect(window.stats()).toMatchObject({bytes: 3 * MB, peak: 10 * MB});
});

test('a pipeline with nothing in flight always progresses, and a compile admits only those', async () => {
  const window = new LoadWindow(() => 10 * MB);
  const held = await window.admit(10 * MB);
  // another pipeline, alone: admitted past the full window (its consumer may be what frees the window)
  const alone = await window.admit(4 * MB, () => true);
  expect(window.stats()).toMatchObject({bytes: 14 * MB, past: 1});
  alone.release(); held.release();
  const end = window.compiling();
  let burst = false; const waiting = window.admit(MB).then((lease: LoadLease) => {burst = true; return lease;});
  const single = await window.admit(MB, () => true);
  await turn(); expect(burst).toBe(false); expect(window.stats().compiling).toBe(true);
  end(); end();
  (await waiting).release(); single.release();
  expect(burst).toBe(true); expect(window.stats()).toMatchObject({bytes: 0, compiling: false});
});
