import { Buffer } from 'node:buffer';

/** Decode the PNG transport shared by the Chromium and WebKit protocols.
 * @param {string} data */
export function decodeProtocolPng(data) {
  return Buffer.from(data, 'base64');
}

/** @type {import('./fast-png.mjs').OpenCaptureSession} */
const openProtocolSession = async page => {
  const session = await page.context().newCDPSession(page);
  return { layout: () => session.send('Page.getLayoutMetrics'),
    capture: options => session.send('Page.captureScreenshot', options),
    detach: () => session.detach() };
};

/** Capture the same Chromium viewport PNG, choosing fast lossless encoding.
 * CDP is accessed only through Playwright's supported session API.
 * @param {import('playwright').Page} page @param {string} label @param {number} deadline
 * @param {import('./fast-png.mjs').OpenCaptureSession} [openSession] */
export async function captureViewportPng(page, label, deadline, openSession = openProtocolSession) {
  /** @template T @param {string} name @param {()=>Promise<T>} run @returns {Promise<T>} */
  const stage = async (name, run) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Boot deadline: ${label} ${name}`);
    const started = performance.now(); let state = 'refused', timer;
    try {
      /** @type {Promise<never>} */ const expired = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Boot deadline: ${label} ${name}`)), remaining);
      });
      const value = await Promise.race([run(), expired]);
      if (Date.now() >= deadline) throw new Error(`Boot deadline: ${label} ${name}`);
      state = 'complete'; return value;
    } finally {
      clearTimeout(timer);
      console.log(`boot-capture ${JSON.stringify({ label, stage: name, state, ms: performance.now() - started })}`);
    }
  };
  const session = await stage('cdp-session', () => openSession(page));
  try {
    await stage('fonts-ready', () => page.evaluate(async () => { await document.fonts.ready; }));
    await stage('compositor-frame', () => page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => resolve(true));
    })));
    const viewport = page.viewportSize() ?? await stage('viewport', () => page.evaluate(() => ({
      width: window.innerWidth, height: window.innerHeight,
    })));
    const { visualViewport } = await stage('layout-metrics', () => session.layout());
    const { pageX, pageY, scale } = visualViewport;
    if (![pageX, pageY, scale, viewport.width, viewport.height].every(Number.isFinite) ||
      scale <= 0 || viewport.width <= 0 || viewport.height <= 0) throw new Error('Invalid screenshot viewport');
    // Match Playwright 1.63's device-scale viewport clip, including zoom rounding.
    const clip = { x: pageX, y: pageY, width: Math.floor(viewport.width / scale + 1e-3),
      height: Math.floor(viewport.height / scale + 1e-3), scale };
    // Keep native script execution live: disabling it discards pending rAF
    // callbacks and permanently stops self-scheduling application loops.
    const { data } = await stage('native-capture', () => session.capture({
      format: 'png', clip, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
    }));
    const bytes = await stage('transport-decode', () => Promise.resolve(decodeProtocolPng(data)));
    return bytes;
  } finally {
    const started = performance.now(); let state = 'complete';
    try { await session.detach(); }
    catch (error) { state = 'unavailable'; console.log(`boot-capture cleanup unavailable: ${String(error)}`); }
    console.log(`boot-capture ${JSON.stringify({ label, stage: 'native-cleanup', state, ms: performance.now() - started })}`);
  }
}
