#!/usr/bin/env node
// ZONE-ENTRY ZE5 and ZE8 (J352): the walls and the gate card, by real input. From Driftwood (Shard Select), step out of its east
// entryway onto the road and shoot Nalati's wall across it; walk into Nalati's west buffer and shoot the gate card at 5 and at 2;
// at 3 back out and shoot it gone; walk in again, read 5 (the reset) and shoot it at 2. Each shot's page state (the gate's cell, count and card text)
// goes in one JSON. `--fire` stands on to 0 and records the zone entry: the navigation, the loading screen and the cell as the new home (ZE10).
//   scripts/browser-lane.sh node scripts/zone-gate-proof.mjs --base=<preview or loopback url> --out=<dir> [--device='iPhone 15 Pro'] [--viewport=2992x1434@2]
// The walker is set 20 m inside Driftwood's east entryway by the in-page harness pose, so preview or a loopback page only (J205).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', ''), fire = process.argv.includes('--fire');
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: zone-gate-proof.mjs --base=<preview or loopback url> --out=<dir>');
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const HALF = 250;
mkdirSync(out, { recursive: true });
const tag = `${engineName}${device === '' ? '' : '-phone'}`;
const result = { base, engine: engineName, viewport: '', at: new Date().toISOString(), build: '', shots: /** @type {Record<string, unknown>[]} */ ([]), fired: /** @type {unknown} */ (null), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  result.viewport = phone === undefined ? `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}` : `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('gate'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  const state = () => page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live?.live?.worldFeet ?? W.__wildshard.world.player.position; return { x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), gate: st.gate ?? null, walls: st.softWalls ?? null, inside: st.inside, cur: st.live?.live?.current ?? null }; });
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const pitch = 562.5, nalatiEdge = origin.x + pitch - HALF;
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  /** Walk with W held toward x (along z = origin.z) until within 0.4 m. */
  const walkTo = async (/** @type {number} */ x) => {
    for (let ends = Date.now() + 60_000; Date.now() < ends;) {
      const at = await state(); if (Math.abs(at.x - x) < 0.4) break;
      await face(Math.atan2(at.x - x, at.z - origin.z)); await page.keyboard.down('KeyW'); await sleep(Math.min(400, Math.abs(at.x - x) * 200)); await page.keyboard.up('KeyW');
    }
  };
  const shoot = async (/** @type {string} */ name) => { await page.screenshot({ path: join(out, `${tag}-${name}.png`) }); result.shots.push({ name, ...await state() }); };
  await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [HALF - 20, 0]);
  await sleep(4000);
  await walkTo(origin.x + HALF + 31.25); await face(-Math.PI / 2); await sleep(1500);
  await shoot('road-wall');
  /** Poll the gate until `test` holds (or 8 s). */
  const until = async (/** @type {(gate: any) => boolean} */ test) => { for (let ends = Date.now() + 8000; Date.now() < ends; await sleep(50)) if (test((await state()).gate)) return true; return false; };
  // in, 2 m past the edge line: the card at 5; back out of the buffer at 3 (so the count can't reach 0 on the way out)
  await walkTo(nalatiEdge + 2); await until(gate => gate?.count === 5); await shoot('gate-5');
  await until(gate => gate?.count === 3);
  await walkTo(nalatiEdge - 6); await face(-Math.PI / 2); await sleep(600);
  await shoot('backed-away');
  // in again: 5 (the reset), then 2
  await walkTo(nalatiEdge + 2); await until(gate => gate?.count === 5); await shoot('gate-again');
  await until(gate => gate?.count === 2); await shoot('gate-2');
  if (fire) {
    // stand on: 0 opens the loading screen and the page enters the cell as its home
    const before = page.url();
    const left = await page.waitForEvent('framenavigated', { timeout: 6000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: join(out, `${tag}-gate-0-loading.png`) }).catch(() => undefined);
    const ready = await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 250 }).then(() => true).catch(() => false);
    const home = await page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.(); return { home: st?.live?.live?.home ?? st?.home ?? null, current: st?.live?.live?.current ?? null, slug: W.__wildshard?.shard?.slug ?? null }; }).catch(() => null);
    if (ready) await page.screenshot({ path: join(out, `${tag}-entered.png`) });
    result.fired = { navigated: left, before, after: page.url(), ready, home };
  }
  const named = (/** @type {string} */ name) => /** @type {any} */ (result.shots.find(row => row.name === name))?.gate;
  const [at5, gone, again, at2] = ['gate-5', 'backed-away', 'gate-again', 'gate-2'].map(named);
  console.log(JSON.stringify({ at5, at2, gone, again, fired: result.fired }));
  await context.close();
  code = at5?.count === 5 && at2?.count === 2 && gone?.cell === null && again?.count === 5 && result.errors.length === 0 && (!fire || /** @type {any} */ (result.fired)?.ready === true) ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-zone-gate.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
