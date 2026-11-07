/** Resource owner for the service worker's lifetime (no DOM or page runtime). */
export class WorkerScope {
  cleanups = new Set();
  listen(target, type, fn) {
    target.addEventListener(type, fn);
    this.cleanups.add(() => { target.removeEventListener(type, fn); });
  }
  timeout(ms, fn) {
    let cancel = () => undefined;
    const id = setTimeout(() => { this.cleanups.delete(cancel); fn(); }, ms);
    cancel = () => { clearTimeout(id); this.cleanups.delete(cancel); };
    this.cleanups.add(cancel);
    return id;
  }
  dispose() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }
}
export const workerScope = new WorkerScope();
