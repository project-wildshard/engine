import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { waitEntryWork } from './entryReadiness';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual entry continuation with deterministic native ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase types without copying a production implementation.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the original readiness loop without a renderer or GPU.
import { runInNewContext } from 'node:vm';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function deferred(): { promise: Promise<void>; finish: () => void } {
  let finish = (): void => { throw new Error('Missing resolver'); };
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, finish };
}

test('elapsed time never replaces unfinished entry work', async () => {
  vi.useFakeTimers();
  const owner = new Scope('long-entry'), source = deferred();
  let ready = false, current = (): boolean => false;
  const work = waitEntryWork(owner, live => { current = live; return source.promise; }).then(result => { ready = true; return result; });
  try {
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(ready).toBe(false); expect(current()).toBe(true); expect(vi.getTimerCount()).toBe(0);
    source.finish(); await work;
    expect(ready).toBe(true); expect(current()).toBe(false);
  } finally { source.finish(); owner.dispose(); }
});

test('retiring an owner cancels a pending entry and fences its late completion', async () => {
  const owner = new Scope('retired-entry'), source = deferred();
  let current = (): boolean => false;
  const work = waitEntryWork(owner, live => { current = live; return source.promise; });
  const refused = expect(work).rejects.toMatchObject({name: 'AbortError'});
  owner.dispose(); await refused;
  expect(current()).toBe(false); source.finish(); await source.promise;
});

test('a retired entry starts no work and original preparation failures propagate', async () => {
  const owner = new Scope('closed-entry'), start = vi.fn(() => Promise.resolve());
  owner.dispose(); await expect(waitEntryWork(owner, start)).rejects.toMatchObject({name: 'AbortError'});
  expect(start).not.toHaveBeenCalled();
  const live = new Scope('failed-entry'), error = new Error('Original preparation failure');
  try { await expect(waitEntryWork(live, () => { throw error; })).rejects.toBe(error); }
  finally { live.dispose(); }
});

test('the actual spawn continuation waits for linking and three offscreen draws', async () => {
  const source = readFileSync(new URL('settlePrograms.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const QUIET_DRAWS');
  if (start === -1) throw new Error('Missing spawn settle continuation');
  const owner = new Scope('spawn-programs'), compiled = deferred(), frames: FrameRequestCallback[] = [];
  let now = 0, draws = 0, ready = false;
  const mark = vi.fn();
  let posted = deferred();
  vi.spyOn(owner, 'raf').mockImplementation(frame => { frames.push(frame); posted.finish(); return 0; });
  const game = {levelScope: owner, offscreenDraw: () => { draws++; }};
  const run: unknown = runInNewContext(`${stripTypeScriptTypes(source.slice(start)).replace('export async function', 'async function')}\nsettleEntryPrograms`, {
    waitEntryWork, diagnosticNow: () => now, performance: {mark}, liveWarmPacing: () => ({}),
    precompileLevel: (_game: unknown, _progress: unknown, options: {drawnOnly: boolean; warmPost: boolean; current: () => boolean}): Promise<void> => {
      expect(options.drawnOnly).toBe(true); expect(options.warmPost).toBe(true); expect(options.current()).toBe(true);
      return compiled.promise;
    },
  });
  if (typeof run !== 'function') throw new Error('Missing spawn settle function');
  const invoked: unknown = Reflect.apply(run, undefined, [game]);
  const work: Promise<unknown> = Promise.resolve(invoked).then(result => { ready = true; return result; });
  try {
    now = 100_000; await Promise.resolve();
    expect(ready).toBe(false); expect(draws).toBe(0);
    compiled.finish(); await compiled.promise;
    for (let turn = 0; turn < 3; turn++) {
      await posted.promise;
      const frame = frames.shift(); if (frame === undefined) throw new Error('Missing settle draw');
      posted = deferred(); frame(now); await Promise.resolve();
      if (turn < 2) expect(ready).toBe(false);
    }
    await expect(work).resolves.toMatchObject({ms: 100_000, draws: 3, stalled: null});
    expect(draws).toBe(3); expect(frames).toHaveLength(0); expect(mark).toHaveBeenCalledOnce();
  } finally { compiled.finish(); owner.dispose(); await work.catch(() => undefined); }
});
