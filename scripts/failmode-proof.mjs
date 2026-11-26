#!/usr/bin/env node
// FM3 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): the failure proof on an owned loopback rig. The rig of
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
// FM11 runs this proof in Ring 2 and after related pushes. It never runs in pre-push.
//
// The server lets 10 connects a minute in per address and every page here is 127.0.0.1, so play cases wait out the minute between
// them (`--cooldown=<s>`, 60) rather than lifting the cap; a long outage is held by refused upgrades that never reach the server.
//
//   node scripts/failmode-proof.mjs --prepare <work> [--next]
//                                                       a fixture key (<work>/key.json, 0600) and a Driftwood build stamped with the
//                                                       proxy's release address (<work>/dist). `--next` writes a second document
//                                                       identity over the same compiled bytes (<work>/next).
//   scripts/browser-lane.sh node scripts/failmode-proof.mjs <dist> <work> <key.json> <pg bin|memory:|pglite:> <pg data>
//       (pglite: PGlite in this process behind the rig's database front, which FM8s's save cases hold and refuse)
//       [--engine=chromium|webkit] [--scenario=<id,...>|all] [--baseline] [--cooldown=<s>] [--next=<work>/next]
//       [--seats=2]   (mode 25 on the door's own line: two pages take both seats, two more wait in line)
//       (`--next`: the second build, for a deploy under play (10), under a title tap (10b) and a retired build (24, FM5b4); the rig's
//        `move`, `pageView` and `retain` carry the release, the world and the page origin between the two builds)
// Ports: the rig from WS_RIG_PORTS (18856 here: Postgres 18856, world 18857, pages 18858, release 18859), the proxy's pages on 18851 and
// its world door on 18852. The fixture release is signed by the owned key only, channel production on loopback (staging for mode 46).
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import { openChaosProxy } from './chaos-proxy-core.mjs';
import { openApiFixture } from './failmode-api-fixture.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { BOOT_SCREEN_MS, bootScreenWait, qualifyResult } from './failmode-results.mjs';
import { nextFailmodeDeploy } from './failmode-deploy-fixture.mjs';
import { claimFixture, fixtureKey, fixtureRequestOrigins } from './online-rig-owned.mjs';
import { rawLeak, selectCases, verdict } from './failmode-cases.mjs';
import { enterZone } from './zone-entry.mjs';

/** The title's logo: the page is on the title (the address names no zone, CHUNK-PARAM-REMOVAL CP16, J522). */
const TITLE_LOGO = '.ws-main-logo';
/** @param {import('playwright').Page} page @param {number} timeout */
const titleShown = (page, timeout) => page.locator(TITLE_LOGO).first().waitFor({ state: 'visible', timeout });
/** A world is a page with a player standing in it. @param {import('playwright').Page} page */
const inWorld = page => page.evaluate(() => window.__wildshard?.world?.player !== undefined).catch(() => false);

process.env.WS_RIG_PORTS ??= '18856';
const rigPort = Number(process.env.WS_RIG_PORTS);
if (!Number.isSafeInteger(rigPort) || rigPort < 1029 || rigPort > 65532) throw new Error('WS_RIG_PORTS must reserve explicit unprivileged fixture ports');
const ROOT = absolute(import.meta.dirname, '..'), PROXY_PAGE = rigPort - 5, PROXY_WORLD = rigPort - 4, PROXY_TLS = rigPort - 3, SHARD = 'driftwood-isle';
const PAGE_ORIGIN = `http://127.0.0.1:${String(PROXY_PAGE)}`, RELEASE_URL = `${PAGE_ORIGIN}/__release.json`, SOCKET = `ws://127.0.0.1:${String(PROXY_WORLD)}/`;
const args = process.argv.slice(2), positional = args.filter(value => !value.startsWith('--'));
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
if (!/^[a-f0-9]{40}$/u.test(sha) || (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== sha)) {
  throw new Error('FM11 requires the exact source SHA');
}

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
  const key = JSON.parse(readFileSync(keyFile, 'utf8'));
  const environment = { ...process.env, WILDSHARD_RELEASE_URL: RELEASE_URL, WILDSHARD_RELEASE_KEY: key.public, VITE_API_ORIGIN: PAGE_ORIGIN };
  const folder = join(work, 'dist');
  // Build once with Ring 1's pins plus the pinned Driftwood client product admitted, on a runner and on a laptop alike.
  // The fixture is baked from this source and carries no live deployment. Not `build:ring` nor `serve-build.sh`: both
  // are preview builds (`--mode preview`, 9b2113fc2), and a preview never names a world; this one names the loopback release.
  const hosted = process.env.GITHUB_ACTIONS === 'true';
  const output = hosted ? join(ROOT, 'dist') : folder;
  if (existsSync(output)) throw new Error(hosted ? 'The hosted fixture needs a fresh build directory' : `${folder} already holds a build: prepare into a fresh <work>`);
  // A laptop's tree gets its whole pinned product set back afterwards: Ring 1 alone would leave the next build short.
  const restore = hosted ? '' : ' ; status=$? ; { node scripts/pins.ts install && node scripts/gen.mjs --inputs-only; } >/dev/null || status=1 ; exit $status';
  const built = spawnSync('python3', ['scripts/heavy-lane.py', 'build', '--', 'bash', '-c',
    `{ node scripts/pins.ts install --ring 1 ${SHARD} && node scripts/gen.mjs --inputs-only && WILDSHARD_CATALOGUE=out/.ring-catalogue.json node scripts/build-app.mjs --outDir "$1"; }${restore}`,
    'bash', output], { cwd: ROOT, env: { ...environment, GITHUB_EVENT_NAME: undefined, WS_RELEASE: '0' }, stdio: 'inherit' });
  if (built.status !== 0) throw new Error(hosted ? 'The hosted fixture build failed' : 'The fixture build failed (or its pins did not restore)');
  if (hosted) renameSync(output, folder);
  if (!readFileSync(join(folder, 'index.html'), 'utf8').includes(RELEASE_URL)) throw new Error('The fixture build is missing the loopback release address');
  const build = /** @type {string} */ (JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8')).build);
  if (!build.startsWith(sha.slice(0, 7))) throw new Error('The fixture build is from another source SHA');
  const nextFolder = join(work, 'next');
  const nextBuild = args.includes('--next') ? nextFailmodeDeploy(folder, nextFolder) : undefined;
  if (nextBuild !== undefined) {
    const worker = spawnSync(process.execPath, ['--import', './scripts/bake-loader.mjs', '--input-type=module', '-e',
      "await (await import('./scripts/app-build/serviceWorker.ts')).writeServiceWorker(process.argv[1], process.cwd());", nextFolder],
    { cwd: ROOT, stdio: 'inherit' });
    if (worker.status !== 0) throw new Error('The next fixture worker could not be written');
  }
  writeFileSync(join(work, 'fixture.json'), JSON.stringify({ schema: 'failmode-fixture/1', sha, release: RELEASE_URL, api: PAGE_ORIGIN, publicKey: key.public, build, next: nextBuild }));
  console.log(JSON.stringify({ dist: folder, ...nextBuild === undefined ? {} : { next: nextFolder }, sha }));
  process.exit(0);
}

const [dist = '', work = '', keyFile = '', pgBin = '', pgData = ''] = positional;
if (pgData === '' && pgBin !== 'memory:' && pgBin !== 'pglite:') throw new Error('failmode-proof <dist> <work> <key.json> <pg bin|memory:|pglite:> <pg data>');
const engine = flag('engine', 'chromium'), baseline = args.includes('--baseline'), cooldownMs = Number(flag('cooldown', '60')) * 1000;
// FM7b2/FM4 mode 25: `--seats=2` makes the door itself full (two seated pages), for the real waiting line; without it `full` is the
// proxy's injected close, which carries no place in line
const seats = flag('seats', '');
// FM4b mode 7: an owned self-signed PEM pair for the proxy's TLS fault listener (never a production certificate); absent: `tls` is blocked
const tlsCert = flag('tls-cert', ''), tlsKey = flag('tls-key', '');
if ((tlsCert === '') !== (tlsKey === '')) throw new Error('--tls-cert and --tls-key go together');
if (seats !== '' && !/^[1-9]$/u.test(seats)) throw new Error('--seats=<1-9>');
if (engine !== 'chromium' && engine !== 'webkit') throw new Error('--engine=chromium|webkit');
// `--refusal=screen|injection` proves strict mode refuses: a drop that must show a screen no build has (exit 1), and a fault armed on
// a route the page never reads, so it matches nothing (exit 2). Neither is a catalogue case.
const refusal = flag('refusal', '');
if (!['', 'screen', 'injection'].includes(refusal)) throw new Error('--refusal=screen|injection');
const drop = selectCases('drop')[0];
const cases = refusal === '' ? selectCases(flag('scenario', 'all')) : drop === undefined ? [] : [refusal === 'screen' ? { ...drop, id: 'drop', screen: 'no-such-screen', mode: 'R1' } : { ...drop, id: 'unmatched', run: 'unmatched', mode: 'R2' }], out = join(absolute(work), 'failmodes'), shots = join(out, 'shots');
if (!readFileSync(join(dist, 'index.html'), 'utf8').includes(RELEASE_URL)) throw new Error(`${dist} is not stamped with ${RELEASE_URL}: build it with --prepare`);
fixtureKey(keyFile);
const fixture = JSON.parse(readFileSync(join(absolute(dist, '..'), 'fixture.json'), 'utf8'));
if (fixture.schema !== 'failmode-fixture/1' || fixture.sha !== sha || fixture.release !== RELEASE_URL || fixture.api !== PAGE_ORIGIN || fixture.publicKey !== fixtureKey(keyFile).public || fixture.build !== JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).build) throw new Error('The owned fixture SHA, stamp, key and build must agree');
// the second build: stamped alike, prepared beside the first (fixture.json names it)
const nextDist = flag('next', '');
if (nextDist !== '' && (!readFileSync(join(nextDist, 'index.html'), 'utf8').includes(RELEASE_URL) || fixture.next !== JSON.parse(readFileSync(join(nextDist, 'version.json'), 'utf8')).build)) throw new Error(`${nextDist} is not the prepared second build: --prepare <work> --next`);
const NEEDS_NEXT = 'needs the second build: --prepare <work> --next, then --next=<work>/next';
claimFixture(work); mkdirSync(shots, { recursive: true });

/** @typedef {import('./failmode-cases.mjs').Case} Case */
/** @typedef {import('./failmode-cases.mjs').Outcome} Outcome */
/** @typedef {{ page: import('playwright').Page, context: import('playwright').BrowserContext, errors: string[] }} Entered */
/** @typedef {{ outcome: Outcome, reason?: string, seen?: Seen | null, injection?: unknown, recovery?: string, shot?: string, notes?: unknown }} Result */
/** @typedef {{ ids: string, ms: number, copy: string, leak: string | null }} Seen */

