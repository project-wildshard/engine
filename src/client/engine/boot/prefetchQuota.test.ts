import { expect, it } from 'vitest';
import { PrefetchQuota, PrefetchBytes } from './prefetchQuota';

it('requests persistence first and prevents concurrent writes oversubscribing a stale quota', async () => {
  const events: string[] = [];
  const quota = await PrefetchQuota.open({ persist: () => { events.push('persist'); return Promise.resolve(false); },
    estimate: () => { events.push('estimate'); return Promise.resolve({ usage: 100, quota: 220 }); } }, 20);
  expect(events).toEqual(['persist', 'estimate']);
  expect(quota?.persistent).toBe(false);
  if (quota === null) throw new Error('Missing quota');
  const reservations = await Promise.all([quota.reserve(60), quota.reserve(60)]);
  expect(reservations.filter(row => row !== null)).toHaveLength(1);
  const reserved = reservations.find(row => row !== null);
  if (reserved === undefined) throw new Error('Missing reservation');
  reserved.finish(60); reserved.finish(60);
  expect(await quota.reserve(41)).toBeNull(); // the storage estimate deliberately has not caught up
  expect(await quota.reserve(40)).not.toBeNull();
});

it('releases failed/cache-hit reservations and stops quietly when storage elsewhere consumes the headroom', async () => {
  let usage = 100;
  const quota = await PrefetchQuota.open({ persist: () => Promise.resolve(true), estimate: () => Promise.resolve({ usage, quota: 220 }) }, 20);
  if (quota === null) throw new Error('Missing quota');
  const claim = await quota.reserve(90);
  if (claim === null) throw new Error('Missing reservation');
  claim.finish(0);
  usage = 190;
  expect(await quota.reserve(11)).toBeNull();
  expect(await quota.reserve(10)).not.toBeNull();
});

it('declines unknown/unavailable estimates without evicting anything or throwing', async () => {
  expect(await PrefetchQuota.open({ persist: () => Promise.resolve(false), estimate: () => Promise.resolve({}) }, 20)).toBeNull();
  expect(await PrefetchQuota.open({ persist: () => Promise.reject(new Error('Denied')),
    estimate: () => Promise.reject(new Error('Unavailable')) }, 20)).toBeNull();
});

it('holds payload bytes through storage, wakes FIFO and releases each claim only once', async () => {
  const memory = new PrefetchBytes(10), release = await memory.reserve(7);
  const admitted: number[] = [];
  const second = memory.reserve(6).then(done => { admitted.push(6); return done; });
  const third = memory.reserve(3).then(done => { admitted.push(3); return done; });
  await Promise.resolve();
  expect(admitted).toEqual([]); // The smaller body cannot jump a blocked earlier body.
  expect(memory.usedBytes).toBe(7);
  release(); release();
  const [releaseSecond, releaseThird] = await Promise.all([second, third]);
  expect(admitted).toEqual([6, 3]);
  expect(memory.usedBytes).toBe(9); expect(memory.peakBytes).toBe(9);
  releaseSecond(); expect(memory.usedBytes).toBe(3);
  releaseThird(); expect(memory.usedBytes).toBe(0);
});

it('refuses invalid or oversized payloads before queueing and admits zero-byte bodies', async () => {
  expect(() => new PrefetchBytes(0)).toThrow('limit');
  const memory = new PrefetchBytes(10);
  for (const bytes of [-1, 11, 0.5, Infinity, Number.NaN]) expect(() => memory.reserve(bytes)).toThrow('size');
  const release = await memory.reserve(0); release();
  expect(memory.usedBytes).toBe(0); expect(memory.peakBytes).toBe(0);
});
