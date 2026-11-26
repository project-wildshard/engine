#!/usr/bin/env node
// The flat-frame check (meta ALPHA-2-TRAILER AT16). Nalati Grasslands entered through the grid drew one flat colour that
// drifted with the camera (black, olive, tan, lavender) with the AO pass on: the Memory saver had let go of n8ao's shared
// fullscreen triangle's uv, a composer rebuild in the page disposed it, and the next AO pass uploaded it zero-filled, so
// every AO quad sampled one texel. This boots a zone the way a player comes in (the title's MMO card, then a walk into its
// cell, src/scripts/trailer/grid.mjs), checks the AO pass is on, and fails when the world frame's centre is one colour.
//
//   node src/scripts/trailer/flat-frame-check.mjs --base http://127.0.0.1:4426/ [--zone nalati-grasslands] [--time golden]
//        [--weather clear] [--settle 4000] [--no-lock]
//
// --base is a served build with the staging grid (`node src/scripts/dev.mjs --staging --shard <zone> --no-watch`, or a
// preview). Headless Chromium on Metal, muted, with the keychain flags, under desktop-gpu.lock. Exit 0: the frame is whole;
// 1: flat, or the AO pass is off; 2: usage.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** The smallest per-channel spread (0-255 levels) a drawn world's centre has. A whole Nalati frame reads 17-45 per channel;
 *  the flat frame read exactly 0. */
export const FLAT_SPREAD = 2;

/**
 * The per-channel mean and spread (population standard deviation, 0-255) of the centre `share` of an RGBA image.
 * @param {ArrayLike<number>} rgba @param {number} width @param {number} height @param {number} [share]
 * @returns {{ mean: number[], spread: number[], pixels: number }}
 */
export function centreSpread(rgba, width, height, share = 0.4) {
  const w = Math.max(1, Math.floor(width * share)), h = Math.max(1, Math.floor(height * share));
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2);
  const sum = [0, 0, 0], sq = [0, 0, 0];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * width + x) * 4;
    for (let k = 0; k < 3; k++) { const v = rgba[i + k] ?? 0; sum[k] += v; sq[k] += v * v; }
  }
  const n = w * h, mean = sum.map(v => v / n);
  return { mean, spread: sq.map((v, k) => Math.sqrt(Math.max(0, v / n - (mean[k] ?? 0) ** 2))), pixels: n };
}

/** Why the frame is flat, or null when it is whole. @param {{ spread: readonly number[], pixels: number }} sample */
export function flatFrame(sample) {
  if (!(sample.pixels > 0) || sample.spread.length !== 3 || sample.spread.some(v => !Number.isFinite(v))) return 'no frame to judge';
  const widest = Math.max(...sample.spread);
  return widest < FLAT_SPREAD ? `the frame's centre is one colour (widest channel spread ${widest.toFixed(2)} < ${String(FLAT_SPREAD)})` : null;
}

/** Runs in the page: the world canvas's next frame, 320 px wide, as its centre spread (no HUD: the canvas alone). */
async function pageSample() {
  const game = window.__wildshard.requireWorld().game;
  const canvas = await game.captureFrame(320);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('flat-frame-check: no 2d context for the frame copy');
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const passes = game._composer?.passes ?? [];
  return { width: canvas.width, height: canvas.height, data: Array.from(data), ao: passes.some(p => typeof p.configureAOPass === 'function' && p.enabled) };
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    base: { type: 'string' }, zone: { type: 'string', default: 'nalati-grasslands' }, time: { type: 'string', default: 'golden' },
    weather: { type: 'string', default: 'clear' }, settle: { type: 'string', default: '4000' }, 'no-lock': { type: 'boolean', default: false },
  } });
  if (values.base === undefined) { console.error('usage: node src/scripts/trailer/flat-frame-check.mjs --base <served build URL> [--zone <slug>]'); return 2; }
  if (!values['no-lock'] && process.env.WS_FLAT_LOCKED !== '1') {
    const { underDesktopGpuLock } = await import('../memory/iphone/locks.mjs');
    process.env.WS_FLAT_LOCKED = '1';
    return underDesktopGpuLock(import.meta.filename, argv);
  }
  const { chromium } = await import('../browser-playwright.mjs');
  const { KEYCHAIN_ARGS } = await import('../.kit/chromium-keychain.mjs');
  const { NAME_ASKED, developerSettings, hideDeveloperOverlays, saveFixture } = await import('../debug-settings.mjs');
  const { enterCell, enterGrid } = await import('./grid.mjs');
  const base = values.base.replace(/\/?$/u, '/');
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await developerSettings(ctx, { tier: 'desktop', volume: 0, time: values.time, weather: values.weather });
    await ctx.addInitScript(hideDeveloperOverlays);
    await saveFixture(ctx, NAME_ASKED);
    await ctx.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    // the title's MMO card, as a player comes in (no zone in the address, J522), then a walk into the zone's cell
    await enterGrid(page, `${base}?mute=1&nolock=1&sw=0`);
    await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)), null, { timeout: 300000, polling: 500 });
    const failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
    if (failure) throw new Error(failure);
    await page.waitForFunction(() => { const w = window.__wildshard?.world; if (w?.hud && !w.hud.entered) { try { window.__wildshard.requireWorld().hud.enterNow(); } catch { /* not ready */ } } return Boolean(w?.hud?.entered && !document.querySelector('.ws-load')); }, null, { timeout: 300000, polling: 1000 });
    await enterCell(page, values.zone);
    await page.waitForTimeout(Number(values.settle));
    const shot = await page.evaluate(pageSample);
    const sample = centreSpread(shot.data, shot.width, shot.height);
    const why = shot.ao ? flatFrame(sample) : 'the AO pass is off: this check judges the frame with it on';
    console.log(JSON.stringify({ zone: values.zone, ao: shot.ao, mean: sample.mean.map(v => +v.toFixed(1)), spread: sample.spread.map(v => +v.toFixed(2)), flat: why }));
    if (why !== null) { console.error(`flat-frame-check ${values.zone}: ${why}`); return 1; }
    return 0;
  } finally { await browser.close(); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
