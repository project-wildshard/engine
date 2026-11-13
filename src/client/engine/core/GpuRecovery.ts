import { precompileLevel } from '../render/precompile';
import { saveStorage } from '../saves/slots';
import { terrainDatum } from '../../../shared/engine/world/terrainHeight';
/**
 * GPU recovery (E54) and the app-switch resume (E61): what the game does when the phone takes its graphics away — the
 * iOS home-screen app switched out and back, Safari backgrounded, a driver reset.
 *
 * What iOS does (reproduced in WebKit by killing its GPU process, scripts/e54-gpu-recovery.mjs): the page's WebGL
 * context is lost AND every 2D canvas is wiped to transparent — the particle / sprite / smoke / water canvases the
 * scene's textures are made from, the minimap's painted terrain and fog of war. three.js restores the WebGL context by
 * itself, then its next render() re-links every program in one synchronous stall (the boot splits that into batches
 * precisely because one stall is minutes on an iPhone, src/engine/boot/precompile.ts) and re-uploads the wiped canvases as
 * blank textures. That was Jake's "blue and orange, completely broken", then "a still frame of the spawn, can't play".
 *
 * So:
 *   hide (visibilitychange / pagehide)   → `ws:background` pauses into the menu
 *   show                                 → the context is live: restart the loop if it died
 *   (RL5, Jake: "delete 90% of it": no resume screen; the paused menu and the world are what the switch back shows)
 *   webglcontextlost                     → preventDefault (restorable), the loop holds (no tick, no draw); the canvases
 *                                          are already wiped (the GPU process died, the iOS case) → reload at once,
 *                                          without waiting for the restore
 *   webglcontextrestored                 → canvases intact: restore in place — re-link every program in batches with
 *                                          the boot's own pacing (game.precompile), re-render what only lived on
 *                                          the GPU (`rebuild`: the sky's PMREM environment), draw, resume under the menu;
 *                                          canvases wiped, a runtime bake in the scene (gpuOnly.ts), a failed
 *                                          restore →
 *   reload                               → `location.replace` with `?at=` where the player stood and `?glreload`: the
 *                                          page shows the loading card, skips the title and lands in the world under
 *                                          the pause menu (main.ts). Saves are write-through to localStorage already.
 *                                          One automatic retry per session, then the error modal (RELOAD HERE).
 *   (MF3: no away-reload; a long absence wakes in place, and repaint() keeps the DOM drawn)
 *
 */
import type { Game } from './Game';
import type { Scope } from '../../../shared/engine/app/scope';
import { gpuOnlyContent, rebakeGpuContent } from './gpuOnly';
import { emitFault } from '../../../shared/engine/core/faults';
import { recordGpuRecovery } from '../boot/bootTrace';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { gpuSummary } from '../render/drawCheck';

const savedStorage = saveStorage('session');

export interface RecoveryHost {
  game: Game;
  /** re-render content that only ever lived on the GPU (after an in-place restore, before the first frame) */
  rebuild: () => void;
  /** where the player stands, carried through a reload as ?at=x,y,z,yaw,pitch (null: spawn as usual) */
  pose: () => { x: number; y: number; z: number; yaw: number; pitch: number } | null;
  /** Prepare durable recovery metadata before navigation; false or an exception returns to the title. */
  beforeReload?: (reason: 'gpu' | 'background') => boolean;
  /** a context loss immediately after boot must return to the static selector, not eagerly build the same world again */
  fragileBoot?: () => boolean;
  /**
   * E155: the shard is parked (another resident shard is playing) — a context it loses now is not the player's problem:
   * no reload; `onLostParked` tells the shard host, which evicts it (it rebuilds on the way back).
   * An evicted shard's own `forceContextLoss` lands here too.
   */
  parked?: () => boolean;
  onLostParked?: () => void;
}

/** Shared with the boot's only automatic retry; time never renews it. */
const RELOAD_KEY = 'boot.selfReload';

/** URL param the reload adds (index.html's inline script and main.ts read it; main.ts strips it and ?at= once read) */
export const RELOAD_PARAM = 'glreload';

type Phase = 'ok' | 'lost' | 'restoring' | 'reloading' | 'stuck';

