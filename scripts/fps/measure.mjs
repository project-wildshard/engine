import { chromium, webkit, devices } from '../browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { developerSettings, harnessPins, saveFixture, NAME_ASKED } from '../debug-settings.mjs';
import { loadingCardIndex } from '../loading-benchmark/catalogue.mjs';
import { legSummary, routeLegOnPage } from '../memory/iphone/route.mjs';
import { fpsVerdict } from './verdict.mjs';

/** @typedef {{browser:'webkit'|'chromium', cpu:number, graphics:'low'|'high', tier:'phone'|'desktop',
 * width:number, height:number, dpr:1|2|3, cap:30|60|null, floor:number}} Profile */
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

/** Attach the first measurement before the boot can give control to the player.
 * @param {RouteLeg[]} route @param {Profile} profile @param {RouteLeg[]} approach */
function routeScript(route, profile, approach) {
  const cap = profile.cap ?? (profile.tier === 'phone' ? 0 : null);
  return `(() => {
    const runLeg = (${routeLegOnPage.toString()});
    const route = ${JSON.stringify(route)}, approach = ${JSON.stringify(approach)};
    const observeMetal = (${observeMetal.toString()});
    document.addEventListener('ws:control-ready', () => {
      window.__dfRoute = (async () => {
        const game = window.__wildshard.world.game, renderer = game.renderer;
        const gl = renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const gpu = debug === null ? null : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
        const witness = { build: window.__WS_BUILD_ID__ ?? null, dpr: renderer.getPixelRatio(), css: [innerWidth, innerHeight],
          gpu, level: game.level.id, phoneGraphics: game.phoneGraphics, programs: renderer.info.programs?.length ?? null };
        const legs = [];
        for (const leg of approach) {
          const result = await runLeg({...leg, approach: true, cap: ${JSON.stringify(cap)}});
          if (result.error) return {witness, legs, error: leg.name + ': ' + result.error};
        }
        for (const leg of route) {
          const startPrograms = renderer.info.programs?.length ?? null;
          const stopMetal = observeMetal(game.composer, gl);
          const result = await runLeg({...leg, cap: ${JSON.stringify(cap)}});
          const metal = stopMetal();
          legs.push({ name: leg.name, ...result, metal, startPrograms });
          if (result.error) break;
        }
        return { witness, legs };
      })();
    }, { once: true });
  })()`;
}

/** @param {Profile} profile */
function openProfile(profile) {
  const native = profile.cap === null ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  return profile.browser === 'webkit' ? webkit.launch({ headless: true }) :
    chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', ...native] });
}

/** @param {import('playwright').Browser} browser @param {Profile} profile */
async function openContext(browser, profile) {
  const { defaultBrowserType: _type, ...device } = devices['iPhone 15 Pro'];
  const context = await browser.newContext({ ...(profile.cap === null ? {} : device),
    viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr });
  await developerSettings(context, { tier: profile.tier, volume: 0, time: 'midday', weather: 'clear' });
  await saveFixture(context, { scope: 'device', key: 'graphics', data: profile.graphics });
  if (profile.tier === 'desktop') await saveFixture(context, { scope: 'device', key: 'devPixels',
    data: { screen: profile.dpr, density: 2 } });
  // Low is the engine's phone preset, drawn uncapped at the specified desktop raster.
  if (profile.tier === 'phone' && profile.cap === null) await saveFixture(context, {
    scope: 'device', key: 'gfx.knob.density', data: profile.dpr,
  });
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
 * @param {{base:string, zone:string, route:RouteLeg[], approach?:RouteLeg[], signal:AbortSignal}} options */
async function capture(context, profile, { base, zone, route, approach = [], signal }) {
  const page = await context.newPage();
  const stop = () => { void page.close().catch(() => undefined); };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
  deadline.addEventListener('abort', stop, { once: true });
  try {
    deadline.throwIfAborted();
    if (profile.browser === 'chromium' && profile.cpu !== 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    }
    await page.addInitScript({ content: routeScript(route, profile, approach) });
    const version = await page.request.get(new URL('/version.json', base).href, {timeout:10_000}).then(response => response.json());
    await enterGrid(page, base, zone);
    await page.waitForFunction('window.__dfRoute !== undefined', undefined, { timeout: 90_000 });
    const raw = await page.evaluate('window.__dfRoute');
    const check = fpsVerdict(raw.legs, route, profile.floor);
    const costs = raw.legs.map((/** @type {{name:string,samples?:Parameters<typeof legSummary>[0]}} */ leg) =>
      ({ name: leg.name, ...legSummary(leg.samples ?? []) }));
    const dpr = profile.cap === null ? profile.dpr : profile.graphics === 'high' ? 2 : 1;
    const error = raw.error ?? (raw.witness.phoneGraphics !== (profile.tier === 'phone') ? 'engine tier differs from profile' :
      raw.witness.dpr !== dpr ? 'drawing buffer DPR differs from profile' :
      raw.witness.build !== version.build ? 'game build differs from version.json' : null);
    return { version, ...raw, ...check, costs, ...(error === null ? {} : { verdict: 'incomplete', error }) };
  } catch (error) {
    return { ...fpsVerdict([], route, profile.floor), error: deadline.aborted ? String(deadline.reason) : String(error) };
  } finally {
    deadline.removeEventListener('abort', stop);
    await page.close().catch(() => undefined);
  }
}

/** One cold capture per fresh browser context. Its optional warm repeat keeps the actual HTTP and SW caches.
 * @param {Profile} profile @param {{base:string,zone:string,route:RouteLeg[],approach?:RouteLeg[],signal:AbortSignal,warm?:boolean}} options */
export async function measureFps(profile, options) {
  const browser = await openProfile(profile);
  try {
    const context = await openContext(browser, profile);
    const cold = await capture(context, profile, options);
    const warm = options.warm && cold.verdict !== 'incomplete' ? await capture(context, profile, options) : null;
    return { browser: browser.version(), cold, warm };
  } finally { await browser.close(); }
}
