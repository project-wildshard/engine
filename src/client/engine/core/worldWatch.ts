/**
 * STAGING-BUGBASH SB48 (P0, Jake 2026-11-18 12:07 Cancún, staging v0.1.43, iPhone 17 Pro, Low Power, Driftwood): the HUD drew
 * over a completely black world. The pixels were the page's own background (#050810), so the world canvas was not on
 * screen at all: hidden, never presented, or presented transparent. Nothing reported it, and no headless browser
 * reproduced it. This watch looks at the world a few times after control, the way a player would, and:
 *
 *  - a canvas left hidden by a style (`visibility`, `display`, `opacity`) while play shows is put back on screen;
 *  - a world that reads transparent or flat black is reported (Sentry, through the fault hub) with what the page knew,
 *    then, if it is still not drawn at the next look, the error card opens with RELOAD instead of a silent black world.
 *
 * A look copies the canvas in the same task as the frame's render (`Game.captureFrame`: the drawing buffer is not kept),
 * 48 px wide: a few hundred pixels, three or four times a session. It never runs while the page is hidden, the loop is
 * held (a lost context is GpuRecovery's), or the grid's arrival reveal still has the canvas hidden on purpose.
 */
import { emitFault } from '../../../shared/engine/core/faults';
import type { Scope } from '../../../shared/engine/app/scope';
import { graphicsMode } from './graphicsMode';
import { passSplitLimit } from '../render/passSplit';
import { bindDrawWatch } from '../render/drawCheck';
import { jsonSlot } from '../saves/slots';
import { watchPixelReader } from './watchPixels';

/** what a look found */
export type WorldLook = 'drawn' | 'transparent' | 'black';

/** Over this share of pixels with alpha under 8, the canvas presents nothing (the page shows through). */
export const TRANSPARENT_SHARE = 0.9;
/** A drawn world is never this dark and this flat at once (a night cell is still lit and textured). */
export const BLACK_MEAN = 6, BLACK_SD = 3;

/** Judge an RGBA copy of the world canvas. */
export function judgeWorldPixels(data: ArrayLike<number>): WorldLook {
  const n = Math.floor(data.length / 4);
  if (n === 0) return 'drawn';
  let clear = 0, sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] ?? 0, g = data[i * 4 + 1] ?? 0, b = data[i * 4 + 2] ?? 0, a = data[i * 4 + 3] ?? 0;
    if (a < 8) clear++;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l; sq += l * l;
  }
  if (clear / n >= TRANSPARENT_SHARE) return 'transparent';
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return mean < BLACK_MEAN && sd < BLACK_SD ? 'black' : 'drawn';
}

/** Why a canvas's own style keeps it off screen, or null. */
export function canvasHiddenBy(style: Pick<CSSStyleDeclaration, 'visibility' | 'display' | 'opacity'>): string | null {
  if (style.display === 'none') return 'display: none';
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return `visibility: ${style.visibility}`;
  if (style.opacity !== '' && Number(style.opacity) === 0) return 'opacity: 0';
  return null;
}

/** The game surface the watch reads (Game, or a test's). */
export interface WorldWatchHost {
  readonly canvas: HTMLCanvasElement;
  /** the frame loop is held (a lost context, a paused restore): nothing is drawn on purpose */
  readonly hold: boolean;
  /** a copy of the next drawn frame (Game.captureFrame) */
  captureFrame: (maxW: number) => Promise<HTMLCanvasElement>;
  /** the context is lost (GpuRecovery handles that) */
  contextLost: () => boolean;
  /** whether the player should be looking at the world now (in play, the arrival reveal over) */
  playing: () => boolean;
  /** what the report carries besides the look (graphics mode, pass split, drawing buffer...) */
  detail: () => Record<string, unknown>;
  /** frames drawn so far (Game.frameCount); absent: the look waits CAPTURE_WAIT_MS */
  frames?: () => number;
  /** the page's timers, owned by the level */
  scope: Scope;
}

/** How long a look waits for the next drawn frame, at least. */
export const CAPTURE_WAIT_MS = 3000;
/** The longest a look waits, however slow the loop's recent frames were: a loop this far past its own cadence has stalled. */
export const CAPTURE_WAIT_MAX_MS = 15_000;
/** A look waits this many of the loop's own drawn-frame intervals before it calls the world undrawn. */
export const CAPTURE_WAIT_FRAMES = 3;

/** How long a look waits for the next frame: three of the loop's own drawn-frame intervals since control, 3 s at least,
 *  15 s at most. Nightly 45148332920: on the runner's SwiftShader Mossgate and Driftwood draw a frame every second or more
 *  (Driftwood's 30 draw-phase frames took 54 s on 11-22), so a flat 3 s wait called a slow, drawn world undrawn. A loop that
 *  stops after normal frames is still named in 3 s; one that drew nothing since control waits three times that gap.
 *  `elapsedMs` since control, `drawn` frames drawn in it. */
