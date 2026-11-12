#!/usr/bin/env node
// MMO-PLAN MP2.4, the Name prompt (Jake, 2026-11-11: "Ask the user for their name and what they should be called after they hit play but
// before we pop them into the world"), on the rig of `online-proof.mjs`: two real browsers, one world, Names claimed on Postgres (PGlite
// over a socket, so no Postgres install is needed). It fails unless:
//   - a phone's first PLAY (headless WebKit, an iPhone at 402×874) shows the prompt over the title, with no chat or mic over it;
//   - a refused Name is refused inline by the server's rule, and the field and buttons stay clear of a phone's keyboard;
//   - the Name typed is what the other page reads, as `Name#1234`;
//   - Skip (Chromium, desktop) keeps the default Name, which the other page reads as `Guest#1234`;
//   - a second PLAY skips the prompt.
//   scripts/browser-lane.sh node scripts/name-prompt-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { intoWorld, openRig, PG_PORT } from './online-rig.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: name-prompt-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const shots = process.argv.find(value => value.startsWith('--shots='))?.slice(8) ?? join(homedir(), '.cache/wildshard/plan-artifacts/qa');
mkdirSync(shots, { recursive: true }); mkdirSync(work, { recursive: true });

/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

// Postgres for the door's Name claims: PGlite behind the wire protocol, and a pg_ctl that has nothing to start
const pglite = new PGlite(), socket = new PGLiteSocketServer({ db: pglite, port: PG_PORT, host: '127.0.0.1' });
await socket.start();
const pgBin = join(work, 'pg-bin'); mkdirSync(pgBin, { recursive: true });
writeFileSync(join(pgBin, 'pg_ctl'), '#!/bin/sh\nexit 0\n'); chmodSync(join(pgBin, 'pg_ctl'), 0o755);
const rig = await openRig({ dist, work, keyFile, pgBin, pgData: join(work, 'pg-data'), shard: 'driftwood-isle' });

