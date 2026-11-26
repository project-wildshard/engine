#!/usr/bin/env node
// MIRROR-SALT-ZONE MSZ12b: the touch tape. Drives a vehicle by touch on phone WebKit: walks up to a dock, taps the USE band to
// take the driver's seat, pushes the move stick (with BOOST held for a stretch) until the vehicle has gone 20 m, holds BRAKE
// until the gauge reads N, then taps LEAVE. It shoots the seated HUD at rest and on the move, for a blind board.
// It needs a served build with a vehicle dock: Mirror Salt's local build (its yard buggy is the default dock), served by
// `wildshard dev`.
//   src/scripts/browser-lane.sh --max 10 node src/scripts/parity/vehicle-touch.mjs --url=http://127.0.0.1:<port>/ --out=tmp/<lane>/touch
//   [--dock=<x>,<z>] the dock's spot (default Mirror Salt's yard buggy, -22,154); the player stands 1.2 m west of it, facing it
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devices, webkit } from '../browser-playwright.mjs';
import { NAME_ASKED, saveFixture } from '../debug-settings.mjs';
import { installLegacyProbeAdapter } from './probe.mjs';

const option = (/** @type {string} */ key) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const base = option('url');
if (base === undefined) throw new Error('Use --url=<a served build with a vehicle dock> --out=<folder>');
const out = resolve(option('out') ?? 'tmp/vehicle-touch'); mkdirSync(out, { recursive: true });
const [dockX = -22, dockZ = 154] = (option('dock') ?? '').split(',').filter(Boolean).map(Number);

/** What the page shows of the seat: the drive discs, the gauge's lit gear, the speed bar's fill, where the player is. */
function observe() {
  const api = /** @type {import('../../client/engine/debug/probe').EngineProbe | undefined} */ (window.__wildshard), world = api?.world;
  const layer = document.querySelector('.ws-touch');
  const shown = [...document.querySelectorAll('[class*="ws-touch-drive-"]')].filter(el => el.classList.contains('show')).map(el => [...el.classList].find(name => name.startsWith('ws-touch-drive-')) ?? '');
  const walk = ['.ws-touch-attack', '.ws-touch-disc.jump', '.ws-touch-disc.dodge', '.ws-touch-hover'].filter(selector => {
    const el = document.querySelector(selector); return el instanceof HTMLElement && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
  });
  const gear = document.querySelector('.ws-quest-steer-gears b.on')?.textContent ?? null;
  const fill = document.querySelector('.ws-quest-steer-fill');
  return { state: world?.game.app.state ?? null, seated: layer?.classList.contains('ws-touch-drive-seated') ?? false, shown, walk, gear,
    fill: fill instanceof HTMLElement ? fill.style.width || fill.style.transform : null,
    use: document.querySelector('.ws-touch-use.show')?.textContent?.trim() ?? null,
    vehicle: /** @type {any} */ (window).__workerClient?.()?.vehicle ?? null,
    feet: world === undefined ? null : { x: world.player.position.x, y: world.player.position.y, z: world.player.position.z } };
}

/** A touch on the layer at (x, y), as the phone's finger: pointer events of type touch, the way TouchControls reads them. */
function finger(/** @type {{ id: number, type: string, x: number, y: number, at?: string }} */ touch) {
  const target = touch.at === undefined ? document.querySelector('.ws-touch') : document.querySelector(touch.at);
  if (!(target instanceof HTMLElement)) throw new Error(`No ${touch.at ?? '.ws-touch'}`);
  const box = target.getBoundingClientRect();
  const x = touch.at === undefined ? touch.x : box.x + box.width / 2, y = touch.at === undefined ? touch.y : box.y + box.height / 2;
  target.dispatchEvent(new PointerEvent(touch.type, { pointerId: touch.id, pointerType: 'touch', isPrimary: touch.id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: touch.type === 'pointerup' ? 0 : 1 }));
}

