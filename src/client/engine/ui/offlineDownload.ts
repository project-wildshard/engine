/**
 * G727 / iPhone downloads I9: Settings' "Download everything" for offline play. The engine knows no products: the game
 * installs this port at page start (src/client/app/entry.ts) and the save panel (SavePanel.ts) offers it, its size first.
 */
import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';

/** How a whole download ended: everything stored, the device ran out of space, or it stopped (offline, a newer deploy). */
export type OfflineDownloadEnd = 'done' | 'quota' | 'stopped' | 'error';

export interface OfflineDownload {
  /** The wire bytes still to download (null: unknown). Stop admission when the visible row owner retires. */
  readonly size: (owner: Scope) => Promise<number | null>;
  /** download all of it; `progress(done, total)` in wire bytes as it goes; resolves when it ends. `owner` paces it. */
  readonly start: (owner: Scope, progress: (done: number, total: number) => void) => Promise<OfflineDownloadEnd>;
}

let installed: OfflineDownload | null = null;
/** The game's port (one a page); the save panel shows nothing without it. */
export function installOfflineDownload(port: OfflineDownload): void { installed = port; }
/** The installed port, or null. */
export function offlineDownload(): OfflineDownload | null { return installed; }

const megabytes = (bytes: number): string => Math.max(1, Math.round(bytes / 1e6)).toString();
/** G727 / I9: "Download everything" for offline play, its size first, then its progress; again resumes a stopped one */
function offlineRow(scope: Scope, port: OfflineDownload): HTMLElement & { refresh: () => void } {
  const box = document.createElement('div');
  const label = document.createElement('div'); label.className = 'ws-gmenu-label'; label.textContent = engineString('s_offline_title');
  const note = document.createElement('div'); note.className = 'ws-gmenu-note'; note.textContent = engineString('s_offline_note');
  const status = document.createElement('div'); status.className = 'ws-gmenu-note'; status.setAttribute('role', 'status');
  let busy = false, visible = false, intersecting = false, sizing: Scope | undefined;
  const go = document.createElement('button'); go.type = 'button'; go.className = 'ws-gmenu-btn';
  go.disabled = true; go.textContent = engineString('s_offline_sizing');
  const cancelSize = (): void => { const pending = sizing; sizing = undefined; pending?.dispose(); };
  const size = (): void => {
    if (!visible || busy || sizing !== undefined || scope.disposed || scope.disposing) return;
    const pending = scope.child('offline-size'); sizing = pending;
    go.disabled = true; go.textContent = engineString('s_offline_sizing');
    void Promise.resolve().then(() => {
      if (pending.disposed || pending.disposing) throw new DOMException('Offline estimate left view', 'AbortError');
      return port.size(pending);
    }).then((bytes) => {
      if (busy || pending.disposed || sizing !== pending) return undefined;
      go.textContent = bytes === 0 ? engineString('s_offline_ready') : bytes === null ? engineString('s_offline_unknown') : engineString('s_offline_download', [megabytes(bytes)]);
      go.disabled = bytes === 0; return undefined;
    }).catch(() => {
      if (!busy && !pending.disposed && sizing === pending) { go.textContent = engineString('s_offline_unknown'); go.disabled = false; }
    }).finally(() => { if (sizing === pending) sizing = undefined; pending.dispose(); });
  };
  // A hidden Settings/save panel must not admit every product just to label
  // a button. Its estimate yields ownership as soon as the row leaves view.
  const syncVisibility = (): void => {
    visible = intersecting && box.closest('[inert], [hidden]') === null;
    if (visible) size(); else cancelSize();
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.target === box) {
      intersecting = entry.isIntersecting; syncVisibility();
    }
  });
  // Menu shells fade out without leaving the viewport. Inert retirement must
  // cancel their work even when their intersection rectangle never changes.
  const menus = new MutationObserver(syncVisibility);
  menus.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'hidden'] });
  observer.observe(box);
  scope.onDispose(() => { observer.disconnect(); menus.disconnect(); cancelSize(); });
  scope.listen(go, 'click', () => {
    if (busy) return;
    busy = true; go.disabled = true;
    void port.start(scope, (done, total) => { status.textContent = engineString('s_offline_progress', [megabytes(done), megabytes(total)]); })
      .then((end) => { status.textContent = end === 'done' ? engineString('s_offline_done') : engineString('s_offline_stopped'); return undefined; })
      .catch(() => { status.textContent = engineString('s_offline_stopped'); })
      .finally(() => { busy = false; size(); });
  });
  box.append(label, note, go, status);
  return Object.assign(box, { refresh: (): void => { if (!busy) size(); } });
}

/** The "Offline play" row over the installed port (null without one): the pause menu's save panel and the title's boot
 *  settings both show it; `refresh` re-reads the size (an open of the panel). */
export function buildOfflineRow(scope: Scope): (HTMLElement & { refresh: () => void }) | null {
  return installed === null ? null : offlineRow(scope, installed);
}