const phoneBrowser = await webkit.launch({ headless: true });
const deskBrowser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _phoneEngine, ...iphone } = devices['iPhone 15 Pro'];
const phoneDevice = { ...iphone, viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 } };
/** @param {import('playwright').Browser} browser @param {Record<string, unknown>} device */
const open = async (browser, device) => {
  const context = await browser.newContext(device), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  return { context, page, errors };
};
/** @param {import('playwright').Page} page */
const title = async page => { await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' }); await page.locator('.ws-main-select').waitFor({ timeout: 150_000 }); };
/** @param {import('playwright').Page} page */
const others = page => page.evaluate(() => window.__onlinePlayers?.() ?? []);
/** @param {import('playwright').Page} page @param {(rows: readonly { name: string }[]) => boolean} seen @param {string} step */
const seeing = async (page, seen, step) => { for (let tries = 0; tries < 120; tries++) { const rows = await others(page); if (seen(rows)) { note(step, true, rows.map(row => row.name)); return; } await page.waitForTimeout(250); } note(step, false, (await others(page)).map(row => row.name)); };
/** @param {import('playwright').Page} page @param {string} name */
const shot = (page, name) => page.screenshot({ path: join(shots, `nameprompt-${name}.png`) });
/** @param {import('playwright').Page} page */
const overlays = page => page.evaluate(() => ({ chat: document.querySelector('#ws-chat') !== null, mic: document.querySelector('#ws-voice') !== null }));
const TAG = /^(?<name>.+)#\d{4}$/u;

let code = 1;
const opened = [await open(phoneBrowser, phoneDevice), await open(deskBrowser, { viewport: { width: 1280, height: 800 } })];
const [phone, desk] = opened;
try {
  if (phone === undefined || desk === undefined) throw new Error('no pages');
  // ── the phone: first PLAY ──
  await title(phone.page);
  note('the title shows no prompt before PLAY', await phone.page.locator('#ws-name-box').count() === 0);
  await phone.page.locator('.ws-main-select').tap();
  const box = phone.page.locator('#ws-name-box');
  await box.waitFor({ timeout: 10_000 });
  note('a first PLAY shows the prompt (WebKit, iPhone 402×874)', await box.isVisible(), { asks: await box.locator('label').textContent() });
  note('no chat or mic over the prompt', JSON.stringify(await overlays(phone.page)) === JSON.stringify({ chat: false, mic: false }));
  await shot(phone.page, '1-webkit-phone-prompt');
  await box.locator('input').fill('arse');
  await box.locator('button[type=submit]').tap();
  const refused = await box.locator('[role=alert]').textContent();
  note('a refused Name is refused inline, by the server\'s rule', await box.locator('[role=alert]').isVisible() && refused === 'That name isn\'t allowed. Try another one.', { refused });
  await shot(phone.page, '2-webkit-phone-refused');
  // the phone's keyboard: iOS keeps the layout viewport and shrinks the visual one (~336 pt of keyboard and its bar on a 402×874 phone)
  await phone.page.setViewportSize({ width: 402, height: 874 - 336 });
  await phone.page.waitForTimeout(300);
  const clear = await phone.page.evaluate(() => {
    const visible = window.visualViewport?.height ?? innerHeight, bottom = (/** @type {string} */ selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? Infinity;
    return { visible, field: bottom('#ws-name-box input'), go: bottom('#ws-name-box button[type=submit]'), skip: bottom('#ws-name-box [data-name=skip]') };
  });
  note('the field and both buttons stay above the keyboard', clear.field <= clear.visible && clear.go <= clear.visible && clear.skip <= clear.visible, clear);
  await shot(phone.page, '3-webkit-phone-keyboard');
  await phone.page.setViewportSize({ width: 402, height: 874 });
  await box.locator('input').fill('Jake');
  await box.locator('button[type=submit]').tap();
  await box.waitFor({ state: 'detached', timeout: 10_000 });
  note('Let\'s go closes the prompt and goes on into the world', true);
  await intoWorld(phone.page);

  // ── the desktop: SHARD SELECT asks, Skip keeps the default ──
  await title(desk.page);
  await desk.page.locator('.ws-main-select').click();
  const deskBox = desk.page.locator('#ws-name-box');
  await deskBox.waitFor({ timeout: 10_000 });
  note('a first PLAY shows the prompt (Chromium, desktop)', await deskBox.isVisible());
  await shot(desk.page, '4-chromium-desktop-prompt');
  await deskBox.locator('[data-name=skip]').click();
  await deskBox.waitFor({ state: 'detached', timeout: 10_000 });
  note('Skip goes on to SHARD SELECT', await desk.page.locator('.ws-title-stack[data-screen="select"]').count() === 1);
  // into the same world by its own link: asked once per device, so no prompt on the way in
  await desk.page.goto(`${rig.base}/?chunk=driftwood-isle&mute=1&nolock=1&skipintro=1`, { waitUntil: 'load' });
  await intoWorld(desk.page);
  note('a page this device enters again does not ask', await desk.page.locator('#ws-name-box').count() === 0);

  // ── what others read ──
  await seeing(desk.page, rows => rows.some(row => TAG.exec(row.name)?.groups?.name === 'Jake'), 'the desktop reads the phone\'s typed Name as Jake#1234');
  await seeing(phone.page, rows => rows.some(row => TAG.exec(row.name)?.groups?.name === 'Guest'), 'the phone reads the skipped desktop as Guest#1234');
  await shot(phone.page, '5-webkit-phone-in-world');
  await shot(desk.page, '6-chromium-desktop-in-world');

  // ── a second PLAY ──
  await title(phone.page);
  await phone.page.locator('.ws-main-select').tap();
  await phone.page.waitForTimeout(3000);
  note('a second PLAY skips the prompt', await phone.page.locator('#ws-name-box').count() === 0);
  await shot(phone.page, '7-webkit-phone-second-play');
  note('no page errors', phone.errors.length === 0 && desk.errors.length === 0, { phone: phone.errors, desk: desk.errors });
  code = steps.every(step => step.ok) ? 0 : 1;
} catch (error) {
  note('the proof ran to its end', false, String(error));
  for (const [index, each] of opened.entries()) await each.page.screenshot({ path: join(shots, `nameprompt-fail-${String(index)}.png`) }).catch(() => undefined);
} finally {
  writeFileSync(join(work, 'name-prompt-proof.json'), JSON.stringify({ steps }, null, 2));
  for (const each of opened) await each.context.close().catch(() => undefined);
  await phoneBrowser.close(); await deskBrowser.close();
  await rig.close();
  await socket.stop(); await pglite.close();
}
console.log(code === 0 ? 'name prompt proof: PASS' : 'name prompt proof: FAIL');
process.exit(code);
