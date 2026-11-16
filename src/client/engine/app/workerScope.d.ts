/** Lightweight lifetime owner shared by a service worker and cache cleanup. */
export class WorkerScope {
  cleanups: Set<() => void>;
  listen(target: EventTarget, type: string, listener: EventListener): void;
  timeout(ms: number, action: () => void): ReturnType<typeof setTimeout>;
  dispose(): void;
}
export const workerScope: WorkerScope;
