import type { Scope } from '../../../shared/engine/app/scope';

/** Keep entry preparation bound to its owner, never to elapsed time.
 * Completion requires the actual content, links and first draws. Retirement
 * rejects the waiter immediately and fences work at its next existing check.
 * The running promise stays observed after retirement, preserving its cleanup. */
export async function boundEntryWarmup<T>(owner: Scope,
  work: (current: () => boolean) => Promise<T>): Promise<T> {
  const current = (): boolean => !owner.disposed && !owner.disposing;
  if (!current()) throw new Error('Shader warm-up owner left');
  const watch = owner.child('entry-preparation');
  const retired = new Promise<never>((_resolve, reject) => {
    watch.onDispose(() => { reject(new Error('Shader warm-up owner left')); });
  });
  // Observe a synchronous preparation error before retiring the wait scope.
  const running = new Promise<T>(resolve => { resolve(work(current)); });
  try { return await Promise.race([running, retired]); }
  finally { watch.dispose(); }
}
