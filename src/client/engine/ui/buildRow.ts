import type { Scope } from '../../../shared/engine/app/scope';
import { engineString } from '../../../shared/engine/strings';
import { listenTap } from '../input/dom';
import { applyLiveBuild, liveBuild, liveBuildOf, runningBuild, shortBuild, workerControlled } from './buildCheck';
import { reloadForPlayer } from './playerReload';

/**
 * R9 (RELOAD-BUTTON-PLAN, J208): Settings ▸ Build, in the title's Settings and the pause menu's, beside the Connection
 * doctor (J207). One compact row (Jake on space, 2026-11-09: "takes too much space"): the running build, CHECK (reads
 * `/version.json`) and RELOAD, the same reload as the build pill (src/client/engine/ui/playerReload.ts: a loading button
 * and the full-page RELOADING cover in the tap's own turn, no confirm, a navigation guaranteed within 3 s).
 * Both buttons are 44 px tall: iOS home-screen web apps lose taps on small targets.
 *
 *   panel.append(buildBuildRow(scope))
 */
export function buildBuildRow(owner: Scope): HTMLElement {
  const box = document.createElement('div'); box.className = 'ws-gmenu-build';
  const label = document.createElement('div'); label.className = 'ws-gmenu-label'; label.textContent = engineString('s_build_title');
  const row = document.createElement('div'); row.className = 'ws-gmenu-row ws-gmenu-buildrow';
  const info = document.createElement('div'); info.className = 'ws-gmenu-buildinfo';
  const id = document.createElement('span'); id.className = 'ws-gmenu-buildid'; id.textContent = shortBuild(runningBuild()); id.title = runningBuild();
  const status = document.createElement('span'); status.className = 'ws-gmenu-buildstatus'; status.setAttribute('role', 'status');
  info.append(id, status);
  const button = (cls: string, text: string): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.className = `ws-gmenu-buildbtn ${cls}`; b.textContent = text; return b;
  };
  const check = button('ws-gmenu-buildcheck', engineString('s_build_check'));
  const reload = button('ws-gmenu-buildreload', engineString('s_build_reload'));
  row.append(info, check, reload);
  box.append(label, row);

  /** what the server has live, once known; whether the worker already holds it (a reload then lands on it) */
  let newer: string | null = null, ready = (window.__ws_sw?.waiting ?? null) !== null;
  const say = (text: string, lit = false): void => { status.textContent = text; row.classList.toggle('newer', lit); reload.classList.toggle('primary', lit); };
  const paint = (): void => {
    if (newer === null) { if (ready) say(engineString('s_update_next_boundary'), true); else say(engineString('s_build_running')); return; }
    // a worker controls the page: until it has installed the build, a reload still lands on this one
    say(engineString(ready || !workerControlled() ? 's_build_newer' : 's_build_fetching', [shortBuild(newer)]), true);
  };
  paint();

  owner.listen(window, 'ws-live-build', event => {
    const live = liveBuildOf(event);
    if (live === null) return;
    newer = live === runningBuild() ? null : live;
    if (newer === null) { ready = false; say(engineString('s_build_current')); } else paint();
  });
  owner.listen(window, 'ws-sw-waiting', event => {
    if (!(event instanceof CustomEvent)) return;
    const value: unknown = event.detail;
    if (typeof value !== 'object' || value === null || !('waiting' in value)) return;
    ready = value.waiting !== null;
    if (ready && 'build' in value && typeof value.build === 'string') newer ??= value.build;
    paint();
  });

  let checking = 0;
  listenTap(owner, check, () => {
    const started = ++checking;
    check.disabled = true; say(engineString('s_build_checking'));
    void liveBuild().then(live => {
      if (started !== checking) return undefined;
      check.disabled = false;
      if (live === null) say(engineString(navigator.onLine ? 's_build_failed' : 's_build_offline'));
      else applyLiveBuild(live); // the row, the pill and the worker all answer it
      return undefined;
    });
  });
  listenTap(owner, reload, () => { reloadForPlayer(reload, { newer: newer !== null || ready, why: ['settings build: reload at title', 'settings build: reload'] }); });
  return box;
}
