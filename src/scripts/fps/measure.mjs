import { KEYCHAIN_ARGS } from '../.kit/chromium-keychain.mjs';
import { developerSettings, harnessPins, saveFixture, NAME_ASKED } from '../debug-settings.mjs';
import { loadingCardIndex } from '../loading-benchmark/catalogue.mjs';
import { legSummary, routeLegOnPage } from '../memory/iphone/route.mjs';
import { fpsVerdict } from './verdict.mjs';
import { observePasses, requirePassBench } from './passes.mjs';
import { observeProgramLinks, recordProgramSources } from './workload.mjs';
import { observeFencedGpu } from './gpuProbe.mjs';

/** @typedef {{browser:'webkit'|'chromium', cpu:number, graphics:'low'|'medium'|'high', tier:'phone'|'desktop',
 * width:number, height:number, dpr:1|2|3, cap:30|60|null, floor:number, device?:Record<string,boolean|number|string>}} Profile */
/** @typedef {import('../memory/iphone/route.mjs').RouteLeg} RouteLeg */

/**
 * Time a subset of real composer frames without synchronizing the GPU.
 * It is serialized with the route and runs in the page.
 * @param {{render:(...args:unknown[])=>unknown}} composer
 * @param {WebGL2RenderingContext} gl
 */
function observeMetal(composer, gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (ext === null) return () => null;
  const originalRender = composer.render;
  /** @type {number[]} */
  const millis = [];
  /** @type {WebGLQuery|null} */
  let pending = null;
  let frame = 0;
  const settle = () => {
    if (pending === null || !gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) return;
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      const ms = gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6;
      if (Number.isFinite(ms) && ms > 0) millis.push(ms);
    }
    gl.deleteQuery(pending);
    pending = null;
  };
  composer.render = function render(...args) {
    settle();
    if (pending !== null || ++frame % 8 !== 0) return originalRender.apply(this, args);
    pending = gl.createQuery();
    if (pending === null) return originalRender.apply(this, args);
    gl.beginQuery(ext.TIME_ELAPSED_EXT, pending);
    try { return originalRender.apply(this, args); }
    finally { gl.endQuery(ext.TIME_ELAPSED_EXT); }
  };
  return () => {
    composer.render = originalRender;
    settle();
    if (pending !== null) gl.deleteQuery(pending);
    millis.sort((a, b) => a - b);
    const at = (/** @type {number} */ q) => millis[Math.floor((millis.length - 1) * q)] ?? null;
    return { frames: millis.length, p50Ms: at(0.5), p95Ms: at(0.95) };
  };
}

/** DF14: every animation frame of 50 ms or more after control, with the scripts that ran in it (Chromium's
 * long-animation-frame entries; none on WebKit). A frame whose update and render are small but whose interval is long
 * shows here what else held the main thread: a script's source and function, or no script at all (style, layout, the GPU).
 * Runs on the page, so it may use only its own scope. */
export function observeLongFrames() {
  /** @type {{at:number,ms:number,blockingMs:number,renderStartMs:number,scripts:{ms:number,source:string,invoker:string}[]}[]} */
  const frames = [];
  let t0 = -1;
  /** @type {PerformanceObserver|null} */
  let observer = null;
  const round = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  return {
    start() {
      try {
        t0 = performance.now();
        observer = new PerformanceObserver(list => {
          for (const entry of /** @type {any[]} */ (list.getEntries())) {
            if (entry.startTime < t0 || frames.length >= 60) continue;
            frames.push({ at: round((entry.startTime - t0) / 1000), ms: Math.round(entry.duration),
              blockingMs: Math.round(entry.blockingDuration ?? 0), renderStartMs: Math.round((entry.renderStart ?? entry.startTime) - entry.startTime),
              scripts: (entry.scripts ?? []).filter((/** @type {any} */ x) => x.duration >= 5).slice(0, 6).map((/** @type {any} */ x) => ({ ms: Math.round(x.duration),
                source: `${String(x.sourceFunctionName ?? '') === '' ? '?' : String(x.sourceFunctionName)} ${String(x.sourceURL ?? '').split('/').pop()}:${String(x.sourceCharPosition ?? -1)}`,
                invoker: String(x.invoker ?? '').slice(0, 80) })) });
          }
        });
        observer.observe({ type: 'long-animation-frame', buffered: false });
      } catch { observer = null; }
    },
    take() { observer?.disconnect(); return observer === null && frames.length === 0 ? null : frames; },
  };
}

/** Attach the first measurement before the boot can give control to the player.
 * @param {RouteLeg[]} route @param {Profile} profile @param {RouteLeg[]} approach @param {boolean} passBreakdown
 * @param {number} [fencedEvery] DF5: fence one frame in this many (gpuProbe.mjs); 0 leaves frames unfenced */
