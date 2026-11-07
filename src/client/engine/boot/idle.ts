import type { Scope } from '../../../shared/engine/app/scope';
import { whenControl } from './prefetch';

/** A native idle queue, supplied explicitly by non-browser hosts and tests. */
export interface IdleQueue { request: (run: () => void) => number; cancel: (id: number) => void }

function browserIdle(): IdleQueue | null {
  if (typeof globalThis.requestIdleCallback !== 'function') return null;
  return {
    // Match the existing speculative downloader's idle starvation bound.
    request: run => globalThis.requestIdleCallback(() => { run(); }, { timeout: 2000 }),
    cancel: id => { globalThis.cancelIdleCallback(id); },
  };
}

/** One owned idle opportunity. The existing downloader's 50 ms fallback is
 * used where native idle callbacks are absent. Retirement settles false and
 * cancels the queued callback; no caller can publish from a late delivery. */
export function idleTurn(owner: Scope, queue: IdleQueue | null = browserIdle()): Promise<boolean> {
  if (owner.disposed || owner.disposing) return Promise.resolve(false);
  const turn = owner.child('background.idle');
  return new Promise(resolve => {
    let settled = false;
    turn.onDispose(() => { if (!settled) { settled = true; resolve(false); } });
    const finish = (): void => {
      if (settled || owner.disposed || owner.disposing) return;
      settled = true; turn.dispose(); resolve(true);
    };
    if (queue === null) turn.timeout(50, finish);
    else {
      const id = queue.request(() => { if (!turn.disposed && !turn.disposing) turn.run(finish); });
      turn.onDispose(() => { queue.cancel(id); });
    }
  });
}

/** Speculation starts after actual control, then an idle opportunity. Mandatory
 * control refinements still run synchronously through reachControl. */
export function controlIdle(owner: Scope, queue: IdleQueue | null = browserIdle()): Promise<boolean> {
  if (owner.disposed || owner.disposing) return Promise.resolve(false);
  const waiting = owner.child('background.control');
  return new Promise(resolve => {
    let settled = false;
    waiting.onDispose(() => { if (!settled) { settled = true; resolve(false); } });
    const ready = async (): Promise<void> => {
      const live = await idleTurn(waiting, queue);
      if (settled) return;
      settled = true; waiting.dispose(); resolve(live);
    };
    whenControl(owner, waiting, () => { void ready(); });
  });
}
