#!/usr/bin/env node
// MOBILE-GRAPHICS MG8 / MG9 (meta docs/plans/MOBILE-GRAPHICS-PLAN.md): every Settings ▸ Graphics control, step by step, on the
// same Driftwood views, driven through the real menu (layout A's Graphics tab, the way a thumb does it).
//
// Headless Chromium (ANGLE Metal), an iPhone 16 Pro viewport (402×874 at 3×), the phone tier, Driftwood entered straight. Per
// step: open the menu, press High (the baseline), set the one control, resume, then at each view a full shot (HUD hidden), a 3×
// crop and the frame's cost:
//   · GPU ms per frame: 5 runs of 24 back-to-back frames (the sky's shadow cadence stepped, then the composer), timed with
//     EXT_disjoint_timer_query_webgl2, the median run
//   · draws and triangles, the mean of 8 such frames; the drawing buffer's size
// plus the menu itself on Low, High and Custom, and the in-world toggle (A) at rest, tapped and on Custom.
//   scripts/browser-lane.sh node scripts/gfx-toggle/compare.mjs --base <serve-build url> --out <dir> [--only shadows,bloom]
// Indicative: an Apple-silicon GPU is not held back by pixel count the way a phone is. Read each step against High.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { developerSettings, saveFixture, hideDeveloperOverlays } from '../debug-settings.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' }, only: { type: 'string' } } });
if (values.base === undefined || values.out === undefined) { console.error('usage: compare.mjs --base <url> --out <dir> [--only <ids>]'); process.exit(2); }
const base = values.base.replace(/\/$/u, ''), out = values.out;
mkdirSync(out, { recursive: true });
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
/** @type {Record<string, { yaw: number | null, pitch: number }>} */
const VIEWS = { pier: { yaw: Math.PI, pitch: -0.06 }, sun: { yaw: null, pitch: 0.05 } };
const CROP = { x: 150, y: 330, width: 200, height: 200 };
/** each step: an id, the control's row label and button text in the Graphics tab (null: a preset card), and its views */
const STEPS = [
  { id: 'high', preset: 'high', views: ['pier', 'sun'] }, { id: 'low', preset: 'low', views: ['pier', 'sun'] },
  { id: 'density-1.5', row: 'Pixel density', button: '1.5×', views: ['pier'] }, { id: 'density-1.25', row: 'Pixel density', button: '1.25×', views: ['pier'] },
  { id: 'density-1', row: 'Pixel density', button: '1×', views: ['pier'] },
  { id: 'shadows-off', row: 'Sun shadows', button: 'Off', views: ['pier'] },
  { id: 'bloom-on', row: 'Bloom', button: 'On', views: ['pier', 'sun'] }, { id: 'rays-on', row: 'Sun rays', button: 'On', views: ['pier', 'sun'] },
  { id: 'aa-off', row: 'Anti-aliasing', button: 'Off', views: ['pier'] },
];
const only = values.only?.split(',') ?? null;

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ ...devices['iPhone 16 Pro'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
await developerSettings(context, { tier: 'phone', volume: 0 });
await saveFixture(context, { scope: 'device', key: 'devMode', data: false });
await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
await saveFixture(context, { scope: 'device', key: 'debug.settingsLayout', data: 'a' });
await saveFixture(context, { scope: 'device', key: 'gfx.worldToggle', data: true });
await context.addInitScript(hideDeveloperOverlays);
const page = await context.newPage();
page.setDefaultTimeout(240_000);
page.on('pageerror', error => { console.log('pageerror', String(error).slice(0, 300)); });

/** a press as a thumb makes it (listenTap answers pointerup) @param {string} expression the element */
const press = expression => page.evaluate(`(() => { const e = ${expression}; if (!e) return false;
  e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
const openMenu = async () => { await press(`document.querySelector('.ws-touch-pause')`); await sleep(900); };
const resume = async () => { await press(`[...document.querySelectorAll('.ws-gmenu button')].find(b => b.getClientRects().length && /^\\s*resume\\s*$/i.test(b.textContent))`); await sleep(600); };
/** @param {'low'|'high'} mode */
const preset = mode => press(`document.querySelector('.ws-gmenu-svmodecard[data-mode="${mode}"]')`);
/** @param {string} row @param {string} button */
const control = (row, button) => press(`(() => {
  const r = [...document.querySelectorAll('.ws-gmenu-gfx .ws-gmenu-row')].find(x => x.querySelector('.ws-gmenu-swlabel')?.textContent.trim() === ${JSON.stringify(row)});
  return r === undefined ? null : [...r.querySelectorAll('.ws-gmenu-segbtn')].find(x => x.textContent.trim() === ${JSON.stringify(button)}) ?? null; })()`);
/** @param {{ yaw: number | null, pitch: number }} view */
async function pose(view) {
  await page.evaluate(`(() => { const w = window.__wildshard.world, p = w.player, s = w.game.level.spawn, d = w.game.sky.sunDir;
    p.spawn(s.x, s.z, ${view.yaw === null ? 'Math.atan2(-d.x, -d.z)' : String(view.yaw)}, s.y); p.pitch = ${String(view.pitch)}; p.velocity.set(0, 0, 0); })()`);
  await sleep(2500);
}
const cost = () => page.evaluate(`(async () => {
  const g = window.__wildshard.world.game, r = g.renderer, gl = r.getContext(), px = new Uint8Array(4), gpu = [];
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const sync = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  for (let k = 0; k < 5; k++) { g.sky.update(0); g.composer.render(0.016); } sync();
  for (let run = 0; run < 5 && ext !== null; run++) {
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let k = 0; k < 24; k++) { g.sky.update(0); g.composer.render(0.016); }
    gl.endQuery(ext.TIME_ELAPSED_EXT); sync();
    for (let wait = 0; wait < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); wait++) await new Promise(f => setTimeout(f, 5));
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / 24);
    gl.deleteQuery(q);
  }
  gpu.sort((a, b) => a - b);
  const auto = r.info.autoReset; r.info.autoReset = false; r.info.reset();
  for (let k = 0; k < 8; k++) { g.sky.update(0); g.composer.render(0.016); }
  const calls = Math.round(r.info.render.calls / 8), tris = r.info.render.triangles / 8; r.info.reset(); r.info.autoReset = auto;
  return { gpu: gpu[Math.floor(gpu.length / 2)] ?? null, calls, tris, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], samples: g.composer.inputBuffer.samples,
    passes: g.composer.passes.map(p => p.name + (p.effects ? '[' + p.effects.map(e => e.name.replace('Effect', '')).join(',') + ']' : '')).join(' ') };
})()`);
/** @param {string} name */
async function shots(name) {
  await page.evaluate(`document.getElementById('hud').style.visibility = 'hidden'`);
  await sleep(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.screenshot({ path: join(out, `${name}-crop.png`), clip: CROP });
  await page.evaluate(`document.getElementById('hud').style.visibility = ''`);
}

const results = [];
try {
  await page.goto(`${base}/?chunk=driftwood-isle&tier=phone&mute=1&nolock=1&sw=0&skipintro=1`);
  await page.waitForFunction(`(() => { const w = window.__wildshard?.world; try { return !!w?.hud.entered && w.game.frameGate() && !document.querySelector('.ws-load'); } catch { return false; } })()`, null, { timeout: 240_000, polling: 300 });
  await sleep(3000);
  for (const step of STEPS) {
    if (only !== null && !only.includes(step.id)) continue;
    await openMenu();
    await preset(step.preset === 'low' ? 'low' : 'high'); await sleep(300);
    if (step.row !== undefined && !await control(step.row, step.button)) throw new Error(`no ${step.row} ${step.button}`);
    await sleep(500);
    const label = await page.evaluate(`document.querySelector('.ws-gmenu-svmodecard.active')?.dataset.mode ?? '?'`);
    await resume();
    for (const view of step.views) {
      await pose(VIEWS[view]);
      const c = await cost();
      await shots(`${step.id}-${view}`);
      results.push({ step: step.id, view, label, ...c });
      console.log(`${`${step.id}-${view}`.padEnd(18)} ${label.padEnd(6)} gpu ${c.gpu === null ? 'n/a' : c.gpu.toFixed(2)} ms · ${c.calls} draws · ${(c.tris / 1e6).toFixed(2)} M tris · ${c.buffer.join('×')} · msaa ${c.samples} · ${c.passes}`);
    }
  }
  // the Graphics tab on High, Low and Custom (High with Bloom on), and the in-world toggle A: rest, tapped, Custom
  if (only === null || only.includes('menu')) {
    for (const [name, setup] of /** @type {const} */ ([['menu-high', async () => { await preset('high'); }], ['menu-low', async () => { await preset('low'); }],
      ['menu-custom', async () => { await preset('high'); await sleep(200); await control('Bloom', 'On'); }]])) {
      await openMenu(); await setup(); await sleep(3000); // the readout's fps settles (it counts half-second windows)
      await page.screenshot({ path: join(out, `${name}.png`) });
      await resume();
    }
    await pose(VIEWS.pier); await sleep(11_000);
    await page.screenshot({ path: join(out, 'toggle-custom.png') }); // still Custom from the last menu shot
    await press(`document.querySelector('.ws-firstplay-va button[data-v="high"]')`);
    for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) { await page.screenshot({ path: join(out, `toggle-t${String(s).padStart(2, '0')}.png`) }); await sleep(1000); }
  }
  writeFileSync(join(out, 'costs.json'), `${JSON.stringify(results, null, 1)}\n`);
} finally { await browser.close(); }