export function routeScript(route, profile, approach, passBreakdown, fencedEvery = 0) {
  const cap = profile.cap ?? (profile.tier === 'phone' ? 0 : null);
  return `(() => {
    const runLeg = (${routeLegOnPage.toString()});
    const route = ${JSON.stringify(route)}, approach = ${JSON.stringify(approach)};
    const observeMetal = (${observeMetal.toString()});
    const observeProgramLinks = (${observeProgramLinks.toString()});
    const observePasses = ${passBreakdown ? `(${observePasses.toString()})` : 'null'};
    const observeFenced = ${fencedEvery > 0 ? `(${observeFencedGpu.toString()})` : 'null'};
    const longFrames = (${observeLongFrames.toString()})();
    const sources = (${recordProgramSources.toString()})([globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean));
    document.addEventListener('ws:control-ready', () => {
      longFrames.start();
      sources.control();
      window.__dfRoute = (async () => {
        const game = window.__wildshard.world.game, renderer = game.renderer;
        const gl = renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const gpu = debug === null ? null : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
        const witness = { build: window.__WS_BUILD_ID__ ?? null, dpr: renderer.getPixelRatio(), css: [innerWidth, innerHeight],
          gpu, level: game.level.id, phoneGraphics: game.phoneGraphics, programs: renderer.info.programs?.length ?? null };
        const legs = [], approached = [], links = observeProgramLinks(gl);
        try {
        for (const leg of approach) {
          const result = await runLeg({...leg, approach: true, cap: ${JSON.stringify(cap)}});
          approached.push({name:leg.name,nav:result.nav,ms:result.ms,error:result.error});
          if (result.error) return {witness, legs, approach:approached, error: leg.name + ': ' + result.error};
        }
        for (const leg of route) {
          const startPrograms = renderer.info.programs?.length ?? null;
          const stop = observePasses === null ? observeMetal(game.composer, gl) : observePasses(game.composer, renderer);
          const fence = observeFenced === null ? null : observeFenced(game, ${String(fencedEvery)});
          let measured, fenced = null, result;
          try { result = await runLeg({...leg, cap: ${JSON.stringify(cap)}}); }
          finally { measured = stop(); if (fence !== null) fenced = fence(); }
          legs.push({ name: leg.name, ...result, ...(observePasses === null ? { metal: measured } : { passBreakdown: measured }),
            startPrograms, programLinksAfterControl: links.count(), newProgramSourcesAfterControl: sources.fresh(),
            ...(fenced === null ? {} : { fencedGpu: fenced }) });
          if (result.error) break;
        }
        return { witness, legs, approach:approached, longFrames: longFrames.take() };
        } finally { links.stop(); }
      })();
    }, { once: true });
  })()`;
}

/** @param {Profile} profile */
async function openProfile(profile) {
  const { chromium, webkit } = await import('../browser-playwright.mjs');
  const native = profile.cap === null ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  return profile.browser === 'webkit' ? webkit.launch({ headless: true }) :
    chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', ...native] });
}

/** DF14 (mini-dwfps, 2026-11-22): the desktop tier's render scale (src/client/engine/render/tiers.ts `desktop.dpr`). A desktop
 * player draws at min(screen, 1.5), and dynamic resolution (renderBudget.ts) only lowers it. Until now the bench forced the
 * drawing buffer to the screen's 2× through a Developer pixel pick: 4.29 Mpx at 1496 × 717 against the 2.41 Mpx a player
 * draws, which no player sees without picking Render scale 2 in Settings. The desktop profiles now draw at the tier's own
 * ceiling, pinned (Settings ▸ Render scale 1.5) so dynamic resolution cannot move it under the bench. */
export const DESKTOP_TIER_DPR = 1.5;

/** The drawing buffer's pixel ratio a profile draws at: capped phones at their preset, desktop at the tier's ceiling,
 * uncapped phone Low at the raster it names. @param {Profile} profile */
export function drawingRatio(profile) {
  if (profile.cap !== null) return profile.graphics === 'high' ? 2 : 1;
  return profile.tier === 'desktop' ? Math.min(profile.dpr, DESKTOP_TIER_DPR) : profile.dpr;
}

/** @param {import('playwright').Browser} browser @param {Profile} profile */
async function openContext(browser, profile) {
  const { devices } = await import('../browser-playwright.mjs');
  const { defaultBrowserType: _type, ...device } = devices['iPhone 15 Pro'];
  const context = await browser.newContext({ ...(profile.cap === null ? {} : device),
    viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
  await developerSettings(context, { tier: profile.tier, volume: 0, time: 'midday', weather: 'clear' });
  await saveFixture(context, { scope: 'device', key: 'graphics', data: profile.graphics });
  // DF14: the tier's own render scale (DESKTOP_TIER_DPR), as a player draws it, never the Developer pixel pick's full screen
  if (profile.tier === 'desktop') await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: String(DESKTOP_TIER_DPR) }, merge: true });
  // Low is the engine's phone preset, drawn uncapped at the specified desktop raster.
  if (profile.tier === 'phone' && profile.cap === null) await saveFixture(context, {
    scope: 'device', key: 'gfx.knob.density', data: profile.dpr,
  });
  // DF10: an arm's device slots (`table.mjs --device key=value,...`), saved before the page boots
  for (const [key, data] of Object.entries(profile.device ?? {})) await saveFixture(context, { scope: 'device', key, data });
  await saveFixture(context, NAME_ASKED);
  await harnessPins(context, { seed: 357 });
  return context;
}