const { openRig } = await import('./online-rig.mjs');
// FM8b modes 27 to 29: the owned local API (failmode-api-fixture.mjs) behind the proxy's `api` route, whose per-run ticket key the rig
// door checks (PLAYER_TICKET_PUBLIC_KEY in its environment). Opened only when a sign-in case runs, so every other case sees what it saw.
const apiFixture = cases.some(item => item.owner === 'FM8b') ? await openApiFixture({ port: rigPort - 2 }) : null;
if (apiFixture !== null) process.env.PLAYER_TICKET_PUBLIC_KEY = apiFixture.publicKey;
let rig;
try { rig = await openRig({ dist, nextDist, work: join(absolute(work), 'rig'), keyFile, pgBin, pgData, shard: SHARD, socket: SOCKET, origins: [PAGE_ORIGIN], isolated: true, ...seats === '' ? {} : { seats: Number(seats) } }); } catch (error) {
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ schema: 'failmode-proof/1', sha, engine, baseline, phase: 'setup', harnessFault: String(error).slice(0, 600), exit: 2, cases: [] }));
  process.exit(2);
}
let proxy = /** @type {Awaited<ReturnType<typeof openChaosProxy>> | null} */ (null), launched = /** @type {import('playwright').Browser | null} */ (null);
const rows = /** @type {(Result & { mode: string, id: string, owner: string, screen: string, inject: string, ms: number })[]} */ ([]);
let browserVersion = '';
let harnessFault = /** @type {string | null} */ (null);
try {
  // openChaosProxy claims its fresh directory; never delete pre-existing fixture files.
  proxy = await openChaosProxy({ work: join(absolute(work), 'proxy'), pageUpstream: rig.base, releaseUpstream: `http://127.0.0.1:${String(Number(process.env.WS_RIG_PORTS) + 3)}`, worldUpstream: `http://127.0.0.1:${String(Number(process.env.WS_RIG_PORTS) + 1)}`, pagePort: PROXY_PAGE, worldPort: PROXY_WORLD,
    ...tlsCert === '' ? {} : { tlsPort: PROXY_TLS, tlsCert, tlsKey }, ...apiFixture === null ? {} : { apiUpstream: apiFixture.origin } });
  const token = readFileSync(proxy.ready.tokenFile, 'utf8');
  /** The proxy's state, or its rules replaced. @param {{ scenario: string, rules: object[] }} [body] */
  const control = async body => {
    const response = await fetch(proxy?.ready.controlUrl ?? '', { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
    if (!response.ok) throw new Error(`chaos control ${String(response.status)}`);
    return /** @type {{ counters: { upgrades: number, tlsRefused: number, matches: Record<string, number> }, events: object[], activeConnections: number }} */ (await response.json());
  };
  /** @param {string} scenario @param {object[]} rules */
  const arm = (scenario, rules) => control({ scenario, rules });
  const heal = () => control({ scenario: 'healthy', rules: [] });
  /** matches on a route since a snapshot @param {Awaited<ReturnType<typeof control>>} before @param {string} route */
  const matchedSince = async (before, route) => ((await control()).counters.matches[route] ?? 0) - (before.counters.matches[route] ?? 0);

  launched = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--mute-audio', '--ignore-gpu-blocklist',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    // FM8 mode 32: a fake microphone (a tone) with no permission prompt, for the two-page voice case
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  browserVersion = launched.version();
  const { defaultBrowserType: _engine, ...device } = devices['iPhone 16 Pro'];
  // FM11: a hosted runner draws with SwiftShader; at the phone's 3x a Driftwood frame (and so a screenshot) outlasts 30 s, so off macOS
  // the phone draws at 1x. Layout, touch and the mobile frame cap are the phone's either way.
  const phone = { ...device, ...(process.platform === 'darwin' ? {} : { deviceScaleFactor: 1 }), viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 } };
  const allowedOrigins = fixtureRequestOrigins(PAGE_ORIGIN, SOCKET);
  /** WebSocket dials the pages made, by origin (FM4b modes 6 and 7 count their negative target's) */
  const socketDials = /** @type {Map<string, number>} */ (new Map());
  const guardFaults = /** @type {string[]} */ ([]);
  let pageFaults = /** @type {string[]} */ ([]);
  /** CHUNK-PARAM-REMOVAL CP16 (J522): a play page enters by the tap, as a Zone Select pick does; the address names no zone.
   *  @param {import('playwright').Page} page */
  const play = page => enterZone(page, { zone: SHARD, base: PAGE_ORIGIN, flags: 'mute=1&nolock=1&skipintro=1' });
  /** A fresh device: its own context, Developer on, its errors and visibility changes kept.
   *  `observe`: the off-fixture guard watches instead of routing. Playwright's routing disables the HTTP cache, and Chromium then hands
   *  a service worker every read as `cache: 'no-store'`, which sw.js rightly sends to the network: a warmed page could never launch
   *  offline under it (FM5 mode 1). An off-fixture request there is still a guard fault, seen rather than refused.
   *  `desktop`: a 1440×900 desktop browser instead of the phone (a phone context held landscape shows the portrait-only card).
   *  @param {(() => void) | string} [init] @param {{ observe?: boolean, desktop?: boolean }} [how] */
  const fresh = async (init, how = {}) => {
    const context = await /** @type {import('playwright').Browser} */ (launched).newContext(how.desktop === true ? { viewport: { width: 1440, height: 900 } } : phone), errors = /** @type {string[]} */ ([]);
    if (how.observe === true) context.on('request', request => { if (!allowedOrigins.has(new URL(request.url()).origin)) guardFaults.push('saw an off-fixture HTTP request (observe-only guard)'); });
    else await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (allowedOrigins.has(url.origin)) await route.continue();
      else { guardFaults.push('refused off-fixture HTTP request'); await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', async socket => {
      const origin = new URL(socket.url()).origin;
      socketDials.set(origin, (socketDials.get(origin) ?? 0) + 1);
      if (allowedOrigins.has(origin)) socket.connectToServer();
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
  const shoot = async (page, id, what) => { const file = `${id.replace('/', '-')}-${what}.png`; await page.screenshot({ path: join(shots, file), scale: 'css', timeout: 60_000 }); return file; };
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
  /** The build this page runs, polled across its own reloads (null while it navigates). @param {import('playwright').Page} page @param {string} build @param {number} timeout */
  const onBuild = async (page, build, timeout) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await page.evaluate(() => /** @type {{ __WS_BUILD_ID__?: string }} */ (/** @type {unknown} */ (globalThis)).__WS_BUILD_ID__).catch(() => null) === build) return true;
      await sleep(250);
    }
    return false;
  };
  /** Mode 10's recovery (J174: countdown, preload, reconnect): the link is live on the moved world and frames flow again. The page may
   *  stay on its build (the same wire plays on) or reload into the new one; the receipt names which. @param {import('playwright').Page} page */
  const backInPlay = async (/** @type {import('playwright').Page} */ page, timeout = 120_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const live = await page.evaluate(() => typeof window.__workerClient === 'function' && window.__workerClient().own !== null && window.__workerClient().closed === null).catch(() => false);
      if (live) { const before = await frames(page); await sleep(1000); if (await frames(page) > before + 10) return true; }
      await sleep(500);
    }
    return false;
  };
  /** Whether this page holds a seat. @param {import('playwright').Page} page */
  const seated = page => page.evaluate(() => typeof window.__workerClient === 'function' && window.__workerClient().own !== null).catch(() => false);
  /** Whether this page holds a seat on a link that is still open. @param {import('playwright').Page} page */
  const linkOpen = page => page.evaluate(() => typeof window.__workerClient === 'function' && window.__workerClient().own !== null && window.__workerClient().closed === null).catch(() => false);
  /** A case's device goes as a player's does: a seated page takes Leave the world (pause ▸ main menu), whose clean quit frees its
   *  seat at the door at once, then the context closes. A bare close leaves the seat held for HOLD_MS (5 min), and under `--seats=2`
   *  two held seats filled the door by the third case: every later play case was refused `full` (QA 11-25 row 65: modes 6, 9, 10,
   *  10b, 13, 16, 17 and 17b on the nightly). @param {Entered} entered */
  const leave = async entered => {
    const { page, context } = entered;
    // a case that ends mid-redial (its finally healed a moment ago) still holds the old link's seat: let the redial seat first, or
    // the quit has no link to go on and the seat stays held (run 4 of row 65: 16b and 17 refused full after 15b and 16)
    // the address names no zone (J522): a world is a page with a player in it, the title a page with its logo
    for (const until = Date.now() + 20_000; await inWorld(page) && !await linkOpen(page) && Date.now() < until;) await sleep(500);
    if (await linkOpen(page)) {
      const left = titleShown(page, 8000).then(() => true, () => false);
      if (await page.evaluate(() => document.dispatchEvent(new Event('ws:exit-to-main'))).then(() => true, () => false)) await left;
    }
    await context.close();
  };
  // FM5b4/mode 10: the rig back on the first build, with no page view or retention file, for the next case
  let onNext = false;
  const home = async () => {
    rig.pageView(null); rig.retain(null);
    if (onNext) { onNext = false; await rig.move(dist); }
  };
  /** The pause menu's Settings at one of its tabs, as a player gets there: Escape (the pause key), else the HUD's Settings button.
   *  @param {import('playwright').Page} page @param {'system' | 'dev'} tab */
  const settingsTab = async (page, tab) => {
    const menu = page.locator('.ws-gmenu.show');
    if (!await menu.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    if (!await menu.isVisible().catch(() => false)) await page.locator('button', { hasText: /^Settings$/u }).first().click({ timeout: 5000 }).catch(() => undefined);
    await menu.waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator(`.ws-gmenu.show [data-sv-tab="${tab}"]`).first().click({ timeout: 10_000 });
  };
  /** The player's own update check, Settings ▸ System ▸ Check (the manual twin of the foreground and 5 min reads), then back to play.
   *  @param {import('playwright').Page} page */
  const checkForUpdate = async page => {
    await settingsTab(page, 'system');
    await page.locator('.ws-gmenu.show .ws-gmenu-buildcheck').first().click({ timeout: 10_000 });
    await sleep(1000);
    for (let tries = 0; tries < 3 && await page.locator('.ws-gmenu.show').isVisible().catch(() => false); tries++) { await page.keyboard.press('Escape'); await sleep(300); }
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

  /** FM8b: ask the owned API for a link through the open sign-in card; the link it mailed. @param {import('playwright').Page} page @param {string} email */
  const mailedLink = async (page, email) => {
    const sentBefore = apiFixture?.outbox.length ?? 0;
    await page.locator('#ws-signin .ws-signin-email').fill(email);
    const send = page.locator('#ws-signin [data-signin="send"]');
    try { await send.click({ timeout: 10_000 }); } catch (error) {
      // what covers the button, so a layering fault names itself (opus-fm2: the link card sat over the in-world sign-in card)
      const over = await send.evaluate(button => { const box = button.getBoundingClientRect(), top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return top === null ? 'nothing' : `${top.tagName}#${top.id}.${top.className.slice(0, 60)} z=${getComputedStyle(top.closest('[class]') ?? top).zIndex} send-root z=${getComputedStyle(button.closest('#ws-signin') ?? button).zIndex}`; }).catch(() => 'unknown');
      throw new Error(`the sign-in card's send button took no click (on top: ${over}): ${String(error).split('\n')[0] ?? ''}`, { cause: error });
    }
    for (const until = Date.now() + 15_000; Date.now() < until; await sleep(200)) {
      const mail = apiFixture?.outbox.slice(sentBefore).find(row => row.email === email);
      if (mail !== undefined) return mail.link;
    }
    throw new Error(`the owned API mailed no link to ${email}`);
  };
  /** FM8b: has the rig's own save store placed a player matching `player` (SQL LIKE) since `afterMs`, within `timeout`?
   *  @param {string} player @param {number} afterMs @param {number} timeout */
  const placeAfter = async (player, afterMs, timeout) => {
    const until = Date.now() + timeout;
    for (;;) {
      const client = new rig.Client({ connectionString: rig.DATABASE });
      try {
        await client.connect();
        if ((await client.query('select 1 from player_place where player_id like $1 and updated_at > to_timestamp($2::double precision / 1000) limit 1', [player, afterMs])).rows.length > 0) return true;
      } catch { /* the database front may be busy: ask again */ } finally { await client.end().catch(() => undefined); }
      if (Date.now() >= until) return false;
      await sleep(1000);
    }
  };

  /** @type {Record<string, (item: Case) => Promise<Result>>} */
  const runners = {
    // FM8b modes 27 to 29 (meta MMO-FAILURE-MODES-PLAN): the page's real sign-in client against the owned local API
    // (failmode-api-fixture.mjs, the proxy's `api` route), and the rig door checking that API's tickets with the real ticket check.
    // Seats are read from the rig's own saves (pglite:), never from the page's word.
    authExpired: async item => {
      if (apiFixture === null) return { outcome: 'harness-fail', reason: 'the owned local API never opened' };
      if (rig.database === undefined) return { outcome: 'blocked-dependency', reason: 'the seat checks read the rig database: run with pglite:' };
      const account = `fm27-${String(Date.now() % 1_000_000)}@proof.test`, guestAccount = `fm27g-${String(Date.now() % 1_000_000)}@proof.test`;
      const signedInWorld = async (/** @type {string} */ email) => {
        const entered = await fresh(); const { page } = entered;
        await page.goto(`${PAGE_ORIGIN}/?mute=1&nolock=1`);
        await page.locator('.ws-main-signin').first().click({ timeout: 60_000 });
        const link = await mailedLink(page, email);
        await page.goto(link);
        await page.locator('#ws-signin[data-signed-in="true"]').waitFor({ state: 'visible', timeout: 30_000 });
        await play(page); await intoWorld(entered);
        return entered;
      };
      /** The session ends at the API (its own 401 from now), then one drop of the world socket; the card must come. */
      const endAndDrop = async (/** @type {import('playwright').Page} */ page, /** @type {string} */ named) => {
        const refusedBefore = apiFixture?.counts.ticketRefused ?? 0, ended = apiFixture?.expireSessions() ?? 0, before = await control();
        await arm(named, [{ route: 'socket', kind: 'drop-after', afterMs: 0 }]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        const socketMatches = await matchedSince(before, 'socket');
        await heal();
        const started = Date.now(), seen = await screen(page, item.screen, 20_000, started);
        return { seen, injection: { sessionsEnded: ended, socketMatches, ticketRefusals: (apiFixture?.counts.ticketRefused ?? 0) - refusedBefore } };
      };
      const first = await signedInWorld(account);
      try {
        const player = `account:plr_${apiFixture.playerOf(account) ?? '?'}`;
        if (!await placeAfter(player, 0, 120_000)) return { outcome: 'harness-fail', reason: 'the signed-in page never stood in the world as its account (no saved place)' };
        const { page } = first, { seen, injection } = await endAndDrop(page, 'auth-expired');
        const shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (injection.socketMatches === 0 || injection.ticketRefusals === 0) return { outcome: 'harness-fail', reason: 'the drop or the API\'s 401 matched nothing', injection };
        // recovery 1: Sign in, a new link opened in a second tab (a mail app's), the card closed: the page rejoins as the account
        await press(page, item.screen, 'Sign in');
        const link = await mailedLink(page, account), tab = await first.context.newPage();
        await tab.goto(link);
        await tab.locator('#ws-signin[data-signed-in="true"]').waitFor({ state: 'visible', timeout: 30_000 });
        await tab.close();
        const rejoinAt = Date.now(), ticketsBefore = apiFixture.counts.tickets;
        await page.locator('#ws-signin .ws-signin-close').click({ timeout: 10_000 });
        await intoWorld(first, 120_000);
        const asAccount = await placeAfter(player, rejoinAt, 120_000);
        const cardGone = !(await visibleIds(page)).some(ids => /\bauth-expired\b/u.test(ids));
        if (!asAccount || !cardGone || apiFixture.counts.tickets <= ticketsBefore) return { outcome: 'ui-fail', reason: `after signing in again: ${!asAccount ? 'no saved place as the account' : !cardGone ? 'the card stayed' : 'no fresh ticket was asked'}`, seen, injection, shot };
        // recovery 2 (explicit guest choice, on another device): Play as a guest rejoins as the device; the account is not written
        const second = await signedInWorld(guestAccount);
        try {
          const other = `account:plr_${apiFixture.playerOf(guestAccount) ?? '?'}`;
          if (!await placeAfter(other, 0, 120_000)) return { outcome: 'harness-fail', reason: 'the second page never stood in the world as its account', seen, injection, shot };
          const guestSeen = (await endAndDrop(second.page, 'auth-expired-guest')).seen;
          if (guestSeen === null) return { outcome: 'ui-fail', reason: 'the second page showed no signed-out card', seen, injection, shot };
          const guestAt = Date.now();
          await press(second.page, item.screen, 'Play as a guest');
          await intoWorld(second, 120_000);
          const asDevice = await placeAfter('device:%', guestAt, 120_000), accountQuiet = !await placeAfter(other, guestAt, 1000);
          const signedOut = await second.page.evaluate(() => Object.keys(localStorage).every(key => !key.includes('wildshard.player.session'))).catch(() => false);
          if (!asDevice || !accountQuiet) return { outcome: 'ui-fail', reason: `the guest choice: ${!asDevice ? 'no saved place as the device' : 'the account was written'}`, seen, injection, shot };
          return { ...result, injection, shot, recovery: `Sign in by a fresh link: rejoined as the account (saved place after the rejoin); Play as a guest: rejoined as the device${signedOut ? '' : ' (session key still listed)'}`, recoveryMs: Date.now() - rejoinAt };
        } finally { await leave(second); }
      } finally { await heal(); await leave(first); }
    },
    authFailed: async item => {
      if (apiFixture === null) return { outcome: 'harness-fail', reason: 'the owned local API never opened' };
      const entered = await fresh(); const { page } = entered;
      try {
        const refusedBefore = apiFixture.counts.linkRefused, started = Date.now();
        // a link the API never issued (or already spent): its redeem is the API's own 401
        await page.goto(`${PAGE_ORIGIN}/?mute=1&nolock=1#login=wsl_${'fmnolink'.repeat(4)}`);
        const seen = await screen(page, item.screen, 60_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const result = await judged(seen, item, page);
        const injection = { linkRefusals: apiFixture.counts.linkRefused - refusedBefore };
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (injection.linkRefusals === 0) return { outcome: 'harness-fail', reason: 'the API refused no link', injection };
        const healedAt = Date.now();
        await press(page, item.screen, 'Email me a new link');
        const link = await mailedLink(page, `fm28-${String(Date.now() % 1_000_000)}@proof.test`);
        await page.goto(link);
        const inNow = await page.locator('#ws-signin[data-signed-in="true"]').waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
        return inNow ? { ...result, injection, shot, recovery: 'Email me a new link, its link opened: signed in', recoveryMs: Date.now() - healedAt }
          : { outcome: 'ui-fail', reason: 'a fresh link never signed the page in', seen, injection, shot };
      } finally { await leave(entered); }
    },
    api5xx: async item => {
      if (apiFixture === null) return { outcome: 'harness-fail', reason: 'the owned local API never opened' };
      const entered = await fresh(); const { page } = entered;
      try {
        await page.goto(`${PAGE_ORIGIN}/?mute=1&nolock=1`);
        await page.locator('.ws-main-signin').first().click({ timeout: 60_000 });
        const before = await control();
        await arm('api-5xx', [{ route: 'api', kind: 'status', code: 503 }]);
        const sentBefore = apiFixture.counts.sent, started = Date.now();
        await page.locator('#ws-signin .ws-signin-email').fill(`fm29-${String(Date.now() % 1_000_000)}@proof.test`);
        await page.locator('#ws-signin [data-signin="send"]').click({ timeout: 10_000 });
        const seen = await screen(page, item.screen, 15_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const result = await judged(seen, item, page);
        const injection = { apiMatches: await matchedSince(before, 'api'), reachedApi: apiFixture.counts.sent - sentBefore };
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (injection.apiMatches === 0 || injection.reachedApi !== 0) return { outcome: 'harness-fail', reason: 'the 503 never matched, or a request reached the API through it', injection };
        const named = await page.locator('#ws-signin [data-failmode="api-5xx"] details').first().textContent().catch(() => '');
        if (!/answered 503/u.test(named ?? '')) return { outcome: 'ui-fail', reason: 'the card\'s Details do not name the status the page got', seen, injection, shot };
        // control: Play as a guest closes the card and the title stays (nothing signed in, nothing lost)
        await press(page, item.screen, 'Play as a guest');
        const closed = await page.locator('#ws-signin').waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, () => false);
        // recovery: the API answers again; Try now (the player's own tap) asks once more and the link is sent
        await page.locator('.ws-main-signin').first().click({ timeout: 10_000 });
        await page.locator('#ws-signin .ws-signin-email').fill(`fm29b-${String(Date.now() % 1_000_000)}@proof.test`);
        await page.locator('#ws-signin [data-signin="send"]').click({ timeout: 10_000 });
        const again = await screen(page, item.screen, 15_000);
        await heal();
        const healedAt = Date.now();
        if (again !== null) await press(page, item.screen, 'Try now');
        const sent = await page.locator('#ws-signin .ws-signin-note', { hasText: 'Check your email' }).waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
        const boxGone = !(await visibleIds(page)).some(ids => /\bapi-5xx\b/u.test(ids));
        return closed && again !== null && sent && boxGone && apiFixture.counts.sent > sentBefore
          ? { ...result, injection, shot, recovery: 'Play as a guest closed the card; heal, Try now: the link was sent', recoveryMs: Date.now() - healedAt }
          : { outcome: 'ui-fail', reason: !closed ? 'Play as a guest left the card up' : again === null ? 'the second ask showed no card' : !sent ? 'Try now never sent the link' : 'the card stayed after the link was sent', seen, injection, shot };
      } finally { await heal(); await leave(entered); }
    },
    // a fault on the world's socket, held, then healed
    socketDown: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
    },
    // FM7b2/FM4 mode 25 on the door's own line (`--seats=2`): two pages take both seats; a third and a fourth are refused with their
    // place (1, then 2) and no invented wait; the third's Title screen says the clean quit, so the fourth's next retry is first in line;
    // a seated page leaves and the fourth comes in by itself. Without --seats it is the proxy's injected close (socketDown).
    queue: async item => {
      if (seats === '') return runners.socketDown?.(item) ?? { outcome: 'harness-fail', reason: 'no socketDown runner' };
      if (seats !== '2') return { outcome: 'harness-fail', reason: 'the line case needs --seats=2' };
      const opened = /** @type {Entered[]} */ ([]);
      try {
        const sit = async () => { const entered = await fresh(); opened.push(entered); await play(entered.page); await intoWorld(entered); return entered; };
        const first = await sit(); await sit();
        // a page that waits in line: its Name, then the full card
        const wait = async () => {
          const entered = await fresh(); opened.push(entered); const { page } = entered, started = Date.now();
          await play(page);
          const named = await page.locator('#ws-name-box input').waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
          if (named) { await page.locator('#ws-name-box input').fill(`fm${String(Date.now() % 100_000)}`); await page.locator('#ws-name-box button[type=submit]').click(); }
          return { entered, seen: await screen(page, item.screen, 60_000, started) };
        };
        const { entered: third, seen: thirdSeen } = await wait();
        const result = await judged(thirdSeen, item, third.page), shot = await shoot(third.page, item.id, 'place-1');
        if (result.outcome !== 'pass') return { ...result, shot };
        if (!/Place 1 in line/u.test(thirdSeen?.copy ?? '') || !/estimating the wait/u.test(thirdSeen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the first in line was not told its place, or was given a wait nobody measured', seen: thirdSeen, shot };
        const { entered: fourth, seen: fourthSeen } = await wait(), secondShot = await shoot(fourth.page, item.id, 'place-2');
        if (!/Place 2 in line/u.test(fourthSeen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the second in line was not told place 2', seen: fourthSeen, shot: secondShot };
        // Title cancels: the third's quit, then it is on the title
        await press(third.page, item.screen, 'Title screen');
        await titleShown(third.page, 15_000);
        const moved = await fourth.page.locator(`[data-failmode~="${item.screen}"]`, { hasText: 'Place 1 in line' }).first().waitFor({ timeout: 45_000 }).then(() => true, () => false);
        const firstShot = await shoot(fourth.page, item.id, 'moved-up');
        if (!moved) return { outcome: 'ui-fail', reason: 'Title did not cancel the ticket ahead: the fourth never moved up', seen: fourthSeen, shot: firstShot, notes: await onScreen(fourth.page) };
        // a seat frees: the head of the line comes in by itself on its next retry
        const leaving = Date.now();
        await leave(first);
        const admitted = await fourth.page.locator(`[data-failmode~="${item.screen}"]`).first().waitFor({ state: 'detached', timeout: 75_000 }).then(() => true, () => false)
          && await intoWorld(fourth, 90_000).then(() => true, () => false);
        if (!admitted) return { outcome: 'ui-fail', reason: 'the head of the line never came in after a seat freed', seen: fourthSeen, notes: await onScreen(fourth.page) };
        return { ...result, shot, notes: { second: { seen: fourthSeen, shot: secondShot }, movedUp: firstShot },
          injection: { seats: 2, seated: 2, waiting: 2, door: 'the world\'s own full refusal with FM7b2 queue facts' },
          recovery: `Title cancelled the ticket ahead; a seat freed and the head came in after ${String(Math.round((Date.now() - leaving) / 1000))} s` };
      } finally { for (const row of opened) await leave(row).catch(() => undefined); }
    },
    // FM4: Send while the link is down holds one visible line, sent once on the way back
    heldChat: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
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
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
    },
    // a second tab of the same device takes the seat; Play here takes it back
    replaced: async item => {
      const entered = await fresh(); const { page, context } = entered;
      try {
        await play(page); await intoWorld(entered);
        const second = await context.newPage(), started = Date.now();
        await play(second);
        const seen = await screen(page, item.screen, 120_000, started), shot = seen === null ? undefined : await shoot(page, item.id, 'card');
        const result = await judged(seen, item, page);
        await second.close();
        if (result.outcome !== 'pass') return { ...result, ...shot === undefined ? {} : { shot } };
        const reloading = page.waitForEvent('load', { timeout: 30_000 }).catch(() => null);
        await press(page, item.screen, 'Play here'); await reloading; await intoWorld(entered, 90_000).catch(() => undefined);
        const back = await recovered(page, 30_000);
        return back ? { ...result, ...shot === undefined ? {} : { shot }, injection: { secondTab: true }, recovery: 'Play here: seated' } : { outcome: 'ui-fail', reason: 'Play here never seated', seen, notes: await onScreen(page) };
      } finally { await leave(entered); }
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
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
    },
    // FM8m mode 41: the proxy sends the server's coded close (FM7b1: 4001 `refused` with {v:1,code:'banned'}); the page shows the
    // removed card, says the end time only when one was sent, and never dials again. Two joins: with an end time, then without one.
    banned: async item => {
      const entered = await fresh(); const { page } = entered;
      /** @param {number | undefined} untilMs */
      const rule = untilMs => ({ route: 'socket', kind: 'close', code: 4001, reason: JSON.stringify({ v: 1, code: 'banned', ...untilMs === undefined ? {} : { untilMs } }) });
      try {
        await play(page); await intoWorld(entered);
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
        const again = Date.now(); await play(page);
        const open = await screen(page, item.screen, 60_000, again), openShot = open === null ? undefined : await shoot(page, item.id, 'no-end');
        const openResult = await judged(open, item, page);
        if (openResult.outcome !== 'pass') return { ...openResult, shot };
        if (/until /u.test(open?.copy ?? '') || !/no end time/u.test(open?.copy ?? '')) return { outcome: 'ui-fail', reason: 'an absent end time was not said as absent', seen: open, shot: openShot };
        const settled = await matchedSince(before, 'socket'); await sleep(10_000);
        const later = await matchedSince(before, 'socket') - settled;
        if (later !== 0) return { outcome: 'ui-fail', reason: `the page dialled ${String(later)} times after the open-ended ban`, seen: open, shot: openShot };
        return { ...result, shot, injection: { closes: settled, untilMs, redials: 0 }, noEnd: { seen: open, shot: openShot }, recovery: 'none: no redial; Title screen leaves for the title' };
      } finally { await heal(); await leave(entered); }
    },
    // FM4 mode 9b: the world restarts under play (close 4005 `restart`, then upgrades refused: the world is quiet), the player goes to
    // the title and taps ENTER THE MMO. The tap holds on `restart-blocked`; when the world answers again it joins by itself.
    titleHold: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
        const before = await control(), named = item.id.replace('/', '-');
        await arm(named, [{ route: 'socket', kind: 'close', code: 4005, reason: 'restart' }]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        if (await matchedSince(before, 'socket') === 0) return { outcome: 'harness-fail', reason: 'the restart close matched nothing' };
        await arm(`${named}-held`, [{ route: 'socket', kind: 'refuse-upgrade', code: 503 }]);
        const heard = await screen(page, 'restart', 10_000);
        if (heard === null) return { outcome: 'harness-fail', reason: 'the page never showed the in-world restart banner', notes: await onScreen(page) };
        await page.goto(`${PAGE_ORIGIN}/?mute=1&nolock=1`);
        await page.locator('.ws-main-mmo').first().click({ timeout: 60_000 });
        const started = Date.now(), seen = await screen(page, item.screen, 15_000, started), shot = await shoot(page, item.id.replace('/', '-'), seen === null ? 'missing' : 'card');
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, shot };
        await sleep(2000);
        const injection = { socketMatches: await matchedSince(before, 'socket'), quietMs: Date.now() - started };
        await heal();
        const gone = await page.locator(`[data-failmode~="${item.screen}"]`).first().waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false);
        const joined = gone && await intoWorld(entered, 120_000).then(() => true, () => false);
        return joined ? { ...result, injection, shot, recovery: 'heal: the held tap joined by itself' }
          : { outcome: 'ui-fail', reason: gone ? 'the card went but the world never loaded' : 'the card stayed after the world answered', seen, injection, shot };
      } finally { await heal(); await leave(entered); }
    },
    // FM8s modes 30, 30b and 31: the rig's own database (pglite:) breaks on purpose through its front (online-rig.mjs `database`):
    // `hold` keeps every query waiting (a save is late, never failed), `refuse` drops every connection (each save fails, the server
    // retries). Each case first waits for a save to land after the page is seated, so the page has heard a confirmed save.
    saveFault: async item => {
      const db = rig.database;
      if (db === undefined) return { outcome: 'blocked-dependency', reason: 'the save cases need a breakable rig database: run with pglite:' };
      const entered = await fresh(); const { page } = entered;
      const writes = async () => {
        const client = new rig.Client({ connectionString: rig.DATABASE });
        try { await client.connect(); return Number((await client.query('select coalesce(sum(revision), 0)::int as n from player_save')).rows[0]?.n ?? 0); }
        finally { await client.end().catch(() => undefined); }
      };
      // the pause menu's EXIT TO MAIN, as a player leaves: Escape opens the menu when it isn't up
      const exit = async () => {
        if (!await page.locator('.ws-gmenu.show').isVisible().catch(() => false)) await page.keyboard.press('Escape');
        await page.locator('.ws-gmenu.show .ws-gmenu-exit').first().click({ timeout: 10_000 });
      };
      const gone = (/** @type {string} */ id, /** @type {number} */ timeout) => page.locator(`[data-failmode~="${id}"]`).first().waitFor({ state: 'detached', timeout }).then(() => true, () => false);
      try {
        await play(page); await intoWorld(entered);
        const base = await writes(), until = Date.now() + 90_000;
        while (await writes() === base) { if (Date.now() > until) return { outcome: 'harness-fail', reason: 'no save landed in 90 s after the seat' }; await sleep(1000); }
        await sleep(500);
        const started = Date.now();
        if (item.id === 'save-failed') {
          db.fault('refuse');
          const seen = await screen(page, item.screen, 100_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
          const injection = { database: 'refuse', refusedConnections: db.stats.refused, cardMs: seen?.ms ?? null };
          if (db.stats.refused === 0 && seen === null) return { outcome: 'harness-fail', reason: 'the refused database saw no connection', injection };
          const result = await judged(seen, item, page);
          if (result.outcome !== 'pass') return { ...result, injection, shot };
          if (/\d\d:\d\d/u.test(seen?.copy ?? '') && !/anything after \d\d:\d\d/u.test(seen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'a time that is not the last confirmed save', seen, shot };
          await press(page, item.screen, 'Keep playing');
          const warned = await page.locator('[data-failmode~="save-failed"][role="status"]').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
          const warnShot = await shoot(page, item.id, 'warning');
          if (!warned) return { outcome: 'ui-fail', reason: 'Keep playing left no lasting warning', seen, shot: warnShot };
          // play goes on under the lasting warning: frames keep coming (a notice, not a card)
          const before = await frames(page); await sleep(3000);
          const moved = await frames(page) - before, cards = await page.locator('[role="alertdialog"]:visible').count(), playing = moved > 10 && cards === 0;
          db.fault('pass');
          const cleared = await gone('save-failed', 30_000), back = cleared && await recovered(page, 20_000);
          return back && playing ? { ...result, injection: { ...injection, refusedConnections: db.stats.refused }, shot, warning: warnShot, recovery: 'Keep playing: a lasting warning, play on; pass: the retried save lands and it clears' }
            : { outcome: 'ui-fail', reason: !playing ? `play stopped under the warning (${String(moved)} frames in 3 s, ${String(cards)} cards up)` : cleared ? 'no frames after the save landed' : 'the warning stayed after the save landed', seen, shot: warnShot };
        }
        db.fault('hold');
        const chip = await screen(page, 'save-slow', 110_000, started), chipShot = await shoot(page, item.id.replace('/', '-'), chip === null ? 'missing' : 'chip');
        if (item.id === 'save-slow') {
          const injection = { database: 'hold', heldBytes: db.stats.heldBytes, chipMs: chip?.ms ?? null };
          const result = await judged(chip, item, page);
          if (result.outcome !== 'pass') return { ...result, injection, shot: chipShot };
          if (!/last saved \d\d:\d\d/u.test(chip?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the late chip does not say the last confirmed save', seen: chip, shot: chipShot };
          if (db.stats.heldBytes === 0) return { outcome: 'harness-fail', reason: 'the held database held no query', injection };
          db.fault('pass');
          const cleared = await gone('save-slow', 30_000), back = cleared && await recovered(page, 20_000);
          return back ? { ...result, injection: { ...injection, heldBytes: db.stats.heldBytes }, shot: chipShot, recovery: 'release: the held save landed, the chip cleared' }
            : { outcome: 'ui-fail', reason: cleared ? 'no frames after the save landed' : 'the chip stayed after the save landed', seen: chip, shot: chipShot };
        }
        if (chip === null) return { outcome: 'ui-fail', reason: 'no save-slow chip to leave under', notes: await onScreen(page) };
        await exit();
        const card = await screen(page, item.screen, 5000), shot = await shoot(page, item.id.replace('/', '-'), card === null ? 'missing' : 'card');
        const result = await judged(card, item, page);
        if (result.outcome !== 'pass') return { ...result, shot };
        // Keep playing: the card goes and the player stays in the world; the cancelled wait leaves nothing behind
        await press(page, item.screen, 'Keep playing');
        const kept = await gone(item.screen, 5000) && await inWorld(page);
        if (!kept) return { outcome: 'ui-fail', reason: 'Keep playing did not keep the player in the world', seen: card, shot };
        await exit();
        if (await screen(page, item.screen, 5000) === null) return { outcome: 'ui-fail', reason: 'a second Leave was not held while the save is late', seen: card, shot };
        await press(page, item.screen, 'Leave when saved');
        await sleep(2000);
        const stayed = !await page.locator(TITLE_LOGO).first().isVisible().catch(() => false);
        const titled = titleShown(page, 30_000).then(() => true, () => false);
        db.fault('pass');
        const left = await titled;
        return stayed && left ? { ...result, shot, injection: { database: 'hold', heldBytes: db.stats.heldBytes, taps: 'EXIT TO MAIN, Keep playing, EXIT TO MAIN, Leave when saved' }, recovery: 'release: left for the title on the confirmed save' }
          : { outcome: 'ui-fail', reason: stayed ? 'Leave when saved did not leave on the confirmed save' : 'Leave when saved left before the save landed', seen: card, shot };
      } finally { db.fault('pass'); await leave(entered); }
    },
    // --refusal=injection: a fault on a route this page never reads matches nothing, and that is a harness failure, never a pass
    unmatched: async () => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
        const before = await control(); await arm('unmatched', [{ route: 'doctor', kind: 'status', code: 503 }]);
        await sleep(5000);
        const matches = await matchedSince(before, 'doctor');
        return matches === 0 ? { outcome: 'harness-fail', reason: 'the doctor fault matched nothing in 5 s', injection: { matches } } : { outcome: 'pass', injection: { matches } };
      } finally { await heal(); await leave(entered); }
    },
    // FM8 mode 14: the doctor's page doesn't answer its preflight; the world page stays, with a card
    doctorHttp: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
    },
    // FM4b: the browser goes offline in the world
    // FM4b modes 5 to 8: the world never answers this page from its first dial (a refused upgrade, an address with no DNS answer, a
    // certificate the browser refuses). The card shows after 10 s down while online, says what the page measured, and goes when the
    // world answers: by itself after a proxy heal (5, 8), or after the signed release names the world again and Try now (6, 7).
    // Negative control in every case: the page is online and the game's own site answers, so the card says so (never a cause).
    unreachable: async item => {
      if (item.id === 'tls' && tlsCert === '') return { outcome: 'blocked-dependency', reason: 'needs --tls-cert/--tls-key: an owned self-signed PEM pair for the fixture TLS listener' };
      const negative = item.id === 'dns' ? `ws://fm-world.invalid:${String(PROXY_WORLD)}/` : item.id === 'tls' ? `wss://127.0.0.1:${String(PROXY_TLS)}/` : '';
      const negativeOrigin = negative === '' ? '' : new URL(negative).origin, before = await control();
      const dialledBefore = socketDials.get(negativeOrigin) ?? 0, negativeDials = () => (socketDials.get(negativeOrigin) ?? 0) - dialledBefore;
      if (negative !== '') { allowedOrigins.add(negativeOrigin); rig.pageView(rig.build, negative); }
      else await arm(item.id, [{ route: 'socket', kind: 'refuse-upgrade', code: item.id === 'upgrade-refused' ? 502 : 503 }]);
      const entered = await fresh(); const { page } = entered;
      try {
        const started = Date.now();
        await play(page);
        // the Name box asks before the page dials (MP2.4): answer it as a player would, then the dial goes out
        for (const until = Date.now() + 60_000; Date.now() < until; await sleep(250)) {
          if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) {
            await page.locator('#ws-name-box input').fill(`fm${String(Date.now() % 100_000)}`);
            await page.locator('#ws-name-box button[type=submit]').click();
            break;
          }
          if ((await visibleIds(page)).length > 0) break;
        }
        const seen = await screen(page, item.screen, 90_000, started), shot = seen === null ? await shoot(page, item.id, 'missing') : await shoot(page, item.id, 'card');
        const after = await control();
        const injection = { ...negative === '' ? { socketMatches: (after.counters.matches.socket ?? 0) - (before.counters.matches.socket ?? 0) } : { pageReleaseSocket: negative, negativeDials: negativeDials() },
          ...item.id === 'tls' ? { tlsRefused: after.counters.tlsRefused - before.counters.tlsRefused } : {}, upgradesReached: after.counters.upgrades - before.counters.upgrades };
        if (negative === '' ? await matchedSince(before, 'socket') === 0 : negativeDials() === 0) return { outcome: 'harness-fail', reason: 'the injection was never dialled', injection };
        if (item.id === 'tls' && after.counters.tlsRefused === before.counters.tlsRefused) return { outcome: 'harness-fail', reason: 'no TLS handshake was refused at the fixture listener', injection };
        if (injection.upgradesReached !== 0) return { outcome: 'harness-fail', reason: 'a dial reached the world while it should not', injection };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        // measured, never guessed: the game's own site answers; no DNS, TLS or status word in the primary copy
        const site = await page.locator('[data-failmode~="unreachable"]').first().textContent({ timeout: 8000 }).catch(() => '');
        if (!/The game's site answers/u.test(site ?? '')) return { outcome: 'ui-fail', reason: 'the card never said the game\'s own site answers', seen, injection, shot };
        if (/DNS|certificate|TLS|refused|\b50\d\b/u.test(seen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the card names a cause the page cannot know', seen, injection, shot };
        const banner = await visibleIds(page);
        if (banner.some(ids => /\b(?:drop|half-open|resuming)\b/u.test(ids))) return { outcome: 'ui-fail', reason: 'a Reconnecting banner shows beside the card', seen, injection, shot, notes: banner };
        if (negative !== '') { rig.pageView(null); await sleep(500); await press(page, item.screen, 'Try now'); } else await heal();
        const healedAt = Date.now();
        let back = false;
        while (!back && Date.now() - healedAt < 45_000) { back = await seated(page) && !(await visibleIds(page)).some(ids => /\bunreachable\b/u.test(ids)); if (!back) await sleep(300); }
        const recovery = negative !== '' ? 'release names the world again, Try now: seated, card gone' : 'heal: seated by itself, card gone';
        return back ? { ...result, injection, shot, recovery, recoveryMs: Date.now() - healedAt } : { outcome: 'ui-fail', reason: 'no seat after the heal', seen, injection, shot, after: await shoot(page, item.id, 'after'), notes: await onScreen(page) };
      } finally { rig.pageView(null); allowedOrigins.delete(negativeOrigin); await heal().catch(() => undefined); await leave(entered); }
    },
    // FM8 mode 32 and 32b (opus-fm): two real pages on voice in Driftwood, a fake microphone each, real ICE with no servers (the
    // voice worker's TURN list is answered empty here: an empty list is no failure, and no STUN leaves this Mac). Controls first: the
    // first page alone on voice past VOICE_GIVE_UP_MS shows nothing (no peer is no failure); both on voice link directly. Then the
    // fault, a labelled page-boundary injection on both pages: remote ICE candidates are dropped (addIceCandidate and SDP candidate
    // lines), so ICE has nothing to try and every re-offer runs out. The tip shows on its own clock; text chat still carries a line.
    // 32: candidates allowed again, Try again re-asks the TURN list and re-offers: linked, the tip goes. 32b (hold mode on a desktop
    // page): holding talk shows voice-failed-blocked; turning voice off clears it.
    voice: async item => {
      const blocked = item.id === 'voice-failed/blocked', iceUrl = 'https://wildshard-voice-ice.wildshard.workers.dev/', iceAsks = { count: 0 };
      // a page script (a string, so it runs as the page's own code): the labelled ICE fault, off until the driver sets __fmIce.blocked
      const iceBoundary = `(() => {
        const proto = RTCPeerConnection.prototype, add = proto.addIceCandidate, setRemote = proto.setRemoteDescription;
        const ice = globalThis.__fmIce = { blocked: false, dropped: 0 };
        proto.addIceCandidate = function fmAddIceCandidate(...given) { if (ice.blocked) { ice.dropped++; return Promise.resolve(); } return add.apply(this, given); };
        proto.setRemoteDescription = function fmSetRemoteDescription(description, ...rest) {
          let said = description;
          if (ice.blocked && said && typeof said.sdp === 'string') {
            const lines = said.sdp.split('\\r\\n'), kept = lines.filter(line => !line.startsWith('a=candidate') && line !== 'a=end-of-candidates');
            ice.dropped += lines.length - kept.length; said = { type: said.type, sdp: kept.join('\\r\\n') };
          }
          return setRemote.call(this, said, ...rest);
        };
      })();`;
      const open = async (/** @type {boolean} */ desktop) => {
        const entered = await fresh(iceBoundary, desktop ? { desktop: true } : {});
        // the TURN list the page asks for: answered here, empty (owned fixture; the real worker is never asked)
        await entered.context.route(iceUrl, route => { iceAsks.count++; void route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{"iceServers":[]}' }); });
        if (desktop) await saveFixture(entered.context, { scope: 'device', key: 'voiceSettings', data: { input: '', volume: 1, mode: 'hold' } });
        if (engine === 'chromium') await entered.context.grantPermissions(['microphone'], { origin: PAGE_ORIGIN }).catch(() => undefined);
        await play(entered.page); await intoWorld(entered);
        return entered;
      };
      const opened = /** @type {Entered[]} */ ([]);
      try {
        const a = await open(true); opened.push(a);
        const b = await open(false); opened.push(b);
        const voiceOn = async (/** @type {Entered} */ entered) => {
          await entered.page.locator('#ws-voice').click({ timeout: 10_000 });
          return entered.page.locator('#ws-voice[data-state="on"]').waitFor({ timeout: 20_000 }).then(() => true, () => false);
        };
        const linked = (/** @type {Entered} */ entered) => entered.page.locator('#ws-voice-peers button[data-linked="true"]').first().waitFor({ state: 'attached', timeout: 40_000 }).then(() => true, () => false);
        const tipOn = (/** @type {Entered} */ entered, /** @type {string} */ id) => entered.page.locator(`#ws-voice-tip[data-failmode="${id}"]:not([hidden])`).count().then(count => count > 0, () => false);
        const giveUpMs = 70_000;
        // control 1 (32 only): one page on voice and nobody else is no failure, however long
        /** @type {{ alone?: { waitedMs: number, tip: boolean }, direct?: { linkedA: boolean, linkedB: boolean, iceAsks: number, tip: boolean } }} */
        const controls = {};
        if (!await voiceOn(a)) return { outcome: engine === 'webkit' ? 'unsupported' : 'harness-fail', reason: `${engine}: voice never came on with the fake microphone`, notes: await onScreen(a.page) };
        if (!blocked) {
          await sleep(giveUpMs + 5000);
          const alone = { waitedMs: giveUpMs + 5000, tip: await tipOn(a, 'voice-failed') };
          controls.alone = alone;
          if (alone.tip) return { outcome: 'ui-fail', reason: 'voice-failed with no peer on voice', injection: { controls } };
        }
        // control 2: both on voice, empty TURN list, nothing blocked: a direct link and no tip
        if (!await voiceOn(b)) return { outcome: 'harness-fail', reason: 'the second page\'s voice never came on' };
        const direct = { linkedA: await linked(a), linkedB: await linked(b), iceAsks: iceAsks.count, tip: false };
        direct.tip = await tipOn(a, 'voice-failed') || await tipOn(b, 'voice-failed');
        controls.direct = direct;
        if (!direct.linkedA || !direct.linkedB || direct.tip) return { outcome: 'ui-fail', reason: 'two pages with no ICE servers never linked directly', injection: { controls } };
        // the fault: candidates dropped on both pages, then the second page leaves and rejoins voice, so every link is offered afresh
        for (const entered of [a, b]) await entered.page.evaluate(() => { /** @type {any} */ (globalThis).__fmIce.blocked = true; });
        const faultAt = Date.now();
        await b.page.locator('#ws-voice').click(); await b.page.locator('#ws-voice[data-state="off"]').waitFor({ timeout: 10_000 });
        if (!await voiceOn(b)) return { outcome: 'harness-fail', reason: 'the second page did not rejoin voice' };
        const seen = await screen(a.page, 'voice-failed', giveUpMs + 40_000, faultAt), shot = seen === null ? await shoot(a.page, item.id, 'missing') : await shoot(a.page, 'voice-failed', 'tip');
        const dropped = await Promise.all([a, b].map(entered => entered.page.evaluate(() => /** @type {number} */ (/** @type {any} */ (globalThis).__fmIce.dropped))));
        const injection = { boundary: 'page: remote ICE candidates dropped (addIceCandidate, SDP candidate lines), labelled injection', candidatesDropped: dropped, iceServers: 'empty fixture list', iceAsks: iceAsks.count, controls };
        if (dropped.every(count => count === 0)) return { outcome: 'harness-fail', reason: 'no candidate was dropped', injection };
        const result = await judged(seen, { ...item, screen: 'voice-failed' }, a.page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        // text chat goes on: a line from the second page reaches the first
        const line = `voice ${String(Date.now() % 10_000)}`;
        await b.page.locator('#ws-chat input').fill(line); await b.page.locator('#ws-chat input').press('Enter');
        const chat = await a.page.locator('#ws-chat', { hasText: line }).waitFor({ state: 'attached', timeout: 15_000 }).then(() => true, () => false);
        if (!chat) return { outcome: 'ui-fail', reason: 'a chat line did not arrive while voice was failed', seen, injection, shot };
        if (blocked) {
          // 32b: hold talk on the desktop page (hold mode): the hold card says no one hears you; the mic still opens
          await a.page.mouse.click(720, 300).catch(() => undefined);
          await a.page.keyboard.down('KeyB');
          const held = await screen(a.page, 'voice-failed-blocked', 5000), heldShot = held === null ? undefined : await shoot(a.page, item.id, 'held');
          const pressedAt = held === null ? await a.page.evaluate(() => ({ marks: Object.fromEntries(Object.entries(document.documentElement.dataset)), focus: `${document.activeElement?.tagName ?? ''}#${document.activeElement?.id ?? ''}.${document.activeElement?.className ?? ''}`, voice: document.querySelector('#ws-voice')?.outerHTML.slice(0, 200), tip: document.querySelector('#ws-voice-tip')?.outerHTML.slice(0, 300), fine: matchMedia('(pointer: fine)').matches, hub: (() => { const hub = /** @type {any} */ (globalThis)[Symbol.for('wildshard.voiceSettings')]; return hub === undefined ? 'none' : { now: hub.now, readers: [...hub.readers].map(read => { try { return read(); } catch (error) { return `threw ${String(error).slice(0, 80)}`; } }) }; })(), saved: localStorage.getItem('wildshard.save.v2@2.device')?.slice(0, 400) })).catch(() => null) : null;
          await a.page.keyboard.up('KeyB');
          const heldResult = await judged(held, item, a.page);
          if (heldResult.outcome !== 'pass') return { ...heldResult, injection, shot, ...pressedAt === null ? {} : { pressedAt } };
          // turning voice off is 32's own recovery: the tip goes
          await a.page.locator('#ws-voice').click();
          const cleared = await a.page.locator('#ws-voice-tip[data-failmode]').waitFor({ state: 'detached', timeout: 10_000 }).then(() => true, async () => !(await tipOn(a, 'voice-failed') || await tipOn(a, 'voice-failed-blocked')));
          return cleared ? { ...heldResult, injection: { ...injection, chat: 'a line arrived' }, ...heldShot === undefined ? {} : { shot: heldShot }, recovery: 'voice off: the tip went' } : { outcome: 'ui-fail', reason: 'the tip stayed after voice off', seen: held, injection };
        }
        // 32: the network lets candidates through again; Try again re-asks the TURN list and offers again: linked, the tip goes
        for (const entered of [a, b]) await entered.page.evaluate(() => { /** @type {any} */ (globalThis).__fmIce.blocked = false; });
        const asksBefore = iceAsks.count;
        await a.page.locator('#ws-voice-tip button[data-action="retry"]').click({ timeout: 5000 });
        const back = await linked(a) && await a.page.locator('#ws-voice-tip[data-failmode="voice-failed"]').waitFor({ state: 'detached', timeout: 30_000 }).then(() => true, async () => !await tipOn(a, 'voice-failed'));
        return back ? { ...result, injection: { ...injection, chat: 'a line arrived', retryIceAsks: iceAsks.count - asksBefore }, shot, recovery: 'Try again: TURN list asked again, re-offered, linked, the tip went' } : { outcome: 'ui-fail', reason: 'no link after Try again', seen, injection, notes: await onScreen(a.page) };
      } finally { for (const entered of opened) await leave(entered).catch(() => undefined); }
    },
    offlinePlay: async item => {
      const entered = await fresh(); const { page, context } = entered;
      try {
        await play(page); await intoWorld(entered);
        const started = Date.now(); await context.setOffline(true);
        const loopbackCut = await cutLoopback(true), injection = { setOffline: true, ...loopbackCut ? { loopbackCut } : {} };
        const seen = await screen(page, item.screen, 8000, started), shot = seen === null ? undefined : await shoot(page, item.id, 'card');
        await sleep(2000); await context.setOffline(false); if (loopbackCut) await heal();
        const result = await judged(seen, item, page);
        const back = result.outcome === 'pass' && await recovered(page, 30_000);
        return result.outcome !== 'pass' ? { ...result, injection } : back ? { ...result, ...shot === undefined ? {} : { shot }, injection, recovery: 'online: a frame, no card' } : { outcome: 'ui-fail', reason: 'no recovery online', seen, notes: await onScreen(page) };
      } finally { await context.setOffline(false).catch(() => undefined); await heal().catch(() => undefined); await leave(entered); }
    },
    // J298: a world the device holds loads offline and says so
    offlineLaunch: async item => {
      const entered = await fresh(undefined, { observe: true }); const { page, context } = entered;
      try {
        await play(page); await intoWorld(entered);
        // a first visit's worker takes control from the next load (no clients.claim on a world page): a second online visit is the warm one.
        // Visits open the play address: the page drops its query once it starts, so a reload would land on the title
        const controlling = () => page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, undefined, { timeout: 20_000 }).then(() => true, () => false);
        if (!await controlling()) { await page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active !== undefined, undefined, { timeout: 60_000 }).catch(() => undefined); await play(page); await intoWorld(entered); }
        const controlled = await controlling();
        if (!controlled) return { outcome: 'unsupported', reason: `${engine}: no controlling service worker after the warm visit, so nothing can launch offline` };
        // the worker precaches its build's code after control (DL1): wait until the page's caches stop growing, not a fixed 3 s
        let held = -1;
        for (let still = 0, tries = 0; still < 3 && tries < 90; tries++) {
          await sleep(1000);
          const entries = await page.evaluate(async () => { let n = 0; for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length; return n; }).catch(() => 0);
          still = entries > 0 && entries === held ? still + 1 : 0; held = entries;
        }
        await context.setOffline(true);
        const loopbackCut = await cutLoopback(false), injection = { warmed: true, setOffline: true, guard: 'observe-only (routing would disable the HTTP cache)', ...loopbackCut ? { loopbackCut } : {} };
        const started = Date.now(); await play(page).catch(() => undefined);
        await intoWorld(entered, 60_000).catch(() => undefined);
        const seen = await screen(page, item.screen, 15_000, started), shot = seen === null ? await shoot(page, item.id, 'missing') : await shoot(page, item.id, 'card');
        await context.setOffline(false); if (loopbackCut) await heal();
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, shot, injection };
        return await recovered(page, 45_000) ? { ...result, shot, injection, recovery: 'online: a frame, no card' } : { outcome: 'ui-fail', reason: 'no recovery online', seen, shot, notes: await onScreen(page) };
      } finally { await context.setOffline(false).catch(() => undefined); await heal().catch(() => undefined); await leave(entered); }
    },
    // the page frozen (CDP), with or without a visibility change
    // FM4b mode 45 (opus-fm): a sleep comes back to a quiet link only if the world doesn't answer at once: the proxy refuses the
    // world's door from the freeze until the card is seen, then heals (on loopback a healthy redial seats inside SB31's one quiet
    // second, so no card: that is right, and it was the census's "no screen"). Its healthy control: a 2.5 s freeze (under the server's
    // 3 s stall) shows nothing. Mode 4 needs a real hidden page: a freeze alone never passes as it.
    freeze: async item => {
      if (engine !== 'chromium') return { outcome: 'unsupported', reason: 'WebKit has no lifecycle freeze; a native-Safari Ring 2 proof is owed' };
      const entered = await fresh(); const { page, context } = entered;
      try {
        await play(page); await intoWorld(entered);
        const cdp = await context.newCDPSession(page), quiet = item.id === 'sleep-wake', awayMs = item.id === 'background-short' ? 4000 : 35_000;
        /** @type {Record<string, unknown> | undefined} */
        let healthyControl;
        if (quiet) {
          const framesBefore = await frames(page);
          await cdp.send('Debugger.enable');
          await cdp.send('Debugger.pause'); await sleep(2500); await cdp.send('Debugger.resume');
          let shown = /** @type {string[]} */ ([]);
          for (const until = Date.now() + 5000; Date.now() < until; await sleep(250)) { shown = (await visibleIds(page)).filter(ids => !/\b(?:slow|lossy|staging)\b/u.test(ids)); if (shown.length > 0) break; }
          healthyControl = { frozenMs: 2500, screens: shown, framesMoved: await frames(page) > framesBefore };
          if (shown.length > 0) return { outcome: 'ui-fail', reason: `a 2.5 s freeze with a live link showed ${shown.join(', ')}`, injection: { healthyControl } };
        }
        const started = Date.now();
        // sleep-wake: the page's script stops (a debugger pause: no timer, no clock tick, no event runs). opus-fm2 saw the lifecycle
        // freeze keep a headless page's timers going: it dialled 14 times while "frozen", so it never had a gap to read as asleep
        await (quiet ? cdp.send('Debugger.pause') : cdp.send('Page.setWebLifecycleState', { state: 'frozen' }));
        // a device asleep has no network: the live socket goes with it (opus-fm2: a 35 s renderer freeze alone keeps the socket up, as
        // the browser's network side still reads it, so the page woke to a live link and dialled nothing), and the door stays shut
        // until the card shows, so a healthy redial can't seat inside SB31's quiet second
        let cut = 0;
        if (quiet) {
          const live = await control(); await arm(`${item.id}-cut`, [{ route: 'socket', kind: 'drop-after', afterMs: 0 }]);
          for (let tries = 0; tries < 40 && (cut = await matchedSince(live, 'socket')) === 0; tries++) await sleep(100);
          await arm(item.id, [{ route: 'socket', kind: 'refuse-upgrade', code: 503 }]);
        }
        const before = await control();
        const dialsFrozen = quiet ? await matchedSince(before, 'socket') : 0;
        await sleep(awayMs);
        const dialsWhileAway = quiet ? await matchedSince(before, 'socket') - dialsFrozen : 0;
        if (quiet) { await cdp.send('Debugger.resume'); await cdp.send('Debugger.disable'); } else await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        const visibility = await page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (globalThis).__fmVisibility));
        if (item.id === 'background-long' && !visibility.includes('hidden')) {
          const notes = await onScreen(page); await heal();
          return { outcome: 'unsupported', reason: 'headless Chromium kept the page visible through the freeze; a real hidden/visible return (native-Safari Ring 2) is owed', injection: { frozenMs: Date.now() - started, visibility }, notes };
        }
        const seen = await screen(page, item.screen, 12_000, Date.now()), shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        const injection = { frozenMs: awayMs, visibility, ...quiet ? { quietLink: 'the live socket dropped at the freeze, then refuse-upgrade 503 until the card', socketCut: cut, dialsWhileAway, socketMatches: await matchedSince(before, 'socket'), healthyControl } : {} };
        // the card comes at the return; its first dial a beat later (the card says when): wait for it rather than count at once
        if (quiet && seen !== null) for (const until = Date.now() + 10_000; injection.socketMatches === 0 && Date.now() < until; await sleep(250)) injection.socketMatches = await matchedSince(before, 'socket');
        await heal();
        if (seen === null && item.id === 'background-short' && !visibility.includes('hidden'))
          return { outcome: 'unsupported', reason: 'headless Chromium kept the page visible through the freeze; a real hidden/visible return (native-Safari Ring 2) is owed', injection, shot, notes: await onScreen(page) };
        if (quiet && injection.socketMatches === 0) return { outcome: 'harness-fail', reason: 'the quiet link refused no dial', injection };
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        if (quiet && !/sleep-wake/u.test(seen?.ids ?? '')) return { outcome: 'ui-fail', reason: 'the card did not name the sleep (no page clock tick)', seen, injection, shot };
        return await recovered(page, 30_000) ? { ...result, injection, shot, recovery: 'seated again' } : { outcome: 'ui-fail', reason: 'no recovery after the return', seen, injection, shot, notes: await onScreen(page) };
      } finally { await heal().catch(() => undefined); await leave(entered); }
    },
    // FM4b: slow and unstable links (measured RTT; the proxy holds frames)
    linkQuality: async item => {
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
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
      } finally { await heal(); await leave(entered); }
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
        const started = Date.now(); await play(page);
        // the Name box comes before the read on a page with no seat yet
        // QA 2026-11-19 row 8: the page reads the file again when it dials, after the world loads (past 30 s on SwiftShader)
        const waited = await bootScreenWait({ inWorld: async () => await frames(page) > 0, screen: async () => {
          if (await page.locator('#ws-name-box input').isVisible().catch(() => false)) { await page.locator('#ws-name-box input').fill('fmboot'); await page.locator('#ws-name-box button[type=submit]').click(); }
          return screen(page, item.screen, 500, started);
        } }, BOOT_SCREEN_MS), { seen } = waited;
        const shot = await shoot(page, item.id, seen === null ? 'missing' : 'page');
        const injection = { releaseMatches: await matchedSince(before, 'release'), upgrades: (await control()).counters.upgrades - before.counters.upgrades };
        if (injection.releaseMatches === 0) return { outcome: 'harness-fail', reason: 'the release fault matched nothing', injection, notes: await onScreen(page) };
        if (item.id === 'release-unsigned' && injection.upgrades > 0) return { outcome: 'ui-fail', reason: 'the page dialled on a release it could not verify', seen, injection, shot };
        const result = 'why' in waited && waited.why === 'in the world' ? { outcome: /** @type {const} */ ('ui-fail'), reason: `the page dialled with no ${item.screen} screen`, seen: null, notes: await onScreen(page) } : await judged(seen, item, page);
        await heal();
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        await press(page, item.screen, 'Try').catch(() => undefined);
        await intoWorld(entered, 60_000).catch(() => undefined);
        return await recovered(page, 30_000) ? { ...result, injection, shot, recovery: 'healed: the world loads' } : { outcome: 'ui-fail', reason: 'no recovery after heal', seen, injection, shot, notes: await onScreen(page) };
      } finally { await heal(); await leave(entered); }
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
        const started = Date.now(); await play(page);
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
      } finally { await heal(); await leave(entered); }
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
        const started = Date.now(); await enterZone(page, { zone: SHARD, base: PAGE_ORIGIN, flags: 'mute=1&nolock=1&skipintro=1', waitUntil: 'domcontentloaded' });
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
        await leave(entered);
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
        await play(page); await intoWorld(entered);
        const started = Date.now();
        await Promise.all([page.waitForURL(/\/doctor\//u, { timeout: 20_000 }), page.evaluate(() => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: 'link' })); })]);
        const seen = await screen(page, item.screen, 45_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'doctor');
        const result = await judged(seen, item, page), injection = { pageClockAheadMs: 120_000 };
        if (result.outcome !== 'pass') return { ...result, injection, shot };
        await page.evaluate(() => { /** @type {any} */ (globalThis).__fmSkew = 0; });
        await page.locator('button', { hasText: 'Run again' }).first().click();
        const cleared = await page.locator(`[data-failmode~="${item.screen}"]`).waitFor({ state: 'detached', timeout: 45_000 }).then(() => true, () => false);
        if (!cleared) return { outcome: 'ui-fail', reason: 'the warning stayed after Run again with the clock right', seen, injection, shot };
        // FM4b negative control: the clock 2 min off again, but nothing to measure it by (the page's version.json and the world's
        // /health both stall, so no Date header and no health `now`): the doctor says clock unknown and warns of nothing
        await page.evaluate(() => { /** @type {any} */ (globalThis).__fmSkew = 120_000; });
        const before = await control();
        await arm('clock-unknown', [{ route: 'version', kind: 'stall' }, { route: 'health', kind: 'stall' }]);
        await page.locator('button', { hasText: 'Run again' }).first().click();
        const unknown = await page.waitForFunction(() => /clock unknown/u.test(document.body.textContent ?? ''), undefined, { timeout: 60_000 }).then(() => true, () => false);
        const warned = await page.locator(`[data-failmode~="${item.screen}"]`).count() > 0;
        const controlShot = await shoot(page, item.id, 'unknown-control');
        const unknownControl = { pageClockAheadMs: 120_000, versionMatches: await matchedSince(before, 'version'), healthMatches: await matchedSince(before, 'health'), saidUnknown: unknown, warned, shot: controlShot };
        await heal();
        if (unknownControl.versionMatches === 0 || unknownControl.healthMatches === 0) return { outcome: 'harness-fail', reason: 'the unknown-clock control matched no read', injection: { ...injection, unknownControl } };
        if (!unknown || warned) return { outcome: 'ui-fail', reason: 'an unmeasured clock was not said as unknown, or still warned', seen, injection: { ...injection, unknownControl }, shot };
        return { ...result, injection: { ...injection, unknownControl }, shot, recovery: 'Run again with the clock right: no warning; unmeasured clock: clock unknown, no warning' };
      } finally { await leave(entered); }
    },
    // FM4 mode 10 (J174): a deploy under play, on the second build. Both views of the release name it; the world counts down while
    // play goes on, the page origin moves, the world drains and comes back on it, and the page reloads into it by itself.
    deploy: async item => {
      if (rig.nextBuild === '') return { outcome: 'blocked-dependency', reason: NEEDS_NEXT };
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
        let seen = /** @type {Seen | null} */ (null), shot = '', playing = false;
        const started = Date.now();
        onNext = true;
        await rig.move(nextDist, { published: async () => {
          seen = await screen(page, item.screen, 15_000, started); shot = await shoot(page, item.id, seen === null ? 'missing' : 'countdown');
          const before = await frames(page); await sleep(1500);
          playing = await frames(page) > before + 10 && await page.evaluate(() => typeof window.__workerClient === 'function' && window.__workerClient().closed === null).catch(() => false);
        } });
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, shot };
        if (!playing) return { outcome: 'ui-fail', reason: 'play stopped under the countdown', seen, shot };
        const landed = await backInPlay(page);
        const runs = await page.evaluate(() => /** @type {typeof globalThis & { __WS_BUILD_ID__?: string }} */ (globalThis).__WS_BUILD_ID__ ?? '').catch(() => '');
        return landed ? { ...result, shot, injection: { from: rig.build, to: rig.nextBuild, views: 'world and page' }, recovery: `the link came back on the moved world and play goes on (page build ${runs === rig.nextBuild ? 'reloaded into the new one' : 'kept, same wire'})` }
          : { outcome: 'ui-fail', reason: 'play never came back after the move', seen, shot, notes: await onScreen(page) };
      } finally { await leave(entered); await home(); }
    },
    // FM4 mode 10b: ENTER THE MMO on the title in a deploy's last seconds (the world's first word says it is moving inside 15 s).
    // The tap holds on `deploy-blocked`; once the world is back on the second build the page joins it by itself. Since QA 11-23-b
    // row 5 (engine 1b8681494, Jake: ENTER ZONE must be instant) the title asks the world before entering only in a tab that heard
    // it restart (`restartRecent`); any other tap enters at once and the move carries the seated player as it carries everyone.
    // So the device first hears a restart in play (9b's 4005 close), as a world that restarts and then deploys would tell it.
    deployHold: async item => {
      if (rig.nextBuild === '') return { outcome: 'blocked-dependency', reason: NEEDS_NEXT };
      const entered = await fresh(); const { page } = entered;
      try {
        // as 9b: a device that has played, and heard the world restart, goes back to the title (a fresh one's ENTER opens Zone select)
        await play(page); await intoWorld(entered);
        const before = await control();
        await arm('deploy-blocked-restart', [{ route: 'socket', kind: 'close', code: 4005, reason: 'restart' }]);
        for (let tries = 0; tries < 40 && await matchedSince(before, 'socket') === 0; tries++) await sleep(100);
        if (await matchedSince(before, 'socket') === 0) return { outcome: 'harness-fail', reason: 'the restart close matched nothing' };
        await arm('deploy-blocked-restart-held', [{ route: 'socket', kind: 'refuse-upgrade', code: 503 }]);
        if (await screen(page, 'restart', 10_000) === null) return { outcome: 'harness-fail', reason: 'the page never showed the in-world restart banner', notes: await onScreen(page) };
        await page.goto(`${PAGE_ORIGIN}/?mute=1&nolock=1`);
        await heal();
        const enter = page.locator('.ws-main-mmo').first();
        await enter.waitFor({ state: 'visible', timeout: 60_000 });
        let seen = /** @type {Seen | null} */ (null), shot = '', tapped = 0;
        onNext = true;
        await rig.move(nextDist, { published: async () => {
          // the world reads its release every 500 ms; from then on its first word says it is moving
          await sleep(1500);
          tapped = Date.now(); await enter.click({ timeout: 10_000 });
          seen = await screen(page, item.screen, 10_000, tapped); shot = await shoot(page, item.id, seen === null ? 'missing' : 'card');
        } });
        const result = await judged(seen, item, page);
        if (result.outcome !== 'pass') return { ...result, shot };
        const landed = await intoWorld(entered, 120_000).then(() => true, () => false) && await backInPlay(page);
        return landed ? { ...result, shot, injection: { restartHeard: true, from: rig.build, to: rig.nextBuild, tapMsAfterPublish: 1500, heldMs: Date.now() - tapped }, recovery: 'the held tap joined the moved world by itself' }
          : { outcome: 'ui-fail', reason: 'the held tap never joined the moved world', seen, shot, notes: await onScreen(page) };
      } finally { await leave(entered); await home(); }
    },
    // FM5b4 mode 24 (J219, J229): the second build retires this one. A legacy page (no file, a 404) shows nothing; a boot on the retired
    // build gets the too-old page before any seat; in play the player's Check reads the signed file and the banner counts down to its
    // signed deadline while a held Attack fights on, and zero navigates nowhere; the next load (a dropped link's reconnect) is refused
    // with the page and nothing redials; once the deploy is done, one Update tap paints the RELOADING cover at once and lands in play on
    // the second build, with no second reload. The page's view of the release runs ahead of the world's (the rig's two signed views).
    tooOld: async item => {
      if (rig.nextBuild === '') return { outcome: 'blocked-dependency', reason: NEEDS_NEXT };
      const next = rig.nextBuild, steps = /** @type {Record<string, unknown>} */ ({});
      try {
        // 1. legacy: no file
        {
          const reads = /** @type {number[]} */ ([]), entered = await fresh(); const { page } = entered;
          page.on('response', response => { if (new URL(response.url()).pathname === '/code-retention.json') reads.push(response.status()); });
          try {
            await play(page); await intoWorld(entered); await checkForUpdate(page); await sleep(3000);
            const up = (await visibleIds(page)).filter(ids => /\btoo-old/u.test(ids));
            if (up.length > 0) return { outcome: 'ui-fail', reason: 'a legacy page (no retention file) showed too-old', notes: await onScreen(page) };
            if (!reads.includes(404)) return { outcome: 'harness-fail', reason: `the page never read the missing retention file (${reads.join(',')})` };
            steps.legacy = { reads, screens: 'none' };
          } finally { await leave(entered); }
        }
        // 2. boot exclusion
        rig.pageView(next); rig.retain({ keptBuilds: [next] });
        {
          const entered = await fresh(); const { page } = entered;
          try {
            const started = Date.now(); await play(page);
            // a fresh device is asked its Name first (MP2.4, before the online start); the page comes after it
            const named = await page.locator('#ws-name-box input').waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
            if (named) { await page.locator('#ws-name-box input').fill(`fm${String(Date.now() % 100_000)}`); await page.locator('#ws-name-box button[type=submit]').click(); }
            const seen = await screen(page, 'too-old', 60_000, started), shot = await shoot(page, item.id, seen === null ? 'boot-missing' : 'boot-page');
            const boot = await judged(seen, { ...item, screen: 'too-old' }, page);
            if (boot.outcome !== 'pass') return { ...boot, reason: `boot: ${boot.reason ?? ''}`, shot, notes: steps };
            await sleep(3000);
            if (await seated(page)) return { outcome: 'ui-fail', reason: 'the retired build took a seat at boot', seen, shot };
            steps.boot = { seen, shot, seated: false };
          } finally { await leave(entered); }
        }
        await sleep(cooldownMs / 2);
        // 3. in play, 4. the next load, 5. Update
        rig.pageView(null); rig.retain(null);
        const entered = await fresh(() => {
          // the cover's time from the tap, kept in the tab across the reload it starts
          let tapAt = -1;
          addEventListener('pointerdown', () => { tapAt = performance.now(); }, true);
          new MutationObserver(() => {
            if (tapAt < 0 || document.getElementById('ws-reloading') === null || sessionStorage.getItem('fm.cover') !== null) return;
            sessionStorage.setItem('fm.cover', String(Math.round(performance.now() - tapAt)));
          }).observe(document, { childList: true, subtree: true });
        });
        const { page } = entered;
        let navigations = 0;
        // a document load, not a same-document history step (the game's own replaceState also fires framenavigated)
        page.on('domcontentloaded', () => { navigations++; });
        try {
          await play(page); await intoWorld(entered);
          const retireAt = Date.now() + 25_000, settled = navigations;
          rig.pageView(next); rig.retain({ keptBuilds: [next], retireAt });
          const started = Date.now();
          await checkForUpdate(page);
          const seen = await screen(page, item.screen, 15_000, started), shot = await shoot(page, item.id, seen === null ? 'missing' : 'countdown');
          const result = await judged(seen, item, page);
          if (result.outcome !== 'pass') return { ...result, shot, notes: steps };
          if (!/retires in/u.test(seen?.copy ?? '')) return { outcome: 'ui-fail', reason: 'the signed deadline was not counted down', seen, shot };
          // Attack held: a fight, through the deadline
          await page.keyboard.down('KeyF');
          const before = await frames(page);
          await sleep(Math.max(0, retireAt - Date.now()) + 3000);
          const expired = await screen(page, item.screen, 5000), expiredShot = await shoot(page, item.id, 'expired');
          await page.keyboard.up('KeyF');
          const moved = await frames(page) - before;
          if (navigations !== settled) return { outcome: 'ui-fail', reason: 'the page navigated in play', seen, shot: expiredShot };
          if (expired === null || !/next load/u.test(expired.copy)) return { outcome: 'ui-fail', reason: 'at zero the banner did not say the next load', seen: expired, shot: expiredShot };
          if (moved < 30 || !await seated(page)) return { outcome: 'ui-fail', reason: `play stopped under the warning (${String(moved)} frames)`, seen: expired, shot: expiredShot };
          steps.play = { seen, shot, expired, expiredShot, framesThroughDeadline: moved, navigations: 0 };
          // 4. the next load: the link drops once; its reconnect is refused with the page, and nothing redials
          const dropped = await control();
          await arm('too-old-reconnect', [{ route: 'socket', kind: 'drop-after', afterMs: 0 }]);
          for (let tries = 0; tries < 40 && await matchedSince(dropped, 'socket') === 0; tries++) await sleep(100);
          await heal();
          if (await matchedSince(dropped, 'socket') === 0) return { outcome: 'harness-fail', reason: 'the drop matched nothing' };
          const refused = await screen(page, 'too-old', 20_000), refusedShot = await shoot(page, item.id, refused === null ? 'next-load-missing' : 'next-load');
          if (refused === null) return { outcome: 'ui-fail', reason: 'the reconnect of a retired build showed no too-old page', notes: await onScreen(page), shot: refusedShot };
          const upgrades = (await control()).counters.upgrades; await sleep(6000);
          const redials = (await control()).counters.upgrades - upgrades;
          if (redials > 0) return { outcome: 'ui-fail', reason: `the refused page dialled ${String(redials)} times`, seen: refused, shot: refusedShot };
          steps.nextLoad = { seen: refused, shot: refusedShot, redials };
          // 5. the deploy finishes (both views, the world and the page origin on the second build); one Update tap
          onNext = true; await rig.move(nextDist);
          const tapNavigations = navigations;
          await page.locator('[data-failmode~="too-old"] button', { hasText: 'Update now' }).first().click({ timeout: 5000 });
          const landed = await onBuild(page, next, 120_000) && await intoWorld(entered, 120_000).then(() => true, () => false);
          if (!landed) return { outcome: 'ui-fail', reason: 'Update never played on the new build', seen: refused, notes: await onScreen(page) };
          const coverMs = Number(await page.evaluate(() => sessionStorage.getItem('fm.cover')).catch(() => null) ?? Number.NaN);
          await sleep(8000);
          const reloads = navigations - tapNavigations, backShot = await shoot(page, item.id, 'updated');
          if (!Number.isFinite(coverMs) || coverMs > 250) return { outcome: 'ui-fail', reason: `the RELOADING cover was not up at once (${String(coverMs)} ms)`, seen: refused, shot: backShot };
          if (reloads !== 1 || !await seated(page)) return { outcome: 'ui-fail', reason: `Update took ${String(reloads)} navigations`, seen: refused, shot: backShot };
          steps.update = { coverMs, reloads, build: next, shot: backShot };
          return { ...result, shot, injection: { retentionFile: 'signed, keeps only the second build', pageView: next, worldView: rig.build, retireInMs: 25_000, drop: 'socket drop-after 0' }, notes: steps,
            recovery: `next load refused with the page; Update: cover in ${String(coverMs)} ms, one reload, playing on ${next}` };
        } finally { await page.keyboard.up('KeyF').catch(() => undefined); await leave(entered); }
      } finally { await home(); }
    },
    // FM5 mode 46: a release signed for staging (loopback fixture only)
    staging: async item => {
      rig.publish(2, rig.build, 'staging');
      const entered = await fresh(); const { page } = entered;
      try {
        await play(page); await intoWorld(entered);
        const seen = await screen(page, item.screen, 10_000), shot = await shoot(page, item.id, seen === null ? 'missing' : 'notice');
        const result = await judged(seen, item, page);
        return { ...result, shot, injection: { channel: 'staging', loopback: true }, ...result.outcome === 'pass' ? { recovery: 'stays for the session' } : {} };
      } finally { rig.publish(3, rig.build, 'production'); await leave(entered); }
    },
  };

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
    // FM11: the receipt so far after every case, so a nightly cut off by its job's time limit still uploads what it judged
    writeFileSync(join(out, 'receipt.json'), JSON.stringify({ schema: 'failmode-proof/1', sha, engine, browser: browserVersion, baseline, build: fixture.build,
      phase: 'partial', judged: rows.length, of: cases.length, exit: 2, cases: rows }, null, 1));
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
  await apiFixture?.close().catch((/** @type {unknown} */ error) => { cleanup.push(`api fixture: ${String(error)}`); });
  if (cleanup.length > 0) harnessFault = `${harnessFault ?? ''} cleanup: ${cleanup.join('; ')}`.trim();
}
const code = harnessFault !== null ? 2 : verdict(rows);
/** @type {Record<string, number>} */
const counts = {};
for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ schema: 'failmode-proof/1', sha, engine, browser: browserVersion, baseline, build: fixture.build, channel: 'loopback-fixture', at: new Date().toISOString(), pages: PAGE_ORIGIN, socket: SOCKET,
  saves: pgBin === 'memory:' ? 'memory (no persistence case selected reads them)' : pgBin === 'pglite:' ? 'owned PGlite behind the rig database front' : 'owned Postgres', harnessFault, counts, exit: code, cases: rows }, null, 1));
console.log(`${JSON.stringify(counts)} -> ${join(out, 'receipt.json')}`);
process.exit(code);
