import { expect, test } from 'vitest';
import { armBackGuard, type BackGuardPorts } from './backGuard';

/** A same-document history: a stack of states, `back` answers with a popstate on the next tick, as browsers do. */
function fakeHistory(start: unknown = null) {
  const entries: unknown[] = [start];
  let at = 0;
  const handlers = new Set<() => void>();
  const timers: (() => void)[] = [];
  const ports: BackGuardPorts = {
    history: {
      get state() { return entries[at]; },
      pushState: (state: unknown) => { entries.splice(at + 1); entries.push(state); at++; },
      replaceState: (state: unknown) => { entries[at] = state; },
      back: () => { if (at === 0) return; at--; queueMicrotask(() => { for (const handler of handlers) handler(); }); },
    },
    url: () => 'https://play.wildshard.io/?chunk=driftwood-isle',
    listen: (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    later: (go) => { timers.push(go); },
  };
  /** the browser's back gesture: a step back and its popstate */
  const swipeBack = async (): Promise<void> => { ports.history.back(); await Promise.resolve(); await Promise.resolve(); };
  return { ports, entries, depth: () => at, listeners: () => handlers.size, timers, swipeBack };
}

test('a back in play stays in play, again and again', async () => {
  const h = fakeHistory({ page: 1 });
  const guard = armBackGuard(h.ports);
  expect(h.depth()).toBe(1);
  for (let i = 1; i <= 3; i++) {
    await h.swipeBack();
    expect(h.depth()).toBe(1); // pushed again: still one entry above the play entry
    expect(guard.turned).toBe(i);
  }
  // the play entry's own state is kept under the guard mark
  expect(h.entries[1]).toMatchObject({ page: 1, wsBackGuard: true });
});

test('release steps off the guard entry, so a replace replaces the play entry', async () => {
  const h = fakeHistory();
  const guard = armBackGuard(h.ports);
  await guard.release();
  expect(guard.armed).toBe(false);
  expect(h.depth()).toBe(0);
  expect(h.listeners()).toBe(0);
  // after release a back is the browser's own: nothing pushes again
  h.ports.history.pushState({ other: true }, '', '');
  await h.swipeBack();
  expect(h.depth()).toBe(0);
});

test('release resolves by the fallback when the browser never answers', async () => {
  const h = fakeHistory();
  h.ports.history.back = () => { /* a browser that drops it */ };
  const guard = armBackGuard(h.ports);
  const released = guard.release();
  expect(h.timers).toHaveLength(1);
  h.timers[0]?.();
  await released;
  expect(h.listeners()).toBe(0);
});

test('a second release is a no-op', async () => {
  const h = fakeHistory();
  const guard = armBackGuard(h.ports);
  await guard.release();
  await guard.release();
  expect(h.depth()).toBe(0);
});

test('after a reload on the guard entry, a back off the new guard still stays', async () => {
  const h = fakeHistory({ wsBackGuard: true }); // a reloaded page keeps the old guard's state
  const guard = armBackGuard(h.ports);
  await h.swipeBack();
  expect(h.depth()).toBe(1);
  expect(guard.turned).toBe(1);
  expect(h.entries[0]).toEqual({}); // the reloaded entry is this page's play entry again
  await guard.release();
  expect(h.depth()).toBe(0); // so Exit's replace takes the play entry, not an old guard
});
