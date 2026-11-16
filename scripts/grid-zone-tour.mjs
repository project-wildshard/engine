#!/usr/bin/env node
// ZONE-ENTRY ZE13 (was GC3's tour): enter every cell of the grid by a gate, one after another, in one browser tab. From Driftwood
// (Shard Select), for each other cell in turn: the in-page harness pose sets the walker on the road's centre line in front of that
// cell's entryway nearest the current home, the walker walks into its buffer by real input and stands; the gate counts 5 to 0 and the
// zone entry runs (the loading screen, the target as the new home). Per cell: count start to control (ms), the loading screen's time (the old page going to control),
// playingMB at control, page errors. The next cell is entered from the one just entered.
//   scripts/browser-lane.sh node scripts/grid-zone-tour.mjs --base=<preview or loopback url> --out=<dir> [--cells=slug,slug (in this order)]
//     [--engine=chromium|webkit] [--device='iPhone 15 Pro'] [--viewport=1440x900@1]
// Writes <out>/<engine>[-phone]-zone-tour.json; `scripts/grid-zone-report.mjs` turns it into the cells × measures page and its ratchet.
// The pose is a harness call, so preview or a loopback page only (J205). Run by hand per release (J351: no hourly check).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', '');
const only = flag('cells', '').split(',').filter(Boolean);
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: grid-zone-tour.mjs --base=<preview or loopback url> --out=<dir>');
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '1440x900@1')) ?? [0, '1440', '900', '1']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** The cell's half size and the gap's half: the road's centre line runs HALF + GAP_HALF off a cell's centre. */
const HALF = 250, GAP_HALF = 31.25;
mkdirSync(out, { recursive: true });
const tag = `${engineName}${device === '' ? '' : '-phone'}`;
const result = { base, engine: engineName, device, viewport: '', at: new Date().toISOString(), build: '', start: 'driftwood-isle',
  entries: /** @type {Record<string, unknown>[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  result.viewport = phone === undefined ? `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}` : `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 1440, height: desk[1] ?? 900 }, deviceScaleFactor: desk[2] ?? 1 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('tour'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  const ready = (/** @type {number} */ timeout) => page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout, polling: 100 }).then(() => true).catch(() => false);
  if (!await ready(180_000)) throw new Error('Driftwood never gave control');
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  /** The grid as the current page sees it: each cell's centre in the home frame, and the home. */
  const grid = () => page.evaluate(() => {
    const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live.live.worldFeet, p = W.__wildshard.world.player.position;
    return { origin: { x: wf.x - p.x, z: wf.z - p.z }, home: String(st.live?.live?.home ?? st.home ?? ''), cells: /** @type {{ slug: string, instance: string, cell: [number, number] }[]} */ (st.cells).map(row => ({ slug: row.slug, instance: row.instance, cell: row.cell })) };
  });
  const first = await grid();
  // --cells names the entries in order (ZE12: a cell may come round again, the start too, once the home has moved on)
  const order = only.length > 0 ? only : first.cells.map(row => row.slug).filter(slug => slug !== result.start);
  /** every main-frame navigation (same-document address rewrites included), for a reload after an entry's control */
  const navigations = /** @type {{ url: string, at: number }[]} */ ([]);
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ url: frame.url().replace(base, ''), at: Date.now() }); });
  /** @type {any} */ (result).navigations = navigations;
  await page.evaluate(() => { /** @type {any} */ (window).__zeTourMark = 1; });
  for (const slug of order) {
    // a page that loaded again after the last entry's control (its marker gone) is recorded on that entry, then waited for
    const kept = await page.evaluate(() => /** @type {any} */ (window).__zeTourMark === 1).catch(() => false), last = /** @type {any} */ (result.entries.at(-1));
    if (last !== undefined && !kept) { last.reloadedAfterControl = true; last.ok = false; if (!await ready(180_000)) throw new Error('No control after a reload'); await sleep(1500); }
    const g = await grid(), target = g.cells.find(row => row.slug === slug), own = g.cells.find(row => row.instance === g.home || row.slug === g.home);
    if (target === undefined) { result.entries.push({ slug, ok: false, note: 'not on the grid' }); continue; }
    const pitch = own !== undefined && own.cell[0] !== 0 ? g.origin.x / own.cell[0] : own !== undefined && own.cell[1] !== 0 ? g.origin.z / own.cell[1] : 562.5;
    const cx = target.cell[0] * pitch - g.origin.x, cz = target.cell[1] * pitch - g.origin.z;
    // the target's entryway facing the current home (the dominant axis toward it), its road centre line, facing in
    const sx = Math.abs(cx) >= Math.abs(cz) ? -Math.sign(cx || 1) : 0, sz = sx === 0 ? -Math.sign(cz || 1) : 0;
    const x = cx + sx * (HALF + GAP_HALF), z = cz + sz * (HALF + GAP_HALF), yaw = Math.atan2(x - cx, z - cz);
    await page.evaluate(([px, pz, py]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, py, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, py); }, [x, z, yaw]);
    await sleep(3000);
    // the zone entry's navigation is awaited from the walk in on, so a count that runs out during the last steps can't slip past it;
    // the new document is the reload form's `?chunk=` (the entry first rewrites the old page's own address, a same-document event)
    // ZE10a3: or the same-page entry, which retires the old Game in this document (marked from inside the page)
    await page.evaluate(() => {
      const W = /** @type {any} */ (window), game = W.__wildshard.world.game, retire = game.dispose.bind(game);
      W.__zeTourLeftAt = undefined; game.dispose = (/** @type {unknown[]} */ ...args) => { const done = retire(...args); W.__zeTourLeftAt = Date.now(); return done; };
    });
    const navigation = Promise.any([
      page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() && frame.url().includes('chunk='), timeout: 60_000 }).then(() => Date.now()),
      page.waitForFunction(() => /** @type {any} */ (window).__zeTourLeftAt !== undefined, undefined, { timeout: 60_000, polling: 20 })
        .then(() => page.evaluate(() => /** @type {number} */ (/** @type {any} */ (window).__zeTourLeftAt))),
    ]).catch(() => null);
    // walk in until 3 m past the edge line (inside the buffer), then stand
    let depth = -GAP_HALF;
    for (const ends = Date.now() + 30_000; Date.now() < ends && depth < 3;) {
      await page.evaluate(py => { /** @type {any} */ (window).__wildshard.world.player.yaw = py; }, yaw).catch(() => undefined);
      await page.keyboard.down('KeyW'); await sleep(Math.min(400, Math.max(60, (3 - depth) * 150))); await page.keyboard.up('KeyW');
      // a count that ran out mid-walk has taken the page away: stop walking
      depth = await page.evaluate(([tx, tz, half]) => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return half - Math.max(Math.abs(p.x - tx), Math.abs(p.z - tz)); }, [cx, cz, HALF]).catch(() => 3);
    }
    // the count runs only with the feet in this cell's buffer: a gate with no cell reads 5 too
    const counting = await page.waitForFunction(instance => { const gate = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().gate; return gate?.cell === instance && gate.count >= 4; }, target.instance, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
    const countAt = Date.now();
    const navigatedAt = await navigation, navigated = navigatedAt !== null, leftAt = navigatedAt ?? Date.now();
    const control = navigated && await ready(180_000), controlAt = Date.now();
    await sleep(1500);
    const after = await page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.(); return { home: String(st?.live?.live?.home ?? st?.home ?? ''), mb: st?.playingMB ?? null, slug: W.__wildshard?.shard?.slug ?? null }; }).catch(() => null);
    const entry = { slug, from: g.home, side: sx > 0 ? 'east' : sx < 0 ? 'west' : sz > 0 ? 'north' : 'south', reachedBuffer: depth >= 0, counting,
      countToControlMs: control ? controlAt - countAt : null, loadingMs: control ? controlAt - leftAt : null, mb: after?.mb ?? null,
      home: after?.home ?? null, samePage: await page.evaluate(() => /** @type {any} */ (window).__zeTourMark === 1).catch(() => false), ok: control && (after?.slug === slug || after?.home === target.instance || (after?.home ?? '').includes(slug)) };
    result.entries.push(entry);
    await page.evaluate(() => { /** @type {any} */ (window).__zeTourMark = 1; }).catch(() => undefined);
    console.log(JSON.stringify(entry));
    if (!control) break; // the tour stands where the failed entry left it
  }
  await context.close();
  code = result.entries.length === order.length && result.entries.every(row => row.ok === true) ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-zone-tour.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
