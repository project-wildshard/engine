#!/usr/bin/env node
// SENTRY-TRIAGE S13 (WILDSHARD-GAME-8H): a GPU-process restart on an online page lands back in the world, not on the title.
// Boot Driftwood by its Shard Select card (a staging guest seat, every socket guarded to the staging door, J205), stand past the
// phone's 20 s fragile boot, then make the restart GpuRecovery reads: every 2D canvas reads back wiped and the WebGL context is lost.
// The page must reload once with `?glreload` and `?at=`, skip the title, and reach gameplay again near where it stood.
//   src/scripts/browser-lane.sh --max 15 node src/scripts/gpu-recovery-proof.mjs --base=https://staging.wildshard.io --out=<dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', ''));
if (!/^https:\/\/(preview|staging)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: gpu-recovery-proof.mjs --base=<staging, preview or loopback url> --out=<dir>');
const staging = base === 'https://staging.wildshard.io';
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });
const result = { base, at: new Date().toISOString(), build: '', navigations: /** @type {string[]} */ ([]), before: /** @type {unknown} */ (null), after: /** @type {unknown} */ (null), title: false, reloadedTo: '', landed: '', recovery: /** @type {unknown} */ (null), console: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]), pass: false };
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (staging) await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  const page = await context.newPage();
  page.on('console', message => { const text = message.text(); if (/\[gl\]|recover|faults|grid\] |title/iu.test(text)) result.console.push(`${message.type()}: ${text.slice(0, 240)}`); });
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) result.navigations.push(frame.url()); });
  await page.goto(`${base}/?mute=1&nolock=1&fps=60`, { waitUntil: 'load' });
  result.build = await page.evaluate(() => fetch('/version.json').then(r => r.json()).then(v => String(v.build ?? v.version ?? '')).catch(() => ''));
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('gpu'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood')));
  if (index < 0) throw new Error('No Driftwood card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  const ready = () => page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 250 });
  await ready();
  await sleep(22_000); // past the phone's fragile boot window, so this is the stable-world path on any tier
  const pose = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: Math.round(p.x), z: Math.round(p.z), url: location.href }; });
  result.before = await pose();
  await page.screenshot({ path: join(out, 'before.png') });
  const reload = page.waitForEvent('load', { timeout: 60_000 });
  // the restart GpuRecovery reads: its sentinel canvas reads back wiped, then the context goes
  await page.evaluate(() => {
    CanvasRenderingContext2D.prototype.getImageData = function getImageData(/** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ w, /** @type {number} */ h) { return new ImageData(Math.max(1, w), Math.max(1, h)); };
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await reload;
  result.reloadedTo = page.url();
  // back in the world, or on the title (the bug): whichever shows first
  result.landed = await Promise.race([
    ready().then(() => 'world'),
    page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'title'),
  ]).catch((/** @type {unknown} */ error) => `neither: ${String(error).slice(0, 120)}`);
  if (result.landed === 'world') await sleep(3000);
  result.after = await pose().catch(() => null);
  result.recovery = await page.evaluate(() => { try { return Object.keys(localStorage).filter(k => /recover|reload|glreload|lastEnd|life\./iu.test(k)); } catch { return []; } });
  result.title = await page.locator('.ws-main-select').isVisible().catch(() => false);
  await page.screenshot({ path: join(out, 'after.png') });
  const b = /** @type {{ x: number, z: number }} */ (result.before), a = /** @type {{ x: number, z: number }} */ (result.after);
  result.pass = result.landed === 'world' && !result.title && a !== null && Math.hypot(a.x - b.x, a.z - b.z) < 20;
} catch (error) { result.errors.push(`proof: ${String(error).slice(0, 300)}`); }
finally { await browser.close(); }
writeFileSync(join(out, 'gpu-recovery.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ pass: result.pass, build: result.build, landed: result.landed, reloadedTo: result.reloadedTo, before: result.before, after: result.after, title: result.title, errors: result.errors }));
process.exit(result.pass ? 0 : 1);
