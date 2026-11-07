#!/usr/bin/env node
// Disposable F3.2 measurement: full Chromium, Metal, Driftwood phone tier.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:4400';
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'WebGL2 unavailable';
  });
  console.log(`renderer: ${renderer}`);
  if (!renderer.includes('ANGLE (Apple, ANGLE Metal Renderer')) throw new Error(`Metal required: ${renderer}`);
  await context.addInitScript(() => {
    document.addEventListener('ws:ready', () => { document.documentElement.dataset.gpuProbeReadyMs = String(performance.now()); }, { once: true });
  });
  await page.goto(`${url}/?chunk=driftwood-isle&tier=phone&touch=1&skipintro=1&nolock=1&mute=1&sw=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.gpuProbeReadyMs !== undefined && '__wildshard' in window, null, { timeout: 240_000 });
  const record = await page.evaluate(() => ({ renderer: window.__wildshard.boot.renderer, readyMs: Number(document.documentElement.dataset.gpuProbeReadyMs), boot: window.__wildshard.boot }));
  console.log(JSON.stringify(record, null, 2));
  writeFileSync('gpu-probe.json', `${JSON.stringify(record, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 3;
} finally { await browser.close(); }
