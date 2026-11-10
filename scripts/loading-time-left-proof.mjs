#!/usr/bin/env node
// Manual LS5 proof on real boots: the loading card's time left against the real time left, per painted frame.
// Deliberately outside hooks and the unit-test glob. Run through scripts/browser-lane.sh after a full-catalogue build
// (`pnpm build:game`, for Infinite Wildshard's Driftwood):
//   scripts/browser-lane.sh node scripts/loading-time-left-proof.mjs [--profile=desktop,webkit,phone] [--runs=1] [--out=<dir>] [--dump]
// Profiles: desktop = Chromium on this Mac's GPU (ANGLE Metal); webkit; phone = the same Chromium at 4x CPU and the phone
// network of loading-card-proof --throttle (the phone stand-in); swiftshader / swiftshader-phone = headless Chromium's
// software GPU, which the time left hides on (a named exception, J204). Each run is a fresh profile from the title's
// Infinite Wildshard tap, so it is a first visit: every file comes over the network, nothing from the service worker.
// --dump writes each run's Load rows at ready (and modules' Load-phase stretch) and prints the profile's mean seconds per
// row: the source of loadingPaths.ts' measured tables.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { saveFixture } from './debug-settings.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { timeLeftScore } from './loading-time-left-rule.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolvePath(option('root') ?? '.'), out = resolvePath(option('out') ?? 'tmp/time-left');
const profiles = (option('profile') ?? 'desktop,webkit,phone').split(','), runs = Number(option('runs') ?? '1');
const dump = process.argv.includes('--dump');
/** @type {Record<string, {engine: 'chromium' | 'webkit', gpu: boolean, throttle: boolean}>} */
const PROFILES = {
  desktop: { engine: 'chromium', gpu: true, throttle: false }, webkit: { engine: 'webkit', gpu: false, throttle: false },
  phone: { engine: 'chromium', gpu: true, throttle: true },
  swiftshader: { engine: 'chromium', gpu: false, throttle: false }, 'swiftshader-phone': { engine: 'chromium', gpu: false, throttle: true },
};
for (const name of profiles) if (PROFILES[name] === undefined) throw new Error(`Unknown profile ${name}`);
mkdirSync(out, { recursive: true });
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const title = /id="ws-title-rows"[^>]*>(.*?)<\/script>/su.exec(html)?.[1];
if (title === undefined || !(/** @type {{slug: string}[]} */ (JSON.parse(title))).some(row => row.slug === 'driftwood-isle'))
  throw new Error('Built catalogue lacks driftwood-isle; run pnpm build:game');

