import type { Scope } from '../../../shared/engine/app/scope';
import type { AnalyticsBatch, FailureClear } from './model';
import { FailureEpisodes, type FailureOutbox } from './failureEpisodes';

interface VisibleRoot {
  readonly root: HTMLElement;
  readonly scope: Scope;
  code: string;
  wanted: boolean;
  frame: number | null;
}
/** Explicit page service. Presenters report state changes; observation waits until the actual root renders. */
export class FailureTelemetry {
  private readonly roots = new Map<HTMLElement, VisibleRoot>();
  private readonly episodes: FailureEpisodes;
  private readonly outbox: FailureOutbox;
  private readonly deliver: (batch: AnalyticsBatch) => Promise<boolean>;
  private readonly level: () => string;
  private suspended = false;
  private stopped = false;
  constructor(scope: Scope, outbox: FailureOutbox, build: string, install: string,
    level: () => string, deliver: (batch: AnalyticsBatch) => Promise<boolean>) {
    this.outbox = outbox; this.deliver = deliver; this.level = level;
    this.episodes = new FailureEpisodes(outcome => { outbox.add(build, install, outcome); this.flush(); });
    scope.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.episodes.clearAll('hidden');
      else this.refresh();
    });
    scope.listen(window, 'pagehide', () => { this.suspended = true; this.episodes.clearAll('pagehide'); this.flush(); });
    scope.listen(window, 'pageshow', () => { this.suspended = false; this.refresh(); this.flush(); });
    scope.listen(window, 'online', () => { this.flush(); });
    scope.interval(30_000, () => { this.flush(); });
    scope.onDispose(() => {
      this.stopped = true;
      for (const state of this.roots.values()) { state.wanted = false; this.cancel(state); }
      this.episodes.clearAll('disposed'); this.roots.clear();
    });
    this.flush();
  }
  flush(): void { void this.outbox.flush(this.deliver); }
  /** Alias ids describe one root; the first catalogue id is its stable primary code. */
  show(scope: Scope, root: HTMLElement, ids: string): void {
    if (this.stopped) return;
    const code = ids.trim().split(/\s+/u)[0];
    if (code === undefined || code === '') return;
    let state = this.roots.get(root);
    if (state !== undefined && state.scope !== scope) { this.cancel(state); state = undefined; }
    if (state === undefined) {
      state = { root, scope, code, wanted: true, frame: null };
      this.roots.set(root, state);
      const owned = state;
      scope.onDispose(() => {
        this.cancel(owned);
        if (this.roots.get(root) === owned) { this.episodes.clear(root, 'disposed'); this.roots.delete(root); }
      });
    }
    state.wanted = true; state.code = code; this.measure(state);
  }
  clear(root: HTMLElement, cause: FailureClear, owner?: Scope): void {
    const state = this.roots.get(root);
    if (owner !== undefined && state !== undefined && state.scope !== owner) return;
    if (state !== undefined) { state.wanted = false; this.cancel(state); }
    this.episodes.clear(root, cause);
  }
  private cancel(state: VisibleRoot): void {
    if (state.frame !== null) state.scope.cancelRaf(state.frame);
    state.frame = null;
  }
  private refresh(): void { for (const state of this.roots.values()) if (state.wanted) this.measure(state); }
  private measure(state: VisibleRoot): void {
    this.cancel(state);
    if (!state.wanted || state.scope.disposed || this.stopped || this.suspended || document.visibilityState === 'hidden') return;
    state.frame = state.scope.raf(() => {
      state.frame = null;
      if (!state.wanted || this.suspended || document.visibilityState === 'hidden') return;
      const style = getComputedStyle(state.root);
      if (state.root.hidden !== false || style.display === 'none' || style.visibility === 'hidden') return;
      if (state.root.isConnected && state.root.getClientRects().length > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0) {
        this.episodes.show(state.root, state.code, this.level());
      } else this.measure(state);
    });
  }
}
