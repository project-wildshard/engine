#!/usr/bin/env node
// FM3 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): the failure proof. Real faults, real screens, on this Mac only. The rig of
// online-rig.mjs (the built server, a signed release file on loopback) sits behind FM2's chaos proxy (chaos-proxy-core.mjs), and a
// headless browser at 402x874 plays a build stamped with the proxy's release address. Each case (scripts/failmode-cases.mjs) gets a fresh
// browser context: a play case enters Driftwood, then the Node driver arms the fault through the proxy's control (never page script);
// a boot or load case arms it before navigation. The case passes only when the injection is seen (a proxy match, or the browser's own
// offline/freeze event), the catalogued screen (`data-failmode`) shows with primary copy free of raw errors, and the page recovers to a
// real frame (or the named terminal page) once the fault is healed. Every case is recorded in `<work>/failmodes/receipt.json`, with
// its screenshot under `<work>/failmodes/shots/`.
//
// Exit 0: every selected case passed. Exit 1: a screen is missing or wrong, a dependency row isn't built, or the engine can't produce
// the fault (all named in the receipt). Exit 2: the harness failed (setup, an injection that matched nothing, cleanup). `--baseline`
// runs every case either way; it never changes the verdict. These are Ring 2 proofs: real 35 s/120 s clocks, minutes per engine.
// Never in pre-push or CI (FM11 owns the nightly).
//
// The server lets 10 connects a minute in per address and every page here is 127.0.0.1, so play cases wait out the minute between
// them (`--cooldown=<s>`, 60) rather than lifting the cap; a long outage is held by refused upgrades that never reach the server.
//
//   node scripts/failmode-proof.mjs --prepare <work>    a fixture key (<work>/key.json, 0600) and a Driftwood build stamped with the
//                                                       proxy's release address (<work>/dist); prints both paths
//   scripts/browser-lane.sh node scripts/failmode-proof.mjs <dist> <work> <key.json> <pg bin|memory:> <pg data>
//       [--engine=chromium|webkit] [--scenario=<id,...>|all] [--baseline] [--cooldown=<s>]
//   ... --gallery     FM1b: no faults; in Driftwood, real taps open Settings ▸ Debug ▸ Failure screens, then every entry of the
//                     gallery (its 46 modes and nine hold cards) one by one, shot at 402x874 and 1440x900, each closed by its ✕.
//                     Writes <work>/failmodes/gallery.json; exit 0 only when every entry opened and closed.
// Ports: the rig from WS_RIG_PORTS (18856 here: Postgres 18856, world 18857, pages 18858, release 18859), the proxy's pages on 18851 and
// its world door on 18852. The fixture release is signed by the owned key only, channel production on loopback (staging for mode 46).
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import { openChaosProxy } from './chaos-proxy-core.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { qualifyResult } from './failmode-results.mjs';
import { claimFixture, fixtureKey, fixtureRequestOrigins } from './online-rig-owned.mjs';
import { rawLeak, selectCases, verdict } from './failmode-cases.mjs';

process.env.WS_RIG_PORTS ??= '18856';
const rigPort = Number(process.env.WS_RIG_PORTS);
if (!Number.isSafeInteger(rigPort) || rigPort < 1029 || rigPort > 65532) throw new Error('WS_RIG_PORTS must reserve explicit unprivileged fixture ports');
const ROOT = absolute(import.meta.dirname, '..'), PROXY_PAGE = rigPort - 5, PROXY_WORLD = rigPort - 4, SHARD = 'driftwood-isle';
const PAGE_ORIGIN = `http://127.0.0.1:${String(PROXY_PAGE)}`, RELEASE_URL = `${PAGE_ORIGIN}/__release.json`, SOCKET = `ws://127.0.0.1:${String(PROXY_WORLD)}/`;
const args = process.argv.slice(2), positional = args.filter(value => !value.startsWith('--'));
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

if (args[0] === '--prepare') {
  const named = args[1];
  if (named === undefined || named.startsWith('--')) throw new Error('--prepare <work>');
  const work = absolute(named);
  claimFixture(work);
  const keyFile = join(work, 'key.json');
  if (!existsSync(keyFile)) {
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(keyFile, JSON.stringify({ public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600, flag: 'wx' });
  }
  const key = JSON.parse(readFileSync(keyFile, 'utf8')), owner = `failmode-${String(process.pid)}`;
  const built = spawnSync('bash', ['scripts/serve-build.sh', '--shard', SHARD, '--name', 'failmode', '--hours', '1'], { cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, SERVE_OWNER: owner, WILDSHARD_RELEASE_URL: RELEASE_URL, WILDSHARD_RELEASE_KEY: key.public, VITE_API_ORIGIN: PAGE_ORIGIN }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = /→ (\S+)/u.exec(built.stderr)?.[1], port = /127\.0\.0\.1:(\d+)/u.exec(built.stdout)?.[1];
  try {
    if (built.status !== 0 || out === undefined) throw new Error(`the build failed: ${built.stderr.slice(-2000)}`);
    const dist = join(work, 'dist');
    rmSync(dist, { recursive: true, force: true });
    if (spawnSync('cp', ['-cR', out, dist], { stdio: 'inherit' }).status !== 0) throw new Error('copying the build failed');
    if (!readFileSync(join(dist, 'index.html'), 'utf8').includes(RELEASE_URL)) throw new Error('the build is not stamped with the proxy release address');
    writeFileSync(join(work, 'fixture.json'), JSON.stringify({ schema: 'failmode-fixture/1', release: RELEASE_URL, api: PAGE_ORIGIN, publicKey: key.public, build: JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).build }));
    console.log(JSON.stringify({ dist, keyFile }));
  } finally {
    if (port !== undefined) spawnSync('bash', ['scripts/serve-build.sh', 'stop', port], { cwd: ROOT, env: { ...process.env, SERVE_OWNER: owner }, stdio: 'ignore' });
  }
  process.exit(0);
}

const [dist = '', work = '', keyFile = '', pgBin = '', pgData = ''] = positional;
if (pgData === '' && pgBin !== 'memory:') throw new Error('failmode-proof <dist> <work> <key.json> <pg bin|memory:> <pg data>');
const galleryWalk = args.includes('--gallery');
const engine = flag('engine', 'chromium'), baseline = args.includes('--baseline'), cooldownMs = Number(flag('cooldown', '60')) * 1000;
if (engine !== 'chromium' && engine !== 'webkit') throw new Error('--engine=chromium|webkit');
// `--refusal=screen|injection` proves strict mode refuses: a drop that must show a screen no build has (exit 1), and a fault armed on
// a route the page never reads, so it matches nothing (exit 2). Neither is a catalogue case.
const refusal = flag('refusal', '');
if (!['', 'screen', 'injection'].includes(refusal)) throw new Error('--refusal=screen|injection');
const drop = selectCases('drop')[0];
const cases = galleryWalk ? [] : refusal === '' ? selectCases(flag('scenario', 'all')) : drop === undefined ? [] : [refusal === 'screen' ? { ...drop, id: 'drop', screen: 'no-such-screen', mode: 'R1' } : { ...drop, id: 'unmatched', run: 'unmatched', mode: 'R2' }], out = join(absolute(work), 'failmodes'), shots = join(out, 'shots');
if (!readFileSync(join(dist, 'index.html'), 'utf8').includes(RELEASE_URL)) throw new Error(`${dist} is not stamped with ${RELEASE_URL}: build it with --prepare`);
fixtureKey(keyFile);
const fixture = JSON.parse(readFileSync(join(absolute(dist, '..'), 'fixture.json'), 'utf8'));
if (fixture.schema !== 'failmode-fixture/1' || fixture.release !== RELEASE_URL || fixture.api !== PAGE_ORIGIN || fixture.publicKey !== fixtureKey(keyFile).public || fixture.build !== JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).build) throw new Error('The owned fixture stamp, key and build must agree');
claimFixture(work); mkdirSync(shots, { recursive: true });
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