const browser = await webkit.launch();
/** @type {Record<string, unknown>} */ const result = { pass: false, dock: { x: dockX, z: dockZ } };
const fails = /** @type {string[]} */ ([]), faults = /** @type {string[]} */ ([]);
let phase = 'navigate';
const context = await browser.newContext({ ...devices['iPhone 16 Pro'], serviceWorkers: 'block' });
const page = await context.newPage();
try {
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true }); await saveFixture(context, NAME_ASKED);
  await context.addInitScript(installLegacyProbeAdapter);
  await context.addInitScript(() => { window.__wildshardHarness = { seed: 357, capture: null }; });
  page.on('pageerror', error => { faults.push(error.message); });
  const url = new URL(base);
  for (const [key, value] of Object.entries({ tier: 'phone', touch: '1', mute: '1', nolock: '1', sw: '0', skipintro: '1' })) url.searchParams.set(key, value);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  phase = 'play';
  await page.waitForFunction(() => window.__wildshard?.world?.game.app.state === 'play' && !document.querySelector('#hud.intro,.ws-reveal'), undefined, { timeout: 180_000 });
  await page.waitForTimeout(2000);
  // the first-visit mic tip (voiceUi.ts) sits over the gauge's left end on a portrait phone: closed, as a player closes it
  const tip = page.locator('#ws-voice-tip:not([hidden]) button');
  if (await tip.isVisible().catch(() => false)) await tip.tap().catch(() => undefined);
  phase = 'walk-up';
  const stand = { x: dockX - 1.2, z: dockZ + 0.3 }; // a prompt's reach is from the eye (1.68 m up) to the dock's ground spot
  await page.evaluate(async at => { await window.__wildshard.pose({ x: at.x, y: 1, z: at.z, yaw: -Math.PI / 2, pitch: -0.15 }); }, stand);
  phase = 'use-band';
  await page.locator('.ws-touch-use.show').waitFor({ state: 'visible', timeout: 20_000 });
  result.prompt = await page.evaluate(observe);
  await page.locator('.ws-touch-use.show').tap();
  phase = 'seated';
  await page.waitForFunction(() => document.querySelector('.ws-touch')?.classList.contains('ws-touch-drive-seated') === true, undefined, { timeout: 10_000 });
  await page.waitForTimeout(800);
  const seated = await page.evaluate(observe); result.seated = seated;
  await page.screenshot({ path: join(out, '1-seated-rest.png') });
  for (const cls of ['ws-touch-drive-brake', 'ws-touch-drive-boost', 'ws-touch-drive-horn', 'ws-touch-drive-leave']) if (!seated.shown.includes(cls)) fails.push(`seated, ${cls} does not show`);
  if (seated.walk.length > 0) fails.push(`seated, the walk's discs still show: ${seated.walk.join(' ')}`);
  phase = 'drive';
  const stick = await page.evaluate(() => { const box = document.querySelector('.ws-touch-stick')?.getBoundingClientRect(); if (box === undefined) throw new Error('No move stick'); return { x: box.x + box.width / 2, y: box.y + box.height / 2, reach: box.height / 2 }; });
  const from = seated.feet ?? { x: 0, y: 0, z: 0 };
  const gone = async () => { const now = await page.evaluate(observe); return now.feet === null ? 0 : Math.hypot(now.feet.x - from.x, now.feet.z - from.z); };
  await page.evaluate(finger, { id: 11, type: 'pointerdown', x: stick.x, y: stick.y });
  for (let step = 1; step <= 6; step++) await page.evaluate(finger, { id: 11, type: 'pointermove', x: stick.x, y: stick.y - stick.reach * 0.8 * step / 6 });
  const t0 = Date.now(); let boosted = false, moving = null;
  while (await gone() < 20 && Date.now() - t0 < 20_000) {
    if (!boosted && Date.now() - t0 > 1500) { await page.evaluate(finger, { id: 12, type: 'pointerdown', x: 0, y: 0, at: '.ws-touch-drive-boost' }); boosted = true; }
    if (moving === null && await gone() > 8) { moving = await page.evaluate(observe); await page.screenshot({ path: join(out, '2-seated-driving.png') }); }
    await page.waitForTimeout(100);
  }
  if (boosted) await page.evaluate(finger, { id: 12, type: 'pointerup', x: 0, y: 0, at: '.ws-touch-drive-boost' });
  await page.evaluate(finger, { id: 11, type: 'pointerup', x: stick.x, y: stick.y - stick.reach * 0.8 });
  result.driven = { metres: Math.round(await gone() * 10) / 10, seconds: (Date.now() - t0) / 1000, moving };
  if (await gone() < 20) fails.push(`the stick drove ${Math.round(await gone() * 10) / 10} m, not 20`);
  if (moving !== null && moving.gear !== 'D') fails.push(`on the move the gauge read ${moving.gear}, not D`);
  phase = 'brake';
  await page.evaluate(finger, { id: 13, type: 'pointerdown', x: 0, y: 0, at: '.ws-touch-drive-brake' });
  const b0 = Date.now(); let stopped = null;
  while (Date.now() - b0 < 8000) {
    const a = await gone(); await page.waitForTimeout(250); const now = await page.evaluate(observe);
    if (now.gear === 'N' && Math.abs(await gone() - a) < 0.05) { stopped = now; break; }
  }
  await page.evaluate(finger, { id: 13, type: 'pointerup', x: 0, y: 0, at: '.ws-touch-drive-brake' });
  result.braked = { seconds: (Date.now() - b0) / 1000, stopped };
  if (stopped === null) fails.push('BRAKE did not bring the gauge to N at a standstill in 8 s');
  await page.screenshot({ path: join(out, '3-braked.png') });
  phase = 'leave';
  await page.locator('.ws-touch-drive-leave').tap();
  await page.waitForFunction(() => document.querySelector('.ws-touch')?.classList.contains('ws-touch-drive-seated') === false, undefined, { timeout: 5000 }).catch(() => { fails.push('LEAVE did not leave the seat'); });
  await page.waitForTimeout(600);
  const left = await page.evaluate(observe); result.left = left;
  await page.screenshot({ path: join(out, '4-left.png') });
  if (left.shown.length > 0) fails.push(`after LEAVE the drive discs still show: ${left.shown.join(' ')}`);
  fails.push(...faults);
} catch (error) {
  fails.push(`${phase}: ${String(error)}`);
  result.after = await page.evaluate(observe).catch(() => null);
  await page.screenshot({ path: join(out, `failure-${phase}.png`) }).catch(() => undefined);
} finally { await context.close(); await browser.close(); }
result.pass = fails.length === 0; result.fails = fails;
writeFileSync(join(out, 'vehicle-touch.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 1));
console.log(fails.length > 0 ? `FAIL ${JSON.stringify(fails)}` : 'PASS');
process.exitCode = fails.length > 0 ? 1 : 0;