export function installGpuRecovery(host: RecoveryHost): void {
  const { game } = host;
  const scope = game.levelScope.child('gpu-recovery');
  const canvas = game.renderer.domElement;
  if (canvas !== game.canvas) return; // an offscreen canvas of our own, not the one the player sees
  const gl = game.renderer.getContext();
  let lostGpu = 'GPU unknown'; // read while the context lives: a lost one answers nothing
  try { lostGpu = gpuSummary(gl); } catch { /* the summary is a courtesy */ }

  let phase: Phase = 'ok';
  let hidden = document.visibilityState === 'hidden';
  let epoch = 0; // a newer loss abandons an in-flight restore / reveal

  // A canvas the size the browsers accelerate, painted once: a GPU-process restart wipes it with the game's own.
  // Read back only on a loss / restore — frequent readbacks would move it to the CPU and hide the wipe.
  const sentinel = document.createElement('canvas');
  sentinel.width = sentinel.height = 64;
  const sctx = sentinel.getContext('2d');
  if (sctx) { sctx.fillStyle = 'rgb(255, 0, 255)'; sctx.fillRect(0, 0, 64, 64); }
  const canvasesWiped = (): boolean => {
    if (!sctx) return false;
    try { const d = sctx.getImageData(32, 32, 1, 1).data; return !(d[0] === 255 && d[1] === 0 && d[2] === 255 && d[3] === 255); } catch { return true; }
  };

  /** Only confirmed canvas/context or restore failures request a reload. */
  const reload = (why: string): void => {
    if (phase === 'reloading' || phase === 'stuck') return;
    recordGpuRecovery(why);
    epoch++;
    game.hold = true;
    document.dispatchEvent(new Event('ws:background'));
    console.warn(`[gl] reloading: ${why}`);
    let retried = true;
    try { retried = savedStorage.getItem(RELOAD_KEY) !== null; } catch { /* Unknown storage cannot grant an automatic retry. */ }
    let fragileBoot = host.fragileBoot?.() === true;
    if (!fragileBoot && host.beforeReload !== undefined) {
      try { fragileBoot = !host.beforeReload('gpu'); }
      catch { fragileBoot = true; }
    }
    const url = fragileBoot ? new URL('/', location.origin) : new URL(location.href);
    url.searchParams.delete('v');
    const pose = fragileBoot ? null : host.pose();
    // y in the level's authored frame (less its runtime datum, G164): the reload stands on the same ground in either state
    if (pose) url.searchParams.set('at', [pose.x, pose.y - terrainDatum(), pose.z, pose.yaw, pose.pitch].map((v) => (Math.round(v * 100) / 100).toString()).join(','));
    if (!fragileBoot) url.searchParams.set(RELOAD_PARAM, '1'); // ?glreload skips the title only after a stable world
    const to = url.toString();
    if (retried) {
      phase = 'stuck';
      // the error modal (G880) opens on a fatal fault; its RELOAD HERE is the way on
      emitFault({ system: 'gpu-recovery', error: new Error(`Graphics lost · your progress is saved (${why})`), verdict: 'fatal' });
      return;
    }
    phase = 'reloading';
    try { savedStorage.setItem(RELOAD_KEY, '1'); } catch { /* This document still records its reloading phase. */ }
    leaveSaved(() => { markReload(`graphics recovery: ${why}`, 'gpu'); location.replace(to); });
  };

  const lose = (why: string): void => {
    epoch++;
    if (phase === 'reloading' || phase === 'stuck') return;
    phase = 'lost';
    game.hold = true;
    document.dispatchEvent(new Event('ws:background'));
    console.warn(`[gl] ${why}: holding the frame loop`);
    // QA 2026-11-13 row 6 (Android Chrome: the world went black after a jump): a loss in front of the player reaches
    // Sentry with the GPU that lost it (one behind a hidden page is the iOS app switch: routine, not reported). Time
    // still never reloads: only a confirmed wipe or failed restore does (gpu-recovery-conditions.test.ts)
    if (!hidden) emitFault({ system: 'gpu-recovery', error: new Error(`WebGL context lost (${why}) · ${lostGpu}`), verdict: 'retry' });
    // the GPU process died (every canvas wiped): nothing to restore in place — do not wait for the restore event
    if (canvasesWiped()) reload('the GPU process restarted: every canvas was wiped');
  };

  const restore = async (): Promise<void> => {
    if (phase === 'reloading' || phase === 'stuck') return;
    if (canvasesWiped()) { reload('the GPU process restarted: every canvas was wiped'); return; }
    const bakes = gpuOnlyContent();
    if (bakes.length > 0) { reload(`runtime bakes cannot be restored (${bakes.join(', ')})`); return; }
    const mine = ++epoch;
    phase = 'restoring';
    const t0 = performance.now();
    try {
      await precompileLevel(game);
      if (mine !== epoch) return;
      host.rebuild();
      rebakeGpuContent(); // the runtime bakes that can paint themselves again (gpuOnly.ts onGpuRestored)
      await game.firstFrame();
      if (mine !== epoch) return;
      if (gl.isContextLost()) throw new Error('lost again during the restore');
    } catch (e) {
      if (mine === epoch) reload(`the restore failed (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    phase = 'ok';
    game.hold = false;
    console.warn(`[gl] restored in place in ${Math.round(performance.now() - t0)} ms`);
  };

  scope.listen(canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    if (host.parked?.() === true) { console.warn('[gl] a parked level lost its context'); host.onLostParked?.(); return; }
    lose('context lost');
  });
  scope.listen(canvas, 'webglcontextrestored', () => { if (host.parked?.() !== true) void restore(); });

  const hide = (): void => {
    if (hidden) return; // visibilitychange and pagehide both land here
    hidden = true;
    epoch++;
    document.dispatchEvent(new Event('ws:background')); // the HUD pauses into the menu (a no-op on the title / already paused)
  };
  const show = (): void => {
    if (!hidden) return;
    hidden = false;
    repaint(scope);
    if (phase !== 'ok') return; // lost / restoring / reloading: that path ends it
    if (gl.isContextLost()) { lose('context lost while hidden (no event)'); return; }
    game.kickLoop(); // the frame loop, if the browser dropped its animation frame across the switch
  };
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); else show(); });
  scope.listen(window, 'pagehide', hide);
  scope.listen(window, 'pageshow', (e) => { if (e.persisted) show(); });
  scope.onDispose(() => { epoch++; });

}

/**
 * Make WebKit paint every DOM layer again (E135). Jake's home-screen app came back from 10+ min away with the canvas
 * drawing and nothing the DOM paints showing (white where the page's dark background should be, no HUD): iOS may drop
 * a suspended page's tile backing stores and not repaint them. A two-frame opacity change on <html> makes it a
 * compositing layer and back, which repaints its contents; the player sees nothing (0.999).
 */
function repaint(scope: Scope): void {
  const s = document.documentElement.style;
  s.opacity = '0.999';
  scope.raf(() => { scope.raf(() => { s.opacity = ''; }); });
  scope.onDispose(() => { s.opacity = ''; });
}