/** @param {import('playwright').Page} page @param {string} base @param {string} zone */
async function enterGrid(page, base, zone) {
  await page.goto(base, { waitUntil: 'load', timeout: 30_000 });
  await page.locator('.ws-main-select').click({ timeout: 15_000 });
  const names = await page.locator('.ws-menu-card b').allTextContents();
  const idx = loadingCardIndex(names, zone);
  await page.evaluate(i => {
    const dot = document.querySelector(`.ws-menu-dots i[data-i="${i}"]`);
    if (!(dot instanceof HTMLElement)) throw new Error('The selected grid card has no navigation dot');
    if (!dot.classList.contains('on')) dot.click();
  }, idx);
  await page.locator('.ws-menu-play').click({ timeout: 15_000 });
}

/** @param {import('playwright').BrowserContext} context @param {Profile} profile
 * @param {{base:string, zone:string, route:RouteLeg[], approach?:RouteLeg[], passBreakdown?:boolean, signal:AbortSignal, captureMs?:number, fencedEvery?:number}} options */
async function capture(context, profile, { base, zone, route, approach = [], passBreakdown = false, signal, captureMs = 240_000, fencedEvery = 0 }) {
  const page = await context.newPage();
  /** @type {string[]} */
  const faults = [];
  page.on('pageerror', error => { if (faults.length < 8) faults.push(error.message.slice(0, 400)); });
  const stop = () => { void page.close().catch(() => undefined); };
  // one boot's whole route at a phone CPU rate (the DF5 stand-in) runs past the quick legs' 240 s
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(captureMs)]);
  deadline.addEventListener('abort', stop, { once: true });
  try {
    deadline.throwIfAborted();
    if (profile.browser === 'chromium' && profile.cpu !== 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    }
    await page.addInitScript({ content: routeScript(route, profile, approach, passBreakdown, fencedEvery) });
    const version = await page.request.get(new URL('/version.json', base).href, {timeout:10_000}).then(response => response.json());
    await enterGrid(page, base, zone);
    await page.waitForFunction('window.__dfRoute !== undefined', undefined, { timeout: 90_000 });
    const raw = await page.evaluate('window.__dfRoute');
    const check = fpsVerdict(raw.legs, route, profile.floor);
    const costs = raw.legs.map((/** @type {{name:string,samples?:Parameters<typeof legSummary>[0]}} */ leg) =>
      ({ name: leg.name, ...legSummary(leg.samples ?? []) }));
    const dpr = drawingRatio(profile);
    const error = raw.error ?? (raw.witness.phoneGraphics !== (profile.tier === 'phone') ? 'engine tier differs from profile' :
      raw.witness.dpr !== dpr ? 'drawing buffer DPR differs from profile' :
      raw.witness.build !== version.build ? 'game build differs from version.json' : null);
    return { version, ...raw, ...check, costs, ...(error === null ? {} : { verdict: 'incomplete', error }) };
  } catch (error) {
    const boot = await page.evaluate(() => ({
      path: location.pathname,
      loading: document.querySelector('.ws-load')?.textContent?.trim().slice(0, 600) ?? null,
      title: document.querySelector('.ws-main-select') !== null,
      routeStarted: Object.hasOwn(window, '__dfRoute'),
    })).catch(() => null);
    return { ...fpsVerdict([], route, profile.floor), boot, faults, error: deadline.aborted ? String(deadline.reason) : String(error) };
  } finally {
    deadline.removeEventListener('abort', stop);
    await page.close().catch(() => undefined);
  }
}

/** One cold capture per fresh browser context. Its optional warm repeat keeps the actual HTTP and SW caches.
 * @param {Profile} profile @param {{base:string,zone:string,route:RouteLeg[],approach?:RouteLeg[],passBreakdown?:boolean,signal:AbortSignal,warm?:boolean,captureMs?:number,fencedEvery?:number}} options */
export async function measureFps(profile, options) {
  if (options.passBreakdown) requirePassBench(process.env.WS_BENCH);
  const browser = await openProfile(profile);
  try {
    const context = await openContext(browser, profile);
    const cold = await capture(context, profile, options);
    const warm = options.warm && cold.verdict !== 'incomplete' ? await capture(context, profile, options) : null;
    return { browser: browser.version(), cold, warm };
  } finally { await browser.close(); }
}
