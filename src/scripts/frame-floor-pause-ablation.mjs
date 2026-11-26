/** Browser-serialized A/B/C lifecycle. Browser rAF survives the game's pause
 * gate; drawn intervals and browser callback intervals stay separate. */
export function ablationWindow(mode) {
  const api = window.__wildshard, world = api?.world, game = world?.game;
  const paused = mode === 'paused';
  const menu = () => document.querySelector('.ws-gmenu.show') !== null;
  if (!game || !world.hud.entered || world.hud.paused !== paused || game.frameGate() === paused || menu() !== paused)
    throw new Error('Ablation requires matching entered controls/menu/frame gate');
  const counters = () => ({ frames: game.frameCount, tick: game.app.clock.frame, simulationSeconds: game.app.clock.now,
    paused: world.hud.paused, frameGate: game.frameGate(), menuVisible: menu() });
  const before = counters(), startMs = performance.now(), intervals = [], browserIntervals = [];
  let lastBrowser = null, lastDrawn = null, lastCount = game.frameCount, missedDraws = 0, dropped = 0;
  const probe = mode === 'buffers' ? window.__frameFloorBufferPressure : undefined;
  if (mode === 'buffers' && !probe) throw new Error('C has no preboot buffer probe');
  probe?.begin();
  return new Promise((resolve, reject) => {
    let done = false, raf;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    // oxlint-disable-next-line prefer-const -- cleanup closes over deadline before installation
    let timer;
    /** @param {Error} [error] */
    const finish = error => {
      if (done) return;
      done = true; cancelAnimationFrame(raf); clearTimeout(timer);
      const endMs = performance.now(), allocation = probe?.take();
      if (error) { reject(error); return; }
      resolve({ mode, startMs, endMs, elapsedMs: endMs - startMs, before, after: counters(),
        frames: game.frameCount - before.frames, intervals, browserIntervals, missedDraws, dropped,
        ...(allocation === undefined ? {} : {allocation}) });
    };
    timer = setTimeout(() => finish(new Error('Ablation browser rAF deadline exceeded')), 30000);
    const frame = at => {
      if (window.__wildshard !== api || api.world !== world || world.game !== game || !world.hud.entered
        || world.hud.paused !== paused || game.frameGate() === paused || menu() !== paused) {
        finish(new Error('Ablation world/controls/menu changed')); return;
      }
      if (lastBrowser !== null) { if (browserIntervals.length < 2500) browserIntervals.push([lastBrowser, at - lastBrowser]); else dropped++; }
      lastBrowser = at;
      if (game.frameCount !== lastCount) {
        missedDraws += Math.max(0, game.frameCount - lastCount - 1); lastCount = game.frameCount;
        const drawn = game.frameRafTime;
        if (typeof drawn !== 'number' || !Number.isFinite(drawn)) { finish(new Error('Ablation has no drawn clock')); return; }
        if (drawn >= startMs) {
          if (lastDrawn !== null) { if (intervals.length < 2500) intervals.push([lastDrawn, drawn - lastDrawn]); else dropped++; }
          lastDrawn = drawn;
        }
      }
      if (performance.now() - startMs >= 20000) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

/** Existing touch pause control, then existing resume control; no app state writes. */
export function pauseMenuAction(open) {
  const selector = open ? '.ws-touch-pause' : '.ws-gmenu.show .ws-gmenu-close';
  const button = document.querySelector(selector);
  if (!(button instanceof HTMLElement) || button.getBoundingClientRect().width <= 0) throw new Error(`Pause UI unavailable: ${selector}`);
  for (const type of ['pointerdown', 'pointerup']) button.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true}));
}
export const ABLATION_NORMAL = `(${ablationWindow.toString()})('normal')`;
export const ABLATION_PAUSED = `(${ablationWindow.toString()})('paused')`;
export const ABLATION_BUFFERS = `(${ablationWindow.toString()})('buffers')`;
export const OPEN_PAUSE_MENU = `(${pauseMenuAction.toString()})(true)`;
export const CLOSE_PAUSE_MENU = `(${pauseMenuAction.toString()})(false)`;

/** Refresh only before A, never replaying an evaluation or a begun window.
 * @param {() => Promise<unknown>} reconnect
 * @param {import('./frame-floor-pause-ablation.mjs').AblationDocument} expected
 */
export async function refreshAblationInspector(reconnect, expected) {
  const identity = await reconnect();
  if (identity === null || typeof identity !== 'object' || !('token' in identity) || !('timeOrigin' in identity)
    || identity.token !== expected.token || typeof identity.timeOrigin !== 'number' || !Number.isFinite(identity.timeOrigin))
    throw new Error('Ablation Inspector reattach changed the document');
  // Use the existing token identity rule. Safari time-origin rounding drift is
  // recorded rather than mistaken for navigation, as in the original driver.
  return { token: identity.token, timeOrigin: identity.timeOrigin, originDriftMs: identity.timeOrigin - expected.timeOrigin };
}

/** Same capture windows: omit the pause and both UI actions in A+C mode.
 * @param {boolean} includePause
 */
export function ablationPhases(includePause) {
  return includePause ? [
    {mode: 'paused', expression: ABLATION_PAUSED, action: OPEN_PAUSE_MENU},
    {mode: 'buffers', expression: ABLATION_BUFFERS, action: CLOSE_PAUSE_MENU},
  ] : [{mode: 'buffers', expression: ABLATION_BUFFERS, action: null}];
}