/** @typedef {import('./failmode-cases.mjs').Case} Case */
/** @typedef {import('./failmode-cases.mjs').Outcome} Outcome */
/** @typedef {{ page: import('playwright').Page, context: import('playwright').BrowserContext, errors: string[] }} Entered */
/** @typedef {{ outcome: Outcome, reason?: string, seen?: Seen | null, injection?: unknown, recovery?: string, shot?: string, notes?: unknown }} Result */
/** @typedef {{ ids: string, ms: number, copy: string, leak: string | null }} Seen */

const { openRig } = await import('./online-rig.mjs');
let rig;
try { rig = await openRig({ dist, work: join(absolute(work), 'rig'), keyFile, pgBin, pgData, shard: SHARD, socket: SOCKET, origins: [PAGE_ORIGIN], isolated: true }); } catch (error) {
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ schema: 'failmode-proof/1', sha, engine, baseline, phase: 'setup', harnessFault: String(error).slice(0, 600), exit: 2, cases: [] }));
  process.exit(2);
}
let proxy = /** @type {Awaited<ReturnType<typeof openChaosProxy>> | null} */ (null), launched = /** @type {import('playwright').Browser | null} */ (null);
const rows = /** @type {(Result & { mode: string, id: string, owner: string, screen: string, inject: string, ms: number })[]} */ ([]);
let browserVersion = '';
let harnessFault = /** @type {string | null} */ (null);
try {
  // openChaosProxy claims its fresh directory; never delete pre-existing fixture files.
  proxy = await openChaosProxy({ work: join(absolute(work), 'proxy'), pageUpstream: rig.base, releaseUpstream: `http://127.0.0.1:${String(Number(process.env.WS_RIG_PORTS) + 3)}`, worldUpstream: `http://127.0.0.1:${String(Number(process.env.WS_RIG_PORTS) + 1)}`, pagePort: PROXY_PAGE, worldPort: PROXY_WORLD });
  const token = readFileSync(proxy.ready.tokenFile, 'utf8');
  /** The proxy's state, or its rules replaced. @param {{ scenario: string, rules: object[] }} [body] */
  const control = async body => {
    const response = await fetch(proxy?.ready.controlUrl ?? '', { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
    if (!response.ok) throw new Error(`chaos control ${String(response.status)}`);
    return /** @type {{ counters: { upgrades: number, matches: Record<string, number> }, events: object[], activeConnections: number }} */ (await response.json());
  };
  /** @param {string} scenario @param {object[]} rules */
  const arm = (scenario, rules) => control({ scenario, rules });
  const heal = () => control({ scenario: 'healthy', rules: [] });
  /** matches on a route since a snapshot @param {Awaited<ReturnType<typeof control>>} before @param {string} route */
  const matchedSince = async (before, route) => ((await control()).counters.matches[route] ?? 0) - (before.counters.matches[route] ?? 0);

  launched = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist'] });
  browserVersion = launched.version();
  const { defaultBrowserType: _engine, ...device } = devices['iPhone 16 Pro'];
  const phone = { ...device, viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 } };
  const allowedOrigins = fixtureRequestOrigins(PAGE_ORIGIN, SOCKET);
  const guardFaults = /** @type {string[]} */ ([]);
  let pageFaults = /** @type {string[]} */ ([]);
  const URL_PLAY = `${PAGE_ORIGIN}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
  /** A fresh device: its own context, Developer on, its errors and visibility changes kept.
   *  `observe`: the off-fixture guard watches instead of routing. Playwright's routing disables the HTTP cache, and Chromium then hands
   *  a service worker every read as `cache: 'no-store'`, which sw.js rightly sends to the network: a warmed page could never launch
   *  offline under it (FM5 mode 1). An off-fixture request there is still a guard fault, seen rather than refused.
   *  @param {() => void} [init] @param {{ observe?: boolean }} [how] */
  const fresh = async (init, how = {}) => {
    const context = await /** @type {import('playwright').Browser} */ (launched).newContext(phone), errors = /** @type {string[]} */ ([]);
    if (how.observe === true) context.on('request', request => { if (!allowedOrigins.has(new URL(request.url()).origin)) guardFaults.push('saw an off-fixture HTTP request (observe-only guard)'); });
    else await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (allowedOrigins.has(url.origin)) await route.continue();
      else { guardFaults.push('refused off-fixture HTTP request'); await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', async socket => {
      if (allowedOrigins.has(new URL(socket.url()).origin)) socket.connectToServer();
      else { guardFaults.push('refused off-fixture WebSocket'); await socket.close(); }
    });
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await context.addInitScript(() => { const seen = /** @type {string[]} */ ([]); Object.defineProperty(globalThis, '__fmVisibility', { value: seen }); document.addEventListener('visibilitychange', () => { seen.push(document.visibilityState); }); });
    if (init !== undefined) await context.addInitScript(init);
    const page = await context.newPage();
    page.on('pageerror', error => { const message = error.message.slice(0, 240); errors.push(message); pageFaults.push(message); });
    page.on('console', line => { if (line.type() === 'error') errors.push(line.text().slice(0, 240)); if (process.env.FM_TRACE === '1') console.log(`  [page ${line.type()}] ${line.text().slice(0, 300)}`); });
    page.on('response', response => { if (process.env.FM_TRACE === '1' && response.status() >= 400) console.log(`  [http ${String(response.status())}] ${response.url().slice(0, 200)}`); });
    page.on('requestfailed', request => { if (process.env.FM_TRACE === '1') console.log(`  [failed ${request.failure()?.errorText ?? '?'}] ${request.url().slice(0, 200)}`); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && process.env.FM_TRACE === '1') console.log(`  [nav] ${frame.url()}`); });
    return { page, context, errors };
  };
  /** Through the Name box (if it asks) into the world, to 30 frames. @param {Entered} entered @param {number} [timeout] */
  const intoWorld = async (entered, timeout = 150_000) => {
    const { page } = entered, until = Date.now() + timeout;
    for (;;) {
      if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) {
        await page.locator('#ws-name-box input').fill(`fm${String(Date.now() % 100_000)}`);
        await page.locator('#ws-name-box button[type=submit]').click();
      }
      if (await page.evaluate(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined).catch(() => false)) break;
      if (Date.now() > until) {
        const marks = await page.evaluate(() => ({ marks: Object.entries(document.documentElement.dataset).map(([key, value]) => `${key}=${value ?? ''}`).join(' '), sw: navigator.serviceWorker?.controller?.state ?? 'none', url: location.href, seen: [...document.querySelectorAll('[data-failmode]')].map(node => node instanceof HTMLElement ? node.dataset.failmode : '') })).catch(() => null);
        throw new Error(`the page never reached the world (${JSON.stringify({ marks, errors: entered.errors.slice(-4) }).slice(0, 900)})`);
      }
      await sleep(250);
    }
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().frames > 30, undefined, { timeout: Math.max(5000, until - Date.now()) });
  };
  /** The frames the page has heard. @param {import('playwright').Page} page */
  const frames = page => page.evaluate(() => (typeof window.__workerClient === 'function' ? window.__workerClient().frames : -1)).catch(() => -1);
  /** Every visible catalogued screen's ids. @param {import('playwright').Page} page */
  const visibleIds = page => page.evaluate(() => [...document.querySelectorAll('[data-failmode]')].filter(node => node instanceof HTMLElement && !node.hidden && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && node.getBoundingClientRect().width > 0).map(node => (node instanceof HTMLElement ? node.dataset.failmode : undefined) ?? '')).catch(() => /** @type {string[]} */ ([]));
  /** Waits for the screen `id`; what shows, how fast, and its primary copy (a Details/Copy diagnostics part is not primary).
   *  @param {import('playwright').Page} page @param {string} id @param {number} timeout @param {number} [from] */
  const screen = async (page, id, timeout, from = Date.now()) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const found = await page.evaluate(wanted => {
        for (const node of document.querySelectorAll('[data-failmode]')) {
          if (!(node instanceof HTMLElement) || !(node.dataset.failmode ?? '').split(/\s+/u).includes(wanted)) continue;
          const style = getComputedStyle(node), box = node.getBoundingClientRect();
          if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || box.width === 0 || box.height === 0) continue;
          const copy = /** @type {HTMLElement} */ (node.cloneNode(true));
          for (const part of copy.querySelectorAll('details, [data-details], .details, button')) part.remove();
          return { ids: node.dataset.failmode ?? '', copy: (copy.textContent ?? '').replaceAll(/\s+/gu, ' ').trim().slice(0, 300) };
        }
        return null;
      }, id).catch(() => null);
      if (found !== null) return { ...found, ms: Date.now() - from, leak: rawLeak(found.copy) };
      await sleep(200);
    }
    return null;
  };
  /** What a player reads now, for a case whose screen never came. @param {import('playwright').Page} page */
  const onScreen = async page => ({ visible: await visibleIds(page), text: (await page.evaluate(() => {
    const text = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || parent.getClientRects().length === 0) continue;
      const style = getComputedStyle(parent);
      if (style.display !== 'none' && style.visibility !== 'hidden') text.push(node.textContent ?? '');
    }
    return text.join(' ');
  }).catch(() => '') ?? '').replaceAll(/\s+/gu, ' ').slice(0, process.env.FM_TRACE === '1' ? 3000 : 300),
    ...process.env.FM_TRACE === '1' ? { marks: await page.evaluate(() => Object.fromEntries(Object.entries(document.documentElement.dataset))).catch(() => null) } : {} });
  /** A shot named for the case. @param {import('playwright').Page} page @param {string} id @param {string} what */
  const shoot = async (page, id, what) => { const file = `${id.replace('/', '-')}-${what}.png`; await page.screenshot({ path: join(shots, file) }); return file; };
  /** Back in play: frames move on and no card or page is up (a notice may be). @param {import('playwright').Page} page @param {number} timeout */
  const recovered = async (page, timeout) => {
    const until = Date.now() + timeout, start = await frames(page);
    while (Date.now() < until) {
      const now = await frames(page), up = await visibleIds(page);
      if (now > start + 10 && up.every(ids => /\b(?:reconnected|slow|lossy|staging)\b/u.test(ids))) return true;
      await sleep(300);
    }
    return false;
  };
  /** The screen's verdict once seen. @param {Seen | null} seen @param {Case} item @param {import('playwright').Page} page @returns {Promise<Result>} */
  const judged = async (seen, item, page) => {
    if (seen === null) return { outcome: 'ui-fail', reason: `no ${item.screen} screen`, seen: null, notes: await onScreen(page) };
    if (seen.leak !== null) return { outcome: 'ui-fail', reason: `primary copy leaks "${seen.leak}"`, seen };
    return { outcome: 'pass', seen };
  };
  /** Clicks a button on the case's screen. @param {import('playwright').Page} page @param {string} id @param {string} label */
  const press = (page, id, label) => page.locator(`[data-failmode~="${id}"] button`, { hasText: label }).first().click({ timeout: 5000 });
  /** The pause menu's Settings at one of its tabs, as a player gets there: Escape (the pause key), else the HUD's Settings button.
   *  @param {import('playwright').Page} page @param {'system' | 'dev'} tab */
  const settingsTab = async (page, tab) => {
    const menu = page.locator('.ws-gmenu.show');
    if (!await menu.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    if (!await menu.isVisible().catch(() => false)) await page.locator('button', { hasText: /^Settings$/u }).first().click({ timeout: 5000 }).catch(() => undefined);
    await menu.waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator(`.ws-gmenu.show [data-sv-tab="${tab}"]`).first().click({ timeout: 10_000 });
  };
  /** WebKit's setOffline (Playwright) leaves loopback sockets up, so a WebKit page "offline" kept playing on the rig (opus-fm1's mode 1).
   *  There the proxy cuts the world door too while the browser is offline: a live link drops and new upgrades are refused. Labelled in
   *  the receipt as `loopbackCut`; Chromium needs none (its offline mode closes the socket itself). @param {boolean} live */
  const cutLoopback = async live => {
    if (engine !== 'webkit') return false;
    if (live) {
      const before = await control(); await arm('webkit-offline', [{ route: 'socket', kind: 'drop-after', afterMs: 0 }]);
      for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
    }
    await arm('webkit-offline-held', [{ route: 'socket', kind: 'refuse-upgrade', code: 503 }]);
    return true;
  };

  /** @type {Record<string, (item: Case) => Promise<Result>>} */
  const runners = {
    // a fault on the world's socket, held, then healed
    socketDown: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(), started = Date.now();
        /** @type {Record<string, { first: object, hold: object | null, holdMs: number, wait: number, button?: string, reloads?: boolean }>} */
        const plans = {
          drop: { first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, holdMs: 2500, wait: 4000 },
          reset: { first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, holdMs: 2500, wait: 4000 },
          reconnected: { first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, holdMs: 2000, wait: 15_000 },
          'half-open': { first: { route: 'socket', kind: 'half-open' }, hold: null, holdMs: 2500, wait: 4000 },
          restart: { first: { route: 'socket', kind: 'close', code: 4005, reason: 'restart' }, hold: null, holdMs: 4000, wait: 4000 },
          resuming: { first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, holdMs: 37_000, wait: 40_000 },
          lost: { first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, holdMs: 122_000, wait: 126_000, button: 'Try again' },
          full: { first: { route: 'socket', kind: 'close', code: 4002, reason: 'full' }, hold: null, holdMs: 3000, wait: 6000 },
          refused: { first: { route: 'socket', kind: 'close', code: 4001, reason: 'refused' }, hold: null, holdMs: 3000, wait: 6000, button: 'Play again', reloads: true },
          'version-skew': { first: { route: 'socket', kind: 'close', code: 4000, reason: 'reload' }, hold: null, holdMs: 15_000, wait: 20_000, button: 'Reload', reloads: true },
        };
        const plan = plans[item.id];
        if (plan === undefined) throw new Error(`socketDown has no plan for ${item.id}`);
        await arm(item.id, [plan.first]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        const injected = await matchedSince(before, 'socket');
        if (injected === 0) return { outcome: 'harness-fail', reason: 'the socket fault matched nothing' };
        if (plan.hold !== null) await arm(`${item.id}-held`, [plan.hold]);
        const seenWhileDown = item.id === 'reconnected' ? null : await screen(page, item.screen, plan.wait, started);
        const shot = seenWhileDown === null ? '' : await shoot(page, item.id, 'down');
        await sleep(Math.max(0, plan.holdMs - (Date.now() - started)));
        const injection = { socketMatches: await matchedSince(before, 'socket'), downMs: Date.now() - started };
        await heal();
        if (item.id === 'reconnected') {
          const chip = await screen(page, 'reconnected', plan.wait, Date.now());
          const chipShot = chip === null ? undefined : await shoot(page, item.id, 'chip');
          const gone = chip !== null && await page.locator('[data-failmode~="reconnected"]').waitFor({ state: 'detached', timeout: 6000 }).then(() => true, () => false);
          const verdictRow = await judged(chip, item, page);
          return { ...verdictRow, ...verdictRow.outcome === 'pass' && !gone ? { outcome: 'ui-fail', reason: 'the Reconnected notice never went' } : {}, injection, ...chipShot === undefined ? {} : { shot: chipShot }, recovery: gone ? 'chip gone by itself' : 'chip stayed' };
        }
        const result = await judged(seenWhileDown, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (plan.button !== undefined) {
          const reloading = plan.reloads === true ? page.waitForEvent('load', { timeout: 30_000 }).catch(() => null) : null;
          await press(page, item.screen, plan.button).catch(() => undefined);
          if (reloading !== null) { await reloading; await intoWorld(entered, 90_000).catch(() => undefined); }
        }
        const back = await recovered(page, item.id === 'full' ? 45_000 : 30_000);
        return back ? { ...result, injection, shot, recovery: 'a real frame, no card' } : { outcome: 'ui-fail', reason: 'no recovery after heal', seen: seenWhileDown, injection, shot, after: await shoot(page, item.id, 'after'), url: page.url(), notes: await onScreen(page) };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM4: Send while the link is down holds one visible line, sent once on the way back
    heldChat: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control();
        await arm('reset', [{ route: 'socket', kind: 'drop-after', afterMs: 0 }]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        if (await matchedSince(before, 'socket') === 0) return { outcome: 'harness-fail', reason: 'the socket fault matched nothing' };
        await arm('reset-held', [{ route: 'socket', kind: 'refuse-upgrade', code: 503 }]);
        await screen(page, 'drop', 4000);
        const line = `held ${String(Date.now() % 10_000)}`;
        await page.locator('#ws-chat input').fill(line); await page.locator('#ws-chat input').press('Enter');
        const seen = await screen(page, item.screen, 3000), shot = await shoot(page, item.id, 'held');
        await sleep(1500); await heal();
        const result = await judged(seen, item, page);
        const sent = await page.locator('#ws-chat', { hasText: line }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
        await sleep(2000);
        const copies = await page.evaluate(text => [...document.querySelectorAll('#ws-chat [data-lines] > *')].filter(node => (node.textContent ?? '').includes(text)).length, line);
        if (result.outcome !== 'pass') return { ...result, shot };
        return sent && copies === 1 ? { ...result, shot, injection: { socketMatches: await matchedSince(before, 'socket') }, recovery: 'the held line sent once' } : { outcome: 'ui-fail', reason: `held line sent ${String(copies)} times`, seen, shot };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM4 15b/17b/19b: under a banner, a real tap the world must hear (Attack, its key F) opens the banner's hold card instead of
    // going out; the card closes by itself on the first frame back
    heldTap: async item => {
      const entered = await fresh(); const { page } = entered;
      /** @type {Record<string, { banner: string, first: object, hold: object | null, waitMs: number }>} */
      const plans = {
        'drop/blocked': { banner: 'drop', first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, waitMs: 6000 },
        'half-open/blocked': { banner: 'half-open', first: { route: 'socket', kind: 'half-open' }, hold: null, waitMs: 6000 },
        'resuming/blocked': { banner: 'resuming', first: { route: 'socket', kind: 'drop-after', afterMs: 0 }, hold: { route: 'socket', kind: 'refuse-upgrade', code: 503 }, waitMs: 45_000 },
      };
      const plan = plans[item.id];
      if (plan === undefined) throw new Error(`heldTap has no plan for ${item.id}`);
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control();
        const name = item.id.replace('/', '-');
        await arm(name, [plan.first]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        if (await matchedSince(before, 'socket') === 0) return { outcome: 'harness-fail', reason: 'the socket fault matched nothing' };
        if (plan.hold !== null) await arm(`${name}-held`, [plan.hold]);
        const banner = await screen(page, plan.banner, plan.waitMs);
        if (banner === null) return { outcome: 'ui-fail', reason: `no ${plan.banner} banner to tap under`, notes: await onScreen(page) };
        const started = Date.now();
        await page.keyboard.press('KeyF');
        const seen = await screen(page, item.screen, 4000, started), shot = await shoot(page, item.id.replace('/', '-'), seen === null ? 'missing' : 'card');
        const result = await judged(seen, item, page);
        await heal();
        if (result.outcome !== 'pass') return { ...result, shot };
        const closed = await page.locator(`[data-failmode~="${item.screen}"]`).waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false);
        const back = closed && await recovered(page, 30_000);
        return back ? { ...result, shot, injection: { tap: 'Attack (key F)', socketMatches: await matchedSince(before, 'socket') }, recovery: 'the card closed on the first frame' }
          : { outcome: 'ui-fail', reason: closed ? 'no frames after heal' : 'the hold card stayed after the link came back', seen, shot };
      } finally { await heal(); await entered.context.close(); }
    },
    // a second tab of the same device takes the seat; Play here takes it back
    replaced: async item => {
      const entered = await fresh(); const { page, context } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const second = await context.newPage(), started = Date.now();
        await second.goto(URL_PLAY);
        const seen = await screen(page, item.screen, 120_000, started), shot = seen === null ? undefined : await shoot(page, item.id, 'card');
        const result = await judged(seen, item, page);
        await second.close();
        if (result.outcome !== 'pass') return { ...result, ...shot === undefined ? {} : { shot } };
        const reloading = page.waitForEvent('load', { timeout: 30_000 }).catch(() => null);
        await press(page, item.screen, 'Play here'); await reloading; await intoWorld(entered, 90_000).catch(() => undefined);
        const back = await recovered(page, 30_000);
        return back ? { ...result, ...shot === undefined ? {} : { shot }, injection: { secondTab: true }, recovery: 'Play here: seated' } : { outcome: 'ui-fail', reason: 'Play here never seated', seen, notes: await onScreen(page) };
      } finally { await entered.context.close(); }
    },
    // FM5 mode 13: /version.json fails (Developer on, as every fixture page is). The poll is the pause menu's Settings ▸ Build ▸
    // Check, a player's tap that runs the same read as the 5-minute/foreground poll; the pill (title and pause menu) says so to a
    // developer only, and the next read that answers clears it.
    versionHttp: async item => {
      const entered = await fresh(); const { page } = entered;
      const check = async () => {
        const button = page.locator('.ws-gmenu.show .ws-gmenu-buildcheck').first();
        if (!await button.isVisible().catch(() => false)) await settingsTab(page, 'system');
        await button.click({ timeout: 10_000 });
      };
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(), started = Date.now();
        await arm(item.id, [{ route: 'version', kind: 'status', code: 503 }]);
        await check();
        const seen = await screen(page, item.screen, 15_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'pill');
        const injection = { versionMatches: await matchedSince(before, 'version'), trigger: 'Settings ▸ Build ▸ Check (same read as the poll)' };
        await heal();
        if (injection.versionMatches === 0) return { outcome: 'harness-fail', reason: 'the version fault matched nothing', injection, notes: await onScreen(page) };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        await check();
        const cleared = await page.locator('[data-failmode~="version-http"]').waitFor({ state: 'detached', timeout: 15_000 }).then(() => true,
          async () => !(await visibleIds(page)).some(ids => /\bversion-http\b/u.test(ids)));
        return cleared ? { ...result, injection, shot, recovery: 'healed, the next read clears it' } : { outcome: 'ui-fail', reason: 'the failed line stayed after a read answered', seen, injection, shot };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM8m mode 41: the proxy sends the server's coded close (FM7b1: 4001 `refused` with {v:1,code:'banned'}); the page shows the
    // removed card, says the end time only when one was sent, and never dials again. Two joins: with an end time, then without one.
    banned: async item => {
      const entered = await fresh(); const { page } = entered;
      /** @param {number | undefined} untilMs */
      const rule = untilMs => ({ route: 'socket', kind: 'close', code: 4001, reason: JSON.stringify({ v: 1, code: 'banned', ...untilMs === undefined ? {} : { untilMs } }) });
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(), started = Date.now(), untilMs = Date.now() + 26 * 3_600_000;
        await arm(item.id, [rule(untilMs)]);
        const seen = await screen(page, item.screen, 15_000, started), shot = seen === null ? undefined : await shoot(page, item.id, 'until');
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, ...shot === undefined ? {} : { shot } };
        if (!/until /u.test(seen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the sent end time is not said', seen, shot };
        const closes = await matchedSince(before, 'socket');
        if (closes === 0) return { outcome: 'harness-fail', reason: 'the coded close matched nothing', seen };
        await sleep(10_000);
        const redials = await matchedSince(before, 'socket') - closes;
        if (redials !== 0) return { outcome: 'ui-fail', reason: `the page dialled ${String(redials)} times after the ban`, seen, shot };
        // no end time sent: the card claims none. The ban lands before the first frame of this join (never an old server's cut)
        await arm(`${item.id}-open`, [rule(undefined)]);
        const titled = page.waitForURL(url => new URL(url).pathname === '/', { timeout: 15_000 }).then(() => true, () => false);
        await press(page, item.screen, 'Title screen').catch(() => undefined);
        const toTitle = await titled;
        if (!toTitle) return { outcome: 'ui-fail', reason: 'Title screen did not leave for the title', seen, shot };
        const again = Date.now(); await page.goto(URL_PLAY);
        const open = await screen(page, item.screen, 60_000, again), openShot = open === null ? undefined : await shoot(page, item.id, 'no-end');
        const openResult = await judged(open, item, page);
        if (openResult.outcome !== 'pass') return { ...openResult, shot };
        if (/until /u.test(open?.copy ?? '') || !/no end time/u.test(open?.copy ?? '')) return { outcome: 'ui-fail', reason: 'an absent end time was not said as absent', seen: open, shot: openShot };
        const settled = await matchedSince(before, 'socket'); await sleep(10_000);
        const later = await matchedSince(before, 'socket') - settled;
        if (later !== 0) return { outcome: 'ui-fail', reason: `the page dialled ${String(later)} times after the open-ended ban`, seen: open, shot: openShot };
        return { ...result, shot, injection: { closes: settled, untilMs, redials: 0 }, noEnd: { seen: open, shot: openShot }, recovery: 'none: no redial; Title screen leaves for the title' };
      } finally { await heal(); await entered.context.close(); }
    },
    // --refusal=injection: a fault on a route this page never reads matches nothing, and that is a harness failure, never a pass
    unmatched: async () => {
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(); await arm('unmatched', [{ route: 'doctor', kind: 'status', code: 503 }]);
        await sleep(5000);
        const matches = await matchedSince(before, 'doctor');
        return matches === 0 ? { outcome: 'harness-fail', reason: 'the doctor fault matched nothing in 5 s', injection: { matches } } : { outcome: 'pass', injection: { matches } };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM8 mode 14: the doctor's page doesn't answer its preflight; the world page stays, with a card
    doctorHttp: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(), here = page.url(), started = Date.now();
        await arm(item.id, [{ route: 'doctor', kind: 'status', code: 503 }]);
        await page.evaluate(() => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: 'link' })); });
        const seen = await screen(page, item.screen, 15_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const injection = { doctorMatches: await matchedSince(before, 'doctor'), stayed: page.url() === here };
        await heal();
        if (injection.doctorMatches === 0) return { outcome: 'harness-fail', reason: 'the doctor fault matched nothing', injection, notes: await onScreen(page) };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (!injection.stayed) return { outcome: 'ui-fail', reason: 'the page left for a doctor that did not answer', seen, injection, shot };
        await Promise.all([page.waitForURL(/\/doctor\//u, { timeout: 20_000 }), press(page, item.screen, 'Try again')]).catch(() => undefined);
        return /\/doctor\//u.test(page.url()) ? { ...result, injection, shot, recovery: 'healed, Try again: the doctor opened' } : { outcome: 'ui-fail', reason: 'Try again never opened the doctor', seen, injection, shot };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM4b: the browser goes offline in the world
    offlinePlay: async item => {
      const entered = await fresh(); const { page, context } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const started = Date.now(); await context.setOffline(true);
        const loopbackCut = await cutLoopback(true), injection = { setOffline: true, ...loopbackCut ? { loopbackCut } : {} };
        const seen = await screen(page, item.screen, 8000, started), shot = seen === null ? undefined : await shoot(page, item.id, 'card');
        await sleep(2000); await context.setOffline(false); if (loopbackCut) await heal();
        const result = await judged(seen, item, page);
        const back = result.outcome === 'pass' && await recovered(page, 30_000);
        return result.outcome !== 'pass' ? { ...result, injection } : back ? { ...result, ...shot === undefined ? {} : { shot }, injection, recovery: 'online: a frame, no card' } : { outcome: 'ui-fail', reason: 'no recovery online', seen, notes: await onScreen(page) };
      } finally { await context.setOffline(false).catch(() => undefined); await heal().catch(() => undefined); await entered.context.close(); }
    },
    // J298: a world the device holds loads offline and says so
    offlineLaunch: async item => {
      const entered = await fresh(undefined, { observe: true }); const { page, context } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        // a first visit's worker takes control from the next load (no clients.claim on a world page): a second online visit is the warm one.
        // Visits open the play address: the page drops its query once it starts, so a reload would land on the title
        const controlling = () => page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, undefined, { timeout: 20_000 }).then(() => true, () => false);
        if (!await controlling()) { await page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active !== undefined, undefined, { timeout: 60_000 }).catch(() => undefined); await page.goto(URL_PLAY); await intoWorld(entered); }
        const controlled = await controlling();
        if (!controlled) return { outcome: 'unsupported', reason: `${engine}: no controlling service worker after the warm visit, so nothing can launch offline` };
        // the worker precaches its build's code after control (DL1): wait until the page's caches stop growing, not a fixed 3 s
        let held = -1;
        for (let still = 0, tries = 0; still < 3 && tries < 90; tries++) {
          await sleep(1000);
          const entries = await page.evaluate(async () => { let n = 0; for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length; return n; }).catch(() => 0);
          still = entries > 0 && entries === held ? still + 1 : 0; held = entries;
        }
        if (process.env['FM_TRACE'] === '1') console.log('  [warm]', held, JSON.stringify(await page.evaluate(async () => {
          const out = {}; for (const name of await caches.keys()) { const keys = await (await caches.open(name)).keys(); out[name] = [keys.length, keys.map(k => new URL(k.url).pathname).filter(p => /boot-tables|packs-/.test(p))]; } return out;
        }).catch(error => String(error))));
        await context.setOffline(true);
        const loopbackCut = await cutLoopback(false), injection = { warmed: true, setOffline: true, guard: 'observe-only (routing would disable the HTTP cache)', ...loopbackCut ? { loopbackCut } : {} };
        const started = Date.now(); await page.goto(URL_PLAY).catch(() => undefined);
        await intoWorld(entered, 60_000).catch(() => undefined);
        const seen = await screen(page, item.screen, 15_000, started), shot = seen === null ? await shoot(page, item.id, 'missing') : await shoot(page, item.id, 'card');
        await context.setOffline(false); if (loopbackCut) await heal();
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, shot, injection };
        return await recovered(page, 45_000) ? { ...result, shot, injection, recovery: 'online: a frame, no card' } : { outcome: 'ui-fail', reason: 'no recovery online', seen, shot, notes: await onScreen(page) };
      } finally { await context.setOffline(false).catch(() => undefined); await heal().catch(() => undefined); await entered.context.close(); }
    },
    // the page frozen (CDP), with or without a visibility change
    freeze: async item => {
      if (engine !== 'chromium') return { outcome: 'unsupported', reason: 'WebKit has no lifecycle freeze; a native-Safari Ring 2 proof is owed' };
      const entered = await fresh(); const { page, context } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const cdp = await context.newCDPSession(page), awayMs = item.id === 'background-short' ? 4000 : 35_000, started = Date.now();
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        await sleep(awayMs);
        await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        const visibility = await page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (globalThis).__fmVisibility));
        const seen = await screen(page, item.screen, 8000, Date.now()), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const injection = { frozenMs: Date.now() - started, visibility };
        if (seen === null && item.id !== 'sleep-wake' && !visibility.includes('hidden'))
          return { outcome: 'unsupported', reason: 'headless Chromium kept the page visible through the freeze; a real hidden/visible return (native-Safari Ring 2) is owed', injection, shot, notes: await onScreen(page) };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        return await recovered(page, 30_000) ? { ...result, injection, shot, recovery: 'seated again' } : { outcome: 'ui-fail', reason: 'no recovery after the return', seen, injection, shot, notes: await onScreen(page) };
      } finally { await entered.context.close(); }
    },
    // FM4b: slow and unstable links (measured RTT; the proxy holds frames)
    linkQuality: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const before = await control(), started = Date.now();
        // Mode 22 (opus-of18): the proxy keeps a socket's frames in order, so per-frame jitter on a 60 Hz stream queues every frame behind
        // the slowest and the pong RTT sits flat near the jitter's top (seen: no screen under ±200 ms). An unstable link is one whose
        // delay swings: the driver moves the downstream delay between 20 ms and 420 ms every 2.5 s, so the last five pongs span over 250 ms.
        const waving = { on: item.id === 'lossy' };
        const wave = (async () => { for (let high = true; waving.on; high = !high) { await arm(item.id, [{ route: 'socket', kind: 'delay-frames', direction: 'down', ms: high ? 420 : 20, jitterMs: 0, seed: 7 }]); await sleep(2500); } })();
        if (item.id === 'slow') await arm(item.id, [{ route: 'socket', kind: 'delay-frames', direction: 'both', ms: 160, jitterMs: 0, seed: 7 }]);
        const seen = await screen(page, item.screen, 15_000, started).finally(() => { waving.on = false; }), shot = seen === null ? undefined : await shoot(page, item.id, 'chip');
        await wave;
        const injection = { socketMatches: await matchedSince(before, 'socket') };
        await heal();
        if (injection.socketMatches === 0) return { outcome: 'harness-fail', reason: 'the delay matched no frame', injection };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection };
        const cleared = await page.locator(`[data-failmode~="${item.screen}"]`).waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false);
        return cleared ? { ...result, injection, ...shot === undefined ? {} : { shot }, recovery: 'cleared after good seconds' } : { outcome: 'ui-fail', reason: 'the chip never cleared', seen, injection };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM5: the release file fails before the page can dial
    releaseFault: async item => {
      const signed = await (await fetch(`http://127.0.0.1:${String(Number(process.env.WS_RIG_PORTS) + 3)}/release.json`)).text();
      const badSignature = JSON.stringify({ ...JSON.parse(signed), signature: '00'.repeat(64) });
      /** @type {Record<string, object>} */
      const rules = {
        'release-5xx': { route: 'release', kind: 'status', code: 503 },
        'release-429': { route: 'release', kind: 'status', code: 429, retryAfter: '3' },
        'release-404': { route: 'release', kind: 'status', code: 404 },
        'captive-portal': { route: 'release', kind: 'body', text: '<!doctype html><title>Wi-Fi sign in</title><form>Sign in to this network</form>', contentType: 'text/html' },
        'release-unsigned': { route: 'release', kind: 'body', text: badSignature, contentType: 'application/json' },
      };
      const rule = rules[item.id];
      if (rule === undefined) throw new Error(`releaseFault has no rule for ${item.id}`);
      const entered = await fresh(); const { page } = entered;
      try {
        const before = await control(); await arm(item.id, [rule]);
        const started = Date.now(); await page.goto(URL_PLAY);
        // the Name box comes before the read on a page with no seat yet
        const seen = await (async () => { const until = Date.now() + 30_000; while (Date.now() < until) { if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) { await page.locator('#ws-name-box input').fill('fmboot'); await page.locator('#ws-name-box button[type=submit]').click(); } const found = await screen(page, item.screen, 500, started); if (found !== null) return found; } return null; })();
        const shot = await shoot(page, item.id, seen === null ? 'missing' : 'page');
        const injection = { releaseMatches: await matchedSince(before, 'release'), upgrades: (await control()).counters.upgrades - before.counters.upgrades };
        if (injection.releaseMatches === 0) return { outcome: 'harness-fail', reason: 'the release fault matched nothing', injection, notes: await onScreen(page) };
        if (item.id === 'release-unsigned' && injection.upgrades > 0) return { outcome: 'ui-fail', reason: 'the page dialled on a release it could not verify', seen, injection, shot };
        const result = await judged(seen, item, page);
        await heal();
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        await press(page, item.screen, 'Try').catch(() => undefined);
        await intoWorld(entered, 60_000).catch(() => undefined);
        return await recovered(page, 30_000) ? { ...result, injection, shot, recovery: 'healed: the world loads' } : { outcome: 'ui-fail', reason: 'no recovery after heal', seen, injection, shot, notes: await onScreen(page) };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM6: packs and the spawn book fail on the loading card
    packsFault: async item => {
      /** @type {Record<string, object>} */
      const rules = {
        'packs-5xx': { route: 'packs', kind: 'status', code: 503 },
        'packs-429': { route: 'packs', kind: 'status', code: 429, retryAfter: '3' },
        'book-5xx': { route: 'book', kind: 'status', code: 503 },
        'download-failed': { route: 'packs', kind: 'status', code: 503 },
        'pack-broken': { route: 'packs', kind: 'truncate', bytes: 64 },
      };
      const rule = rules[item.id];
      if (rule === undefined) throw new Error(`packsFault has no rule for ${item.id}`);
      const entered = await fresh(); const { page } = entered, route = item.id === 'book-5xx' ? 'book' : 'packs';
      try {
        const before = await control(); await arm(item.id, [rule]);
        const started = Date.now(); await page.goto(URL_PLAY);
        const seen = await (async () => { const until = Date.now() + (item.id === 'download-failed' ? 120_000 : 40_000); while (Date.now() < until) { if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) { await page.locator('#ws-name-box input').fill('fmload'); await page.locator('#ws-name-box button[type=submit]').click(); } const found = await screen(page, item.screen, 500, started); if (found !== null) return found; } return null; })();
        const shot = await shoot(page, item.id, seen === null ? 'missing' : 'line');
        const injection = { matches: await matchedSince(before, route) };
        await heal();
        if (injection.matches === 0) return { outcome: 'harness-fail', reason: `the ${route} fault matched nothing (the proxy learns pack URLs from the manifests it forwards)`, injection, notes: await onScreen(page) };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        // the budgeted retries were spent before the line showed: healed, the card's Retry is the player's way on
        // mode 36's page covers the card: its Try again is the same RETRY
        // a broken pack is refused by every read of its part, so the spawn job may give up (mode 36's page) before the heal: press what shows
        const covered = item.id === 'download-failed' || (await visibleIds(page)).some(ids => /\bdownload-failed\b/u.test(ids));
        const retry = covered ? page.locator('[data-failmode~="download-failed"] button', { hasText: 'Try again' }).first() : page.locator('.ws-load-retry:visible').first();
        const pressed = await retry.click({ timeout: 5000 }).then(() => true, () => false);
        await intoWorld(entered, 90_000).catch(() => undefined);
        return await recovered(page, 30_000) ? { ...result, injection, shot, recovery: pressed ? 'heal, Retry: the world loads' : 'heal: the world loads' } : { outcome: 'ui-fail', reason: 'no recovery after heal', seen, injection, shot, notes: await onScreen(page) };
      } finally { await heal(); await entered.context.close(); }
    },
    // FM6: Chromium exercises native origin quota. WebKit's public Cache API refusal is explicitly injected.
    storageFull: async item => {
      const entered = engine === 'chromium' ? await fresh() : await fresh(() => { Cache.prototype.put = () => Promise.reject(new DOMException('failmode-proof injected quota refusal', 'QuotaExceededError')); });
      const { page, context } = entered;
      const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
      let injection = /** @type {object} */ ({ cachePut: 'WebKit injected QuotaExceededError (page realm only; not native quota)' });
      try {
        if (cdp !== null) {
          await cdp.send('Storage.overrideQuotaForOrigin', { origin: PAGE_ORIGIN, quotaSize: 1 });
          const quota = await cdp.send('Storage.getUsageAndQuota', { origin: PAGE_ORIGIN });
          if (!quota.overrideActive || quota.quota !== 1) return { outcome: 'harness-fail', reason: 'native origin quota was not actually applied', injection: quota };
          injection = { kind: 'native Chromium origin quota', bytes: quota.quota, overrideActive: quota.overrideActive };
        }
        const started = Date.now(); await page.goto(URL_PLAY, { waitUntil: 'domcontentloaded' });
        // The line exists while downloading. Waiting for control before observing it misses a truthful transient screen.
        const seen = await (async () => {
          const until = Date.now() + 60_000;
          while (Date.now() < until) {
            // Native quota also refuses the fresh profile's name save. Submit the real first-open form before
            // observing the download, as the other fresh-loading cases do; never seed storage past the fault.
            if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) {
              await page.locator('#ws-name-box input').fill('fmquota');
              await page.locator('#ws-name-box button[type=submit]').click();
            }
            const found = await screen(page, item.screen, 500, started);
            if (found !== null) return found;
          }
          return null;
        })(), shot = await shoot(page, item.id, seen === null ? 'missing' : 'line');
        const result = await judged(seen, item, page);
        await intoWorld(entered, 90_000).catch(() => undefined);
        const playing = await recovered(page, 15_000);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        return playing ? { ...result, injection, shot, recovery: 'plays on from memory' } : { outcome: 'ui-fail', reason: 'the world never played', seen, injection, shot };
      } finally {
        if (cdp !== null) { await cdp.send('Storage.overrideQuotaForOrigin', { origin: PAGE_ORIGIN }); await cdp.detach(); }
        await entered.context.close();
      }
    },
    // FM4b mode 42: the device clock 2 min ahead; the Doctor measures it against the page's host
    clockSkew: async item => {
      const entered = await fresh(() => {
        const Real = Date, skew = () => /** @type {number} */ (/** @type {any} */ (globalThis).__fmSkew ?? 120_000);
        class Skewed extends Real { constructor(/** @type {any[]} */ ...given) { if (given.length === 0) super(Real.now() + skew()); else super(.../** @type {[any]} */ (given)); } static now() { return Real.now() + skew(); } }
        globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (Skewed));
      });
      const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const started = Date.now();
        await Promise.all([page.waitForURL(/\/doctor\//u, { timeout: 20_000 }), page.evaluate(() => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: 'link' })); })]);
        const seen = await screen(page, item.screen, 45_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'doctor');
        const result = await judged(seen, item, page), injection = { pageClockAheadMs: 120_000 };
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        await page.evaluate(() => { /** @type {any} */ (globalThis).__fmSkew = 0; });
        await page.locator('button', { hasText: 'Run again' }).first().click();
        const cleared = await page.locator(`[data-failmode~="${item.screen}"]`).waitFor({ state: 'detached', timeout: 45_000 }).then(() => true, () => false);
        return cleared ? { ...result, injection, shot, recovery: 'Run again with the clock right: no warning' } : { outcome: 'ui-fail', reason: 'the warning stayed after Run again with the clock right', seen, injection, shot };
      } finally { await entered.context.close(); }
    },
    // FM5 mode 46: a release signed for staging (loopback fixture only)
    staging: async item => {
      rig.publish(2, rig.build, 'staging');
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(URL_PLAY); await intoWorld(entered);
        const seen = await screen(page, item.screen, 10_000), shot = await shoot(page, item.id, seen === null ? 'missing' : 'notice');
        const result = await judged(seen, item, page);
        return { ...result, shot, injection: { channel: 'staging', loopback: true }, ...result.outcome === 'pass' ? { recovery: 'stays for the session' } : {} };
      } finally { rig.publish(3, rig.build, 'production'); await entered.context.close(); }
    },
  };

  // FM1b: the Developer gallery, by real taps only (the menu, the filter, the row's Open, each entry, its ✕)
  if (galleryWalk) {
    const entered = await fresh(); const { page } = entered;
    /** @type {{ id: string, size: string, opened: boolean, closed: boolean, shot?: string, ms: number }[]} */
    const walked = [];
    try {
      await page.goto(URL_PLAY); await intoWorld(entered);
      const list = page.locator('[data-kind="gallery"]');
      const openGallery = async () => {
        if (await list.isVisible().catch(() => false)) return;
        const filter = page.locator('.ws-gmenu.show .ws-dbg-filter:visible').first();
        if (!await filter.isVisible().catch(() => false)) {
          // the gallery is Developer only (E140): System's Developer switch shows the Dev tab, whose cards open folded
          await settingsTab(page, 'system');
          const devTab = page.locator('.ws-gmenu.show [data-sv-tab="dev"]').first();
          if (!await devTab.isVisible().catch(() => false)) await page.locator('.ws-gmenu.show .ws-gmenu-label', { hasText: /^Developer$/u }).locator('xpath=following-sibling::button[1]').first().click({ timeout: 10_000 });
          await devTab.click({ timeout: 10_000 });
          // the gallery's row is a Developer tool ('tools' group), in the Developer card
          const tools = page.locator('.ws-gmenu.show .ws-gmenu-card.fold', { has: page.locator('.ws-gmenu-cardtitle', { hasText: /^Developer/u }) }).first();
          if (await tools.evaluate(node => node.classList.contains('folded')).catch(() => false)) await tools.locator('.ws-gmenu-cardtitle').first().click({ timeout: 10_000 });
        }
        if (process.env['FM_TRACE'] === '1') console.log('  [gallery]', JSON.stringify(await page.evaluate(() => ({
          tabs: [...document.querySelectorAll('.ws-gmenu.show [data-sv-tab]')].map(n => n.getAttribute('data-sv-tab') + (n.hidden ? ':hidden' : '') + (n.getAttribute('aria-selected') === 'true' ? ':on' : '')),
          filters: [...document.querySelectorAll('.ws-dbg-filter')].map(n => { const r = n.getBoundingClientRect(); return (n.closest('.ws-gmenu.show') ? 'in ' : 'out ') + String(r.width) + 'x' + String(r.height); }),
          cards: [...document.querySelectorAll('.ws-gmenu.show .ws-gmenu-card.fold')].map(n => (n.querySelector('.ws-gmenu-cardtitle')?.textContent ?? '') + (n.classList.contains('folded') ? ':folded' : '') + (n.hidden ? ':hidden' : '')),
        })).catch(error => String(error))));
        await filter.fill('Failure screens');
        await page.locator('.ws-gmenu.show .ws-dbg-row:visible', { hasText: 'Failure screens' }).locator('.ws-dbg-action:visible').first().click({ timeout: 10_000 });
        await list.waitFor({ state: 'visible', timeout: 15_000 });
      };
      for (const size of [{ width: 402, height: 874 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size);
        await openGallery();
        const ids = await list.locator('button[data-failmode]').evaluateAll(nodes => nodes.map(node => node instanceof HTMLElement ? node.dataset.failmode ?? '' : ''));
        for (const id of ids) {
          const at = Date.now();
          await openGallery();
          await list.locator(`button[data-failmode="${id}"]`).click({ timeout: 10_000 });
          const screenNode = page.locator(`.ws-fail[data-failmode="${id}"]:not(.ws-fail-proto)`).first();
          const opened = await screenNode.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
          const shot = opened ? await shoot(page, `gallery-${id}`, `${String(size.width)}x${String(size.height)}`) : undefined;
          await page.locator('.ws-fail-proto button[aria-label="Close"]').click({ timeout: 10_000 }).catch(() => undefined);
          const closed = await page.locator('.ws-fail').first().waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false);
          walked.push({ id, size: `${String(size.width)}x${String(size.height)}`, opened, closed, ...shot === undefined ? {} : { shot }, ms: Date.now() - at });
          console.log(`${opened && closed ? 'pass' : 'ui-fail'} gallery ${id} ${String(size.width)}x${String(size.height)}`);
        }
      }
    } finally { await entered.context.close(); }
    const ok = walked.length > 0 && walked.every(row => row.opened && row.closed);
    writeFileSync(join(out, 'gallery.json'), JSON.stringify({ schema: 'failmode-gallery/1', sha, engine, browser: browserVersion, build: fixture.build, at: new Date().toISOString(),
      entries: new Set(walked.map(row => row.id)).size, taps: 'menu Escape, System Developer switch, Dev tab, Developer card, filter, row Open, entry, ✕ Close', ok, walked }, null, 1));
    rows.push({ mode: 'FM1b', id: 'gallery', owner: 'FM1b', screen: 'gallery', inject: 'none', ms: 0, ...ok ? { outcome: 'pass' } : { outcome: 'ui-fail', reason: 'an entry did not open or close' } });
  }
  let lastPlay = 0;
  for (const item of cases) {
    let started = Date.now();
    /** @type {Result} */
    let result;
    pageFaults = [];
    guardFaults.length = 0;
    if (item.blocked !== undefined) result = { outcome: 'blocked-dependency', reason: item.blocked };
    else if (item.chromiumOnly === true && engine !== 'chromium') result = { outcome: 'unsupported', reason: `${engine} cannot produce this lifecycle fault; a native-Safari Ring 2 proof is owed` };
    else {
      const runner = runners[item.run ?? ''];
      if (runner === undefined) throw new Error(`no runner ${String(item.run)} for ${item.id}`);
      // the server's 10 connects a minute per address: play cases wait it out, never lift it
      if (item.phase !== 'boot' || item.id === 'offline-launch') { const wait = lastPlay + cooldownMs - Date.now(); if (wait > 0) { console.log(`.. ${item.id}: waiting ${String(Math.round(wait / 1000))} s for the connect window`); await sleep(wait); } }
      started = Date.now();
      try { result = await runner(item); } catch (error) { result = { outcome: 'harness-fail', reason: String(error).slice(0, 400) }; }
      lastPlay = Date.now();
    }
    if (guardFaults.length > 0 || pageFaults.length > 0) result = { outcome: 'harness-fail', reason: guardFaults[0] ?? `uncaught page exception: ${pageFaults[0]}` };
    result = qualifyResult(item, result, Date.now() - started);
    const row = { deadlineMs: item.deadlineMs, mode: item.mode, id: item.id, owner: item.owner, screen: item.screen, inject: item.inject, ms: Date.now() - started, ...result };
    rows.push(row);
    console.log(`${result.outcome.padEnd(18)} ${item.mode.padEnd(4)} ${item.id}${result.reason === undefined ? '' : `: ${result.reason}`}`);
    if (result.outcome === 'harness-fail' && !baseline) break;
  }
} catch (error) {
  harnessFault = String(error).slice(0, 600);
  console.log(`harness-fail: ${harnessFault}`);
} finally {
  const cleanup = /** @type {string[]} */ ([]);
  await launched?.close().catch((/** @type {unknown} */ error) => { cleanup.push(`browser: ${String(error)}`); });
  await proxy?.close().catch((/** @type {unknown} */ error) => { cleanup.push(`proxy: ${String(error)}`); });
  await rig.close().catch((/** @type {unknown} */ error) => { cleanup.push(`rig: ${String(error)}`); });
  if (cleanup.length > 0) harnessFault = `${harnessFault ?? ''} cleanup: ${cleanup.join('; ')}`.trim();
}
const code = harnessFault !== null ? 2 : verdict(rows);
/** @type {Record<string, number>} */
const counts = {};
for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ schema: 'failmode-proof/1', sha, engine, browser: browserVersion, baseline, build: fixture.build, channel: 'loopback-fixture', at: new Date().toISOString(), pages: PAGE_ORIGIN, socket: SOCKET,
  saves: pgBin === 'memory:' ? 'memory (no persistence case selected reads them)' : 'owned Postgres', harnessFault, counts, exit: code, cases: rows }, null, 1));
console.log(`${JSON.stringify(counts)} -> ${join(out, 'receipt.json')}`);
process.exit(code);
