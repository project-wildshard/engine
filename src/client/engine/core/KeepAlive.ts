/** Screen wake lock while playing: the display never dims mid-hunt. */
import { app } from '../app/runtime';
import type { Scope } from '../../../shared/engine/app/scope';

export class KeepAlive {
  wakeLock: 'ok' | 'failed' | 'unsupported' | 'off' = 'off';
  private readonly scope: Scope;
  private listening = false;
  constructor(parent: Scope = app.engineScope) { this.scope = parent.child('keep-alive'); }

  /** call from a user gesture (ENTER WORLD) — both APIs need one */
  async start(): Promise<void> {
    if (!('wakeLock' in navigator)) this.wakeLock = 'unsupported';
    else {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (this.scope.disposed) { await l.release(); return; }
        this.wakeLock = 'ok';
        const lock = this.scope.child('lock');
        lock.listen(l, 'release', () => { this.wakeLock = 'off'; lock.dispose(); }, { once: true });
        lock.onDispose(() => { if (!l.released) void l.release().catch(() => { this.wakeLock = 'failed'; }); });
      } catch { this.wakeLock = 'failed'; }
    }
    if (!this.listening && !this.scope.disposed) {
      this.listening = true;
      this.scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible' && this.wakeLock !== 'unsupported') void this.start(); }); // locks are released on hide
    }
  }

  describe(): string { return `wakeLock ${this.wakeLock}`; }
  dispose(): void { this.scope.dispose(); }
}