/** Browser-side recorder: one row per animation frame once the game's card exists. */
function recordTimeLeft() {
  /** @type {{t: number, left: number | null, seconds: number | null}[]} */
  const frames = []; Reflect.set(window, '__timeLeftLog', frames);
  const tick = () => {
    const card = document.querySelector('.ws-load');
    const value = card instanceof HTMLElement ? card.dataset.timeLeft : undefined;
    const text = card?.querySelector('[data-el=left]')?.textContent ?? '';
    const seconds = /(\d+) min (\d+) s/u.exec(text) ?? /(\d+) s/u.exec(text);
    frames.push({ t: performance.now(), left: value === undefined || value === '' ? null : Number(value),
      seconds: value === undefined || value === '' || seconds === null ? null
        : seconds.length === 3 ? Number(seconds[1]) * 60 + Number(seconds[2]) : Number(seconds[1]) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const preview = await serve(root, '', true);
/** @type {{tag: string, score: ReturnType<typeof timeLeftScore>, readyAt: number}[]} */
const report = [];
/** @type {Record<string, Record<string, number[]>>} */
const measured = {};
try {
  for (const name of profiles) {
    const profile = PROFILES[name];
    if (profile === undefined) throw new Error(`Unknown profile ${name}`);
    for (let run = 1; run <= runs; run++) {
      const tag = `${name}-${run}`;
      const browser = await (profile.engine === 'chromium' ? chromium : webkit).launch({ headless: true,
        ...(profile.engine === 'chromium' ? { args: [...KEYCHAIN_ARGS, '--mute-audio', ...(profile.gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [])] } : {}) });
      try {
        const context = await browser.newContext({ ...devices['iPhone 16 Pro'], deviceScaleFactor: 2 });
        await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
        await context.addInitScript(recordTimeLeft);
        const page = await context.newPage();
        /** @type {string[]} */ const faults = [];
        page.on('pageerror', error => faults.push(error.message));
        if (profile.throttle) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await cdp.send('Network.enable');
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6, uploadThroughput: 750e3 / 8 });
        }
        await page.goto(`${preview.url}/?mute=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
        await page.locator('.ws-main-grid').waitFor({ timeout: 60000 });
        const loaded = page.waitForEvent('domcontentloaded', { timeout: 60000 });
        await page.locator('.ws-main-grid').click(); await loaded;
        await page.waitForFunction(() => (Reflect.get(window, '__bootTiming')?.read()?.entries ?? [])
          .some((/** @type {{operation: string}} */ entry) => entry.operation === 'app:control-ready'), null, { timeout: 180000, polling: 200 });
        const result = await page.evaluate(() => {
          const timing = Reflect.get(window, '__bootTiming').read();
          /** @param {string} operation */
          const entry = operation => timing.entries.find((/** @type {{operation: string}} */ row) => row.operation === operation);
          const ready = entry('app:control-ready'), modules = entry('game-stage:modules');
          const card = document.querySelector('.ws-load');
          /** @type {{rows?: {key: string, state: string, ms: number}[]} | undefined} */
          const snapshot = card === null ? undefined : Reflect.get(card, Symbol.for('engine.loading.snapshot'));
          return { readyAt: ready.start, frames: Reflect.get(window, '__timeLeftLog'),
            modulesMs: modules?.end === null || modules === undefined ? null : modules.end - modules.start,
            rows: (snapshot?.rows ?? []).map(({ key, state, ms }) => ({ key, state, ms })) };
        });
        const score = timeLeftScore(result.frames, result.readyAt);
        writeFileSync(join(out, `${tag}.json`), JSON.stringify({ tag, faults, score, ...result }));
        if (faults.length > 0) throw new Error(`${tag}: page faults ${faults.join(' | ')}`);
        report.push({ tag, score, readyAt: result.readyAt });
        if (dump) for (const row of result.rows) {
          const seconds = row.key === 'modules' ? (result.modulesMs ?? 0) / 1000 : row.state === 'todo' ? 0 : row.ms / 1000;
          ((measured[name] ??= {})[row.key] ??= []).push(seconds);
        }
        const s = score, pct = (/** @type {number} */ n) => `${Math.round(100 * n / Math.max(1, s.shown))} %`;
        const first = s.firstShown === null ? 'never' : `${(s.firstShown / 1000).toFixed(1)} s`;
        const worst = s.worstAt === null ? '' : `, worst ${Math.round(100 * s.worst)} % at ${(s.worstAt / 1000).toFixed(1)} s`;
        console.log(`${tag}: ready ${(result.readyAt / 1000).toFixed(1)} s, last half from ${(s.half / 1000).toFixed(1)} s: shown ${s.shown} of ${s.frames} frames `
          + `(${Math.round(100 * s.shown / Math.max(1, s.frames))} %), within 25 % or 0.5 s ${pct(s.within)}, within 25 % ${pct(s.strict)}, `
          + `${s.rises} rises, ${s.flickers} flickers, first shown ${first}${worst}`);
      } finally { await browser.close(); }
    }
  }
} finally { preview.close(); }
if (dump) for (const [name, rows] of Object.entries(measured)) {
  console.log(`${name}: mean seconds per Load row over ${runs} run(s)`);
  console.log(Object.entries(rows).map(([key, values]) => `${key}: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)}`).join(', '));
}
const exceptions = new Set(['swiftshader', 'swiftshader-phone']);
if (report.some(({ tag, score }) => !exceptions.has(tag.replace(/-\d+$/u, '')) && !score.pass)) process.exitCode = 1;
console.log(`runs in ${out}`);
