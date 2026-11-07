// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { holdLeaving } from '../src/client/engine/boot/lastEnd';
import { exitSessionToTitle } from '../src/client/game/session/exitToTitle';

test('main-menu exit replaces the document synchronously without touching the old world or worker', () => {
  const replace = vi.fn<(url: string) => void>();
  const forbidden = (): never => {throw new Error('The old world and worker are not exit work');};
  const navigation = {url: 'https://wildshard.io/?chunk=driftwood-isle&glreload=1&explore=hub#ws-shardfile', replace,
    get dispose(): never {return forbidden();}, get activate(): never {return forbidden();}};
  exitSessionToTitle(navigation);
  expect(replace).toHaveBeenCalledExactlyOnceWith('https://wildshard.io/');
});

test.each(['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'far-reach', 'sunscar-dunes', '_template'])(
  '%s exits to the actual root title without a stale shard, mode or fragment', slug => {
    const replace = vi.fn<(url: string) => void>();
    exitSessionToTitle({url: `https://wildshard.io/play?chunk=${slug}&explore=hub#ws-shardfile`, replace});
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://wildshard.io/');
  });

test('a navigation failure preserves its original error instead of pretending the old session was disposed', () => {
  const failure = new Error('Navigation unavailable');
  expect(() => exitSessionToTitle({url: 'https://wildshard.io/?chunk=nine-dragon-stack-legacy', replace: () => {throw failure;}})).toThrow(failure);
});

// N3: a held session's server saves across a port, and nothing written at pagehide reaches a page that's going.
test('leaving waits for a held session\'s save, once, and a stalled server can\'t hold it', async () => {
  vi.useFakeTimers();
  const replace = vi.fn<(url: string) => void>(), asked: string[] = [];
  let landed = (): void => undefined;
  try {
    const release = holdLeaving(() => { asked.push('save'); return new Promise<void>(resolve => { landed = resolve; }); });
    exitSessionToTitle({url: 'https://wildshard.io/?chunk=pine-hollow', replace}); exitSessionToTitle({url: 'https://wildshard.io/?chunk=pine-hollow', replace});
    expect(asked).toEqual(['save']); expect(replace, 'the second tap had nothing held to wait for').toHaveBeenCalledTimes(1);
    replace.mockClear(); landed(); await vi.advanceTimersByTimeAsync(0);
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://wildshard.io/');
    release(); replace.mockClear();

    holdLeaving(() => new Promise<void>(() => { /* a server that never answers */ }));
    exitSessionToTitle({url: 'https://wildshard.io/', replace}); await vi.advanceTimersByTimeAsync(3999);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(replace).toHaveBeenCalledOnce();

    const stopped = holdLeaving(() => { throw new Error('Settings stopped this server: leaving must not save it'); });
    stopped(); replace.mockClear(); exitSessionToTitle({url: 'https://wildshard.io/', replace}); expect(replace).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
