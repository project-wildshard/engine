import type { Scope } from '@wildshard/engine/app/scope';

/** Entry work finishes on its real result or its owner's retirement, never elapsed time. */
export async function waitEntryWork<T>(owner: Scope, work: (current: () => boolean) => Promise<T>): Promise<T> {
  const stopped = (): DOMException => new DOMException('Entry preparation owner left', 'AbortError');
  if (owner.disposed || owner.disposing) throw stopped();
  const scope = owner.child('entry-readiness');
  const current = (): boolean => !scope.disposed && !scope.disposing;
  const retired = new Promise<never>((_resolve, reject) => { scope.onDispose(() => { reject(stopped()); }); });
  const running = new Promise<T>(resolve => { resolve(work(current)); });
  try { return await Promise.race([running, retired]); }
  finally { scope.dispose(); }
}