export function captureWaitMs(elapsedMs: number, drawn: number): number {
  const interval = drawn > 0 ? elapsedMs / drawn : elapsedMs;
  return Math.min(CAPTURE_WAIT_MAX_MS, Math.max(CAPTURE_WAIT_MS, Math.ceil(CAPTURE_WAIT_FRAMES * interval)));
}

/** The device slot `debug.worldWatchDrawCheck`: on, the watch reads its thumbnails in a worker and stands in for DrawCheck's two
 *  synchronous checks on its own canvas. Default on since DRIFTWOOD-FPS DF14 (mini-dwfps, 2026-11-23): on the Mac mini's native
 *  High dock the synchronous checks were the frames over 50 ms after control (DrawCheck's checkFramebufferStatus 104 to 106 ms
 *  at ~2.3 s, the 3 s look's getImageData 112 ms; same-boot CPU profiles), and with the slot on two ABBA pairs kept none of
 *  them (frames over 50 ms off 2, 3 / on 1, 1, the one left the frame control lands in). On the iPhone 13 it took the page's
 *  50 to 70 ms of GPU waits a boot to none without moving the dock (DF8, three cooled pairs). `false` is the off switch. */
export function worldWatchAsync(): boolean {
  return jsonSlot('debug.worldWatchDrawCheck', 'device').read() !== false;
}

/** Seconds after control of each look. */
export const LOOKS_S: readonly number[] = [3, 8, 20, 45];

/** Watch a world reached control: the looks in LOOKS_S, each skipped while it cannot judge. */
export function installWorldWatch(host: WorldWatchHost, looks: readonly number[] = LOOKS_S): void {
  let reported = false, failed = 0, stopped = false;
  const controlFrames = host.frames?.() ?? 0;
  const asyncRead = looks.length > 0 && worldWatchAsync();
  const readPixels = asyncRead ? watchPixelReader(host.scope) : null;
  const canLook = (): boolean => !stopped && !host.scope.disposed && !host.scope.disposing
    && document.visibilityState === 'visible' && !host.hold && !host.contextLost() && host.playing();
  const report = (why: string, look: WorldLook | 'hidden', fatal: boolean): void => {
    const detail = { look, why, graphics: graphicsMode(), passSplit: passSplitLimit(), ...host.detail() };
    console.warn(`[world-watch] ${why}`, detail);
    emitFault({ system: 'world-watch', error: Object.assign(new Error(`World not drawn: ${why}`), { detail }), verdict: fatal ? 'uncaught' : 'retry' });
  };
  /** `atMs`: how long after control this look runs (its LOOKS_S entry) */
  const lookOnce = async (atMs: number): Promise<void> => {
    if (!canLook()) return;
    const hiddenBy = canvasHiddenBy(getComputedStyle(host.canvas));
    if (hiddenBy !== null) {
      // the world is drawn but kept off screen: put it back, and say so once
      if (!reported) { reported = true; report(`the world canvas was left hidden (${hiddenBy}); shown again`, 'hidden', false); }
      host.canvas.style.visibility = 'visible'; host.canvas.style.opacity = ''; if (host.canvas.style.display === 'none') host.canvas.style.display = '';
      return;
    }
    const wait = host.frames === undefined ? CAPTURE_WAIT_MS : captureWaitMs(atMs, host.frames() - controlFrames);
    const copy = await Promise.race([host.captureFrame(48), new Promise<null>((resolve) => { host.scope.timeout(wait, () => { resolve(null); }); })]);
    if (stopped || host.scope.disposed) return;
    if (copy === null) {
      // no frame drew in that time while play shows and the loop is not held: say so once (the loop's own faults name why)
      if (!reported && !host.hold && document.visibilityState === 'visible') { reported = true; report(`no world frame drew in ${String(wait)} ms of play`, 'black', false); }
      return;
    }
    if (copy.width === 0 || copy.height === 0) return;
    let pixels = readPixels === null ? null : await readPixels(copy, CAPTURE_WAIT_MS);
    if (asyncRead && !canLook()) return;
    if (pixels === null) {
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      if (ctx === null) return;
      pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
    }
    const look = judgeWorldPixels(pixels);
    if (look === 'drawn') { failed = 0; return; }
    failed++;
    if (failed === 1) { if (!reported) { reported = true; report(`the world reads ${look} after control`, look, false); } return; }
    // still not drawn at the next look: the error card's RELOAD, never a silent black world
    stopped = true;
    report(`the world still reads ${look} ${String(failed)} looks after control`, look, true);
  };
  for (const s of looks) host.scope.timeout(s * 1000, () => { void lookOnce(s * 1000); });
  if (asyncRead) bindDrawWatch(host.canvas, host.scope);
}
