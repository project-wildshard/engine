#!/usr/bin/env node
// OFFLINE OF1 (meta docs/plans/OFFLINE-PLAN.md, J298): the offline proof, red first. Every OF row's done-when runs it.
//
// One build of this checkout, served twice on loopback (two origins, so two service workers and two Cache Storages):
//   preview  the build as built: no world stamp, the in-page solo server (preview.wildshard.io's shape)
//   staging  the same bytes behind a proxy that stamps `__WS_WORLD__` with staging's release file and key into every document,
//            which is all `WILDSHARD_RELEASE_URL` changes in app-build-pipeline.mjs (E7.2d). The stamp names the release file at
//            `<that origin>/__offline-proof/staging.json`, where the proxy serves staging's real signed file (read once from the
//            CDN, which gives a localhost origin no CORS header), and the world door is a stand-in
//            (`routeWebSocket`) that says the world word (SOCKET_WORLD, every proof shard on a 20-cell grid) and never seats,
//            as opus-offlinefix1's run did. So a staging-like load ends at the seat (LOAD step `server`), never in play.
// Per shard, one persistent headless Chromium profile per channel (402x874, touch): a warm visit by the player's path, then
// the mode, entered by the deck (Shard select; Open Plots, and a shard the deck doesn't show, by `?chunk=<slug>&skipintro` with Developer on)
// and by resume (reopen `/`, whatever the site does). Modes, all inside that one browser, never the laptop's network:
//   offline    `context.setOffline(true)` plus CDP offline on every target (page, workers, the service worker)
//   slow       CDP 0.7 Mbit/s, 300 ms on every target
//   nobackend  online, and the world door never answers
// Every request is logged with the card's phase and step and what served it (service worker, network, failed). No request is
// routed (`context.route` turns off Chromium's HTTP cache, which a phone keeps), so "network" offline can be the HTTP cache.
//
// Red (exit 1, naming the shard and the URL; scripts/offline-proof-rules.mjs, pinned by test/offline-proof-rules.test.ts):
// a failed critical-path request, a drop to the title, "Failed to fetch" or "Level load and cleanup failed" on screen, a load
// that stalls with nothing else to blame, and on a staging-like build a page read of `serverWorker`, `serverRuntime`,
// `/assets/spawn/server/` or a `-client-` manifest the warm visit didn't read. On a staging-like offline deck entry the grid
// layout must come from the cache (OF20). The load's failure screen, a resume the site never offers, and (staging offline) any
// read that reaches this Mac's server are red too. `--require-world` (OF5, OF9) also fails every entry that ends outside the
// world, a staging-like seat wait included. `--report` prints the same and exits 0. CI never runs this (FM11: no browser proof
// in pre-push or CI); it is not in scripts/ci-pack.mjs.
//
// `--one-origin` (OF12) serves both channels on the staging-like origin, from one profile: the proxy stamps the world only while
// the staging pass runs. Passes preview, staging, then preview again (offline, from what the first pass warmed), so each
// channel's worker activating over the other's on one origin must leave the other's caches whole.
//
// `--walkthrough <slug>` is Jake's walk-through (OF21) on the staging-like build, on a fresh profile: online, Shard select to
// the shard, play about 30 s moving around, close the browser, reopen it offline, Shard select to the same shard. Green only
// when START, DOWNLOAD and LOAD finish from the cache, the player is in the world, and then the connection card shows.
//
//   scripts/browser-lane.sh node scripts/offline-proof.mjs [--channel=staging|preview|both] [--mode=offline|slow|nobackend]
//       [--shard=<slug>[,<slug>]] [--entry=deck|resume|both] [--jobs=<n>] [--base=<served build>] [--out=<dir>] [--require-world] [--staging-port=<n>] [--one-origin] [--report]
//   scripts/browser-lane.sh node scripts/offline-proof.mjs --walkthrough <slug> [--base=…] [--out=…] [--report]
// With no `--base` it builds this working tree with scripts/serve-build.sh and stops that server at the end. `--jobs` above 1
// gives each shard its own profile (one profile can't hold two browsers), which trades the shared-device shape for time.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve as resolvePath } from 'node:path';
import { chromium } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { ALL_SHARDS, DECK_SHARDS, gridPlaces, judge, OPEN_PLOTS, pathOf, screenKey, servedCounts } from './offline-proof-rules.mjs';
import { CHANNELS, RELEASE_PUBLIC_KEY } from './page-release/flow.mjs';

/** @typedef {import('./offline-proof-rules.mjs').RequestRow} RequestRow */
/** @typedef {import('./offline-proof-rules.mjs').ScreenSample} ScreenSample */
/** @typedef {import('./offline-proof-rules.mjs').Failure} Failure */
/** @typedef {import('./offline-proof-rules.mjs').Outcome} Outcome */
/** @typedef {'staging' | 'preview'} Channel */
/** @typedef {'warm' | 'offline' | 'slow' | 'nobackend'} Mode */

const ROOT = resolvePath(import.meta.dirname, '..');
const argv = process.argv.slice(2);
/** @param {string} name */
const option = name => {
  const at = argv.indexOf(`--${name}`);
  if (at !== -1 && argv[at + 1] !== undefined && !argv[at + 1]?.startsWith('--')) return argv[at + 1];
  return argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
};
const walkthrough = option('walkthrough');
const channelArg = option('channel') ?? 'staging', modeArg = option('mode') ?? 'offline', entryArg = option('entry') ?? 'both';
if (!['staging', 'preview', 'both'].includes(channelArg)) throw new Error(`--channel is staging, preview or both, not ${channelArg}`);
if (!['offline', 'slow', 'nobackend'].includes(modeArg)) throw new Error(`--mode is offline, slow or nobackend, not ${modeArg}`);
if (!['deck', 'resume', 'both'].includes(entryArg)) throw new Error(`--entry is deck, resume or both, not ${entryArg}`);
const shards = walkthrough !== undefined ? [walkthrough] : option('shard')?.split(',') ?? [...ALL_SHARDS];
for (const slug of shards) if (!ALL_SHARDS.includes(slug)) throw new Error(`No proof shard ${slug}: ${ALL_SHARDS.join(', ')}`);
const jobs = Number(option('jobs') ?? 1);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs is a whole number from 1, not ${String(option('jobs'))}`);
/** OF5 and OF9 on: an entry that ends anywhere but in the world is red (a staging-like seat wait included). */
const requireWorld = argv.includes('--require-world');
const report = argv.includes('--report');
/** OF12: both channels on one origin and one profile (see above). */
const oneOrigin = argv.includes('--one-origin');
if (oneOrigin && (jobs !== 1 || walkthrough !== undefined)) throw new Error('--one-origin runs one profile: --jobs=1, no --walkthrough');
const out = resolvePath(ROOT, option('out') ?? join('tmp', 'offline-proof', new Date().toISOString().replaceAll(/[:.]/gu, '-')));
mkdirSync(out, { recursive: true });
const STAGING = CHANNELS.staging;
/** The grid catalogue: a world build enters only the shards it places (OF3). It is this checkout's, so it matches a build of this
 *  tree (the default, or a `--base` served from it), not a build of another commit. */
const CATALOGUE = JSON.parse(readFileSync(join(ROOT, 'src/shared/game/grid/singleplayer.json'), 'utf8'));
/** The stand-in door's world word: every proof shard on staging's grid. */
const WORLD_WORD = Buffer.concat([Buffer.from([9]), Buffer.from(JSON.stringify({ cells: 20, shards: [...ALL_SHARDS] }))]);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
/** A page call that a hung page can't hold: undefined after `ms`. @template T @param {Promise<T>} work @param {number} ms @returns {Promise<T | undefined>} */
const bounded = (work, ms) => Promise.race([work.catch(() => undefined), sleep(ms).then(() => undefined)]);
const t0 = Date.now();
/** @param {...unknown} parts */
const log = (...parts) => { console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...parts); };

// ---- the build -------------------------------------------------------------------------------------------------------
let base = option('base'), builtPort = '';
if (base === undefined) {
  log('building this working tree (scripts/serve-build.sh)');
  const built = spawnSync('bash', ['scripts/serve-build.sh', '--name', 'offline-proof', '--hours', '2'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SERVE_OWNER: process.env.SERVE_OWNER ?? 'offline-proof' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const url = /http:\/\/127\.0\.0\.1:(\d+)\//u.exec(built.stdout ?? '');
  if (built.status !== 0 || url === null) throw new Error('offline-proof: the build or its server failed (scripts/serve-build.sh)');
  base = url[0].slice(0, -1); builtPort = url[1] ?? '';
  // a Ctrl-C still stops the server this run started
  process.once('SIGINT', () => { spawnSync('bash', ['scripts/serve-build.sh', 'stop', builtPort], { cwd: ROOT, stdio: 'ignore' }); process.exit(130); });
}
const upstream = new URL(base);
const version = /** @type {{ build: string }} */ (await (await fetch(new URL('/version.json', upstream))).json());
log('build', version.build, 'at', upstream.origin);

/** The staging-like origin: the same build, every document stamped with staging's world, and the service worker's own copy of
 *  the document too (sw.js imports `/sw-core/<hash>.js`, which holds the document as a JSON string and answers every navigation). */
let STAMP = '';
const RELEASE_PATH = '/__offline-proof/staging.json';
/** @type {Promise<string> | undefined} */
let signedRelease;
let stamperHits = 0, proxyOffline = false;
/** OF12 `--one-origin`: off while the preview pass runs, so the one origin serves the build as built. */
let stampOn = true;
/** @type {string[]} the last reads the proxy answered, to name an offline leak */
const stamperSeen = [];
/** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
async function stamp(request, response) {
  // the browser's own worker update check is not the game's read, and fails on a phone with no link anyway
  if (request.url !== '/sw.js') {
    stamperHits++;
    stamperSeen.push(request.url ?? '');
    if (stamperSeen.length > 200) stamperSeen.shift();
  }
  // one offline entry at a time (--jobs=1, the walk-through): the proxy is offline too, so a read the CDP emulation missed
  // fails as it would on a phone; it is still counted and named
  if (proxyOffline) { request.socket.destroy(); return; }
  try {
    if (request.url === RELEASE_PATH) {
      signedRelease ??= fetch(STAGING.release, { cache: 'no-store' }).then(answer => { if (!answer.ok) throw new Error(`release ${String(answer.status)}`); return answer.text(); });
      const body = await signedRelease;
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(body);
      return;
    }
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string' && name !== 'host' && name !== 'connection') headers[name] = value;
    /** @type {Buffer[]} */
    const parts = [];
    for await (const part of request) parts.push(Buffer.from(/** @type {Uint8Array} */ (part)));
    const sending = request.method === 'GET' || request.method === 'HEAD' ? {} : { body: Buffer.concat(parts) };
    const answer = await fetch(new URL(request.url ?? '/', upstream), { method: request.method, headers, redirect: 'manual', ...sending });
    const body = Buffer.from(await answer.arrayBuffer());
    /** @type {Record<string, string>} */
    const sent = {};
    answer.headers.forEach((value, name) => { if (!['content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(name)) sent[name] = value; });
    const html = (answer.headers.get('content-type') ?? '').includes('text/html');
    const workerCore = new URL(request.url ?? '/', upstream).pathname.startsWith('/sw-core/');
    // OF12: one origin, two documents under one name: neither may come from the HTTP cache, or a channel switch never lands
    if (oneOrigin && (html || workerCore)) { for (const name of ['etag', 'last-modified']) Reflect.deleteProperty(sent, name); sent['cache-control'] = 'no-store'; }
    if (stampOn && (html || workerCore)) {
      const text = body.toString('utf8');
      if (!text.includes('globalThis.__WS_BUILD_ID__=')) { response.writeHead(500).end('offline-proof: a document without the build stamp'); return; }
      // in the worker's copy the stamp sits inside a JSON string, so it goes in escaped
      const stamped = Buffer.from(text.replace('globalThis.__WS_BUILD_ID__=', `${html ? STAMP : JSON.stringify(STAMP).slice(1, -1)}globalThis.__WS_BUILD_ID__=`));
      for (const name of ['content-encoding', 'etag', 'last-modified']) Reflect.deleteProperty(sent, name);
      response.writeHead(answer.status, { ...sent, 'content-length': String(stamped.length) }).end(stamped);
      return;
    }
    Reflect.deleteProperty(sent, 'content-encoding');
    response.writeHead(answer.status, { ...sent, 'content-length': String(body.length) }).end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(502);
    response.end(String(error));
  }
}
const stamper = createServer((request, response) => { void stamp(request, response); });
// A fixed port per build server (`--staging-port`, else 5400 + the build port's last three digits): the origin is the profile's
// key to its service worker and caches, so a rerun on a kept `--out` must see the same one.
const stagingPort = Number(option('staging-port') ?? 5400 + Number(upstream.port || '80') % 1000);
await new Promise((resolve, reject) => { stamper.once('error', reject); stamper.listen(stagingPort, '127.0.0.1', () => { resolve(null); }); });
const stamperAddress = stamper.address();
if (stamperAddress === null || typeof stamperAddress === 'string') throw new Error('offline-proof: the stamping server has no port');
/** @type {Record<Channel, string>} */
const ORIGINS = { preview: oneOrigin ? `http://127.0.0.1:${String(stamperAddress.port)}` : upstream.origin, staging: `http://127.0.0.1:${String(stamperAddress.port)}` };
STAMP = `globalThis.__WS_WORLD__=${JSON.stringify({ release: `${ORIGINS.staging}${RELEASE_PATH}`, key: RELEASE_PUBLIC_KEY })};`;

/** A free loopback port for a browser's own DevTools endpoint. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer(); probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const at = probe.address(); probe.close(() => { resolve(typeof at === 'object' && at !== null ? at.port : 0); }); });
});

/** The device's last-end records go before a deck entry, so the open lands on the title and not on a resume. */
function clearLastEnd() {
  try {
    if (sessionStorage.getItem('of1-clear')) return;
    const name = 'wildshard.save.v2@1.device', doc = JSON.parse(localStorage.getItem(name) ?? '{"keys":{}}');
    for (const key of Object.keys(doc.keys ?? {})) if (key.startsWith('life.')) Reflect.deleteProperty(doc.keys, key);
    localStorage.setItem(name, JSON.stringify(doc));
    sessionStorage.setItem('of1-clear', '1');
  } catch { /* opaque origin */ }
}

/** The screen, polled: the card's phase and step, the title, the player, any FM screen, and the page's text. */
const readScreen = () => {
  const load = document.querySelector('.ws-load');
  const card = load instanceof HTMLElement && !load.classList.contains('hide') && !load.hidden && getComputedStyle(load).display !== 'none';
  const on = load?.querySelector('.ws-load-phase[data-state="on"]');
  const main = document.querySelector('.ws-main');
  const title = main instanceof HTMLElement && main.offsetParent !== null;
  const fail = [...document.querySelectorAll('[class^="ws-fail"],[class*=" ws-fail"]')].find(node => node instanceof HTMLElement && node.offsetParent !== null);
  const world = /** @type {{ __wildshard?: { world?: { player?: unknown } } }} */ (/** @type {unknown} */ (window)).__wildshard?.world;
  return {
    card, title: title && !card, player: world?.player !== undefined && world.player !== null && !card,
    phase: card ? (on instanceof HTMLElement ? on.dataset.phase ?? 'none' : 'none') : title ? 'title' : 'page',
    step: load instanceof HTMLElement ? load.dataset.step ?? '' : '',
    // OF5b: the card's progress counters, which hold still while it waits on the seat (its clock and time-left never do)
    progress: load instanceof HTMLElement ? [load.dataset.setup, load.dataset.readBytes, load.dataset.streamedBytes, load.dataset.spawnFilesDone, load.dataset.serverFiles].join('|') : '',
    error: (document.querySelector('.ws-load-error')?.textContent ?? '').replaceAll(/\s+/gu, ' ').slice(0, 300),
    // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees, not hidden templates
    failCard: fail instanceof HTMLElement ? fail.innerText.replaceAll(/\s+/gu, ' ').slice(0, 300) : '',
    // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees, not hidden templates
    text: (document.body?.innerText ?? '').replaceAll(/\s+/gu, ' ').slice(0, 3000), url: location.href, world: Reflect.get(globalThis, '__WS_WORLD__') !== undefined,
  };
};

/**
 * One entry in one browser: launch the profile, shape it, enter the shard, watch the card, close the browser.
 * @param {{ channel: Channel, profile: string, slug: string, mode: Mode, entry: 'deck' | 'resume', label: string, play?: number,
 *   settle?: number }} run
 */
async function enter(run) {
  const { channel, profile, slug, mode, entry, label } = run;
  const port = await freePort();
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE,
    serviceWorkers: 'allow',
    args: ['--use-angle=metal', ...KEYCHAIN_ARGS, '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${String(port)}`],
  });
  const started = Date.now(), at = () => Date.now() - started;
  /** @type {RequestRow[]} */
  const rows = [];
  /** @type {ScreenSample[]} */
  const samples = [];
  /** @type {string[]} */
  const consoleLines = [];
  /** @type {Map<import('playwright').Request, RequestRow>} */
  const byRequest = new Map();
  let phase = 'title', step = '';
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'device', key: 'nameAsked', data: true });
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    if (entry === 'deck') await context.addInitScript(clearLastEnd);
    // staging: offline, a door that closes; nobackend, a door that never answers; else the world word, and never a seat
    // The door is always routed, so no run reaches the real rooms address: offline closes at once, as a dead link does
    if (channel === 'staging') await context.routeWebSocket(new RegExp(new URL(STAGING.socket).host.replaceAll('.', String.raw`\.`), 'u'), door => { if (mode === 'offline') void door.close(); else if (mode !== 'nobackend') door.send(WORLD_WORD); });
    context.on('request', request => {
      const row = /** @type {RequestRow} */ ({ n: rows.length + 1, t: at(), url: request.url(), type: request.resourceType(), origin: request.serviceWorker() === null ? 'page' : 'sw', phase, step, servedBy: 'pending', status: 0, fail: '' });
      byRequest.set(request, row); rows.push(row);
    });
    context.on('response', response => { const row = byRequest.get(response.request()); if (row === undefined) return; row.status = response.status(); row.servedBy = response.fromServiceWorker() ? 'service-worker' : 'network'; });
    context.on('requestfailed', request => { const row = byRequest.get(request); if (row === undefined) return; row.servedBy = 'failed'; row.fail = request.failure()?.errorText ?? '?'; });
    // CDP shaping on every target (page, dedicated workers, the service worker): Playwright's offline flag alone misses some
    const conditions = mode === 'offline' ? { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
      : mode === 'slow' ? { offline: false, latency: 300, downloadThroughput: 700_000 / 8, uploadThroughput: 700_000 / 8 } : undefined;
    /** @type {Set<string>} */
    const shaped = new Set();
    /** @type {WebSocket[]} */
    const held = [];
    const shapeAll = async () => {
      if (conditions === undefined) return;
      /** @type {{ id: string, type: string, webSocketDebuggerUrl?: string }[]} */
      let targets = [];
      try { targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json(); } catch { return; }
      for (const target of targets) {
        if (shaped.has(target.id) || target.webSocketDebuggerUrl === undefined || !['page', 'service_worker', 'worker', 'shared_worker'].includes(target.type)) continue;
        shaped.add(target.id);
        try {
          const socket = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
          socket.send(JSON.stringify({ id: 1, method: 'Network.enable', params: {} }));
          socket.send(JSON.stringify({ id: 2, method: 'Network.emulateNetworkConditions', params: conditions }));
          held.push(socket); // closing a CDP client drops its overrides
        } catch { /* a target that went away */ }
      }
    };
    if (mode === 'offline') await context.setOffline(true);
    const page = context.pages()[0] ?? await context.newPage();
    page.on('console', line => { if (line.type() === 'error' || line.type() === 'warning') consoleLines.push(`${String(at())} ${line.type()} ${line.text().slice(0, 300)}`); });
    page.on('pageerror', error => { consoleLines.push(`${String(at())} pageerror ${error.message.slice(0, 300)}`); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => undefined); });
    await shapeAll();
    const shaper = setInterval(() => { void shapeAll(); }, 200);
    let last = /** @type {ReturnType<typeof readScreen> | undefined} */ (undefined);
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const screen = await bounded(page.evaluate(readScreen), 5000);
      polling = false;
      if (screen !== undefined) {
        last = screen; phase = screen.phase; step = screen.step;
        const previous = samples.at(-1);
        const sample = { t: at(), phase: screen.phase, step: screen.step, card: screen.card, title: screen.title, player: screen.player, failCard: screen.failCard, text: screen.text };
        if (previous === undefined || previous.phase !== sample.phase || previous.step !== sample.step || previous.title !== sample.title || previous.player !== sample.player || previous.failCard !== sample.failCard || previous.text.slice(0, 400) !== sample.text.slice(0, 400)) samples.push(sample);
      }
    };
    const poller = setInterval(() => { void poll(); }, 250);
    const failCardNow = () => last?.failCard ?? '';
    const shot = (/** @type {string} */ name) => page.screenshot({ path: join(out, `${label}-${name}.png`), timeout: 10_000 }).catch(() => undefined);

    /** @type {Outcome} */
    let outcome = 'stalled';
    let tappedAt = 0, outcomeMs = 0, proofError = '';
    let leakFrom = () => 0;
    /** @type {() => string[]} */
    let leakedUrls = () => [];
    try {
      const open = OPEN_PLOTS.includes(slug) && entry === 'deck' ? `/?chunk=${slug}&skipintro&mute=1` : '/?mute=1';
      // a deep link is the entry itself: its reads are the card's from the first one
      let linked = open !== '/?mute=1';
      if (linked) phase = 'none';
      const hitsBefore = stamperHits;
      proxyOffline = mode === 'offline' && (channel === 'staging' || oneOrigin) && jobs === 1;
      leakFrom = () => stamperHits - hitsBefore;
      leakedUrls = () => stamperSeen.slice(-Math.min(stamperSeen.length, stamperHits - hitsBefore));
      await page.goto(new URL(open, ORIGINS[channel]).href, { waitUntil: 'commit', timeout: 60_000 }).catch((/** @type {unknown} */ error) => { consoleLines.push(`goto ${String(error).slice(0, 200)}`); });
      if (entry === 'deck' && !OPEN_PLOTS.includes(slug)) {
        const select = page.locator('.ws-main-select');
        await select.waitFor({ state: 'visible', timeout: mode === 'slow' ? 180_000 : 60_000 });
        if (await page.locator('#wsdrop').isVisible().catch(() => false)) await page.locator('#wsdrop button.dismiss').click().catch(() => undefined);
        await select.click();
        await page.locator('.ws-menu-card b').first().waitFor({ state: 'attached', timeout: 30_000 });
        const card = DECK_SHARDS.find(shard => shard.slug === slug)?.card ?? '';
        const names = await page.locator('.ws-menu-card b').allTextContents();
        const index = names.findIndex(name => name.trim().toLowerCase() === card.toLowerCase());
        if (index === -1) {
          // a shard this build's deck doesn't show (Pastel Plain, Ink & Cel): the deep link with Developer on, as for Open Plots
          consoleLines.push(`no deck card "${card}" (deck: ${names.join(', ')}): entered by ?chunk=`);
          phase = 'none'; linked = true;
          await page.goto(new URL(`/?chunk=${slug}&skipintro&mute=1`, ORIGINS[channel]).href, { waitUntil: 'commit', timeout: 60_000 });
        } else {
          await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).click();
          await page.locator('.ws-menu-play').click();
        }
      }
      tappedAt = at();
      if (phase === 'title' && entry === 'deck') phase = 'none';
      const limit = mode === 'slow' || mode === 'warm' ? 300_000 : 150_000;
      let key = '', changed = Date.now(), cardSeen = false;
      for (;;) {
        await sleep(500);
        const screen = last;
        if (screen === undefined) continue;
        if (await page.locator('.ws-load-play').isVisible().catch(() => false)) await page.locator('.ws-load-play').click({ timeout: 3000 }).catch(() => undefined);
        cardSeen ||= screen.card;
        const now = screenKey(screen);
        if (now !== key) { key = now; changed = Date.now(); }
        if (screen.player) { outcome = 'play'; break; }
        if (screen.error !== '') { outcome = 'error'; break; }
        if (cardSeen && screen.title) { outcome = 'title'; break; }
        if (!cardSeen && screen.title && entry === 'resume' && at() - tappedAt > 20_000) { outcome = 'no-resume'; break; }
        // OF3: a world build's title after a link to a shard its grid doesn't place (judged against the catalogue)
        // (a link's answer only: a closed deck card shows the same badge)
        if (linked && !cardSeen && screen.title && /not in this world yet/iu.test(screen.text) && at() - tappedAt > 5000) { outcome = 'outside-world'; break; }
        // a staging-like page waits on the seat, which the stand-in door never gives
        if (channel === 'staging' && screen.phase === 'load' && screen.step === 'server' && Date.now() - changed > 10_000) { outcome = 'seat-wait'; break; }
        if (Date.now() - changed > (mode === 'slow' ? 90_000 : 60_000) || at() - tappedAt > limit) { outcome = 'stalled'; break; }
      }
      outcomeMs = at() - tappedAt;
      await shot(outcome);
      if (outcome === 'play' && run.play !== undefined) {
        // about 30 s of play, moving around (OF21's step 2); a world build with no seat may not move at all
        const keys = ['w', 'a', 'w', 'd'];
        const playUntil = Date.now() + run.play;
        for (let turn = 0; Date.now() < playUntil; turn++) { const held_ = keys[turn % keys.length] ?? 'w'; await page.keyboard.down(held_); await sleep(1500); await page.keyboard.up(held_); }
      }
      if (outcome === 'play' && mode !== 'warm') {
        // the connection card, when one comes (OF9 to OF11), within 20 s of play
        for (let wait = 0; wait < 40 && failCardNow() === ''; wait++) await sleep(500);
        await shot('after-play');
      }
      if (run.settle !== undefined) await sleep(run.settle);
    } catch (error) {
      outcome = 'error'; proofError = String(error).slice(0, 300); consoleLines.push(`proof ${proofError}`); await shot('error');
    }
    clearInterval(poller); clearInterval(shaper);
    for (const socket of held) socket.close();
    const caches = await bounded(page.evaluate(async () => {
      /** @type {Record<string, number>} */
      const counts = {};
      for (const name of await globalThis.caches.keys()) counts[name] = (await (await globalThis.caches.open(name)).keys()).length;
      return counts;
    }), 10_000) ?? {};
    const reached = mode === 'offline' && (channel === 'staging' || oneOrigin) ? leakFrom() : 0;
    if (reached > 0) consoleLines.push(`offline ${proxyOffline ? 'reads refused by the offline proxy' : 'leak'}: ${leakedUrls().join(' ')}`);
    // refused reads failed as they would on a phone, so they aren't a leak; with --jobs above 1 the proxy can't go offline
    const leaks = proxyOffline ? 0 : reached;
    proxyOffline = false;
    return { rows, samples, consoleLines, outcome, ms: outcomeMs, proofError, leaks, caches, finalUrl: last?.url ?? '', world: last?.world ?? false, lastCard: `${last?.phase ?? ''}/${last?.step ?? ''} ${last?.error ?? ''}`.trim() };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Open the staging-like title once and close, so a fresh profile has its service worker. @param {string} profile */
async function installApp(profile) {
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE,
    serviceWorkers: 'allow', args: ['--use-angle=metal', ...KEYCHAIN_ARGS, '--mute-audio'] });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(new URL('/?mute=1', ORIGINS.staging).href, { waitUntil: 'load', timeout: 60_000 });
    await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 }).catch(() => undefined);
    await sleep(5000);
  } finally { await context.close().catch(() => undefined); }
}

/**
 * OF12 `--one-origin`: hand the one origin to a channel. The page is served by the worker in control, whose copy of the document
 * is the old channel's, so the new channel's worker is installed by an update check and adopted (SKIP_WAITING), as a deploy's is,
 * until a fresh load of `/` carries the channel's stamp (or none). Logs the origin's caches after the switch.
 * @param {string} profile @param {Channel} channel
 */
async function switchChannel(profile, channel) {
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE,
    serviceWorkers: 'allow', args: ['--use-angle=metal', ...KEYCHAIN_ARGS, '--mute-audio'] });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.goto(new URL('/?mute=1', ORIGINS[channel]).href, { waitUntil: 'load', timeout: 60_000 });
      const world = await page.evaluate(() => Reflect.get(globalThis, '__WS_WORLD__') !== undefined);
      const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
      if (world === (channel === 'staging') && controlled) {
        const names = await page.evaluate(async () => (await caches.keys()).sort());
        log(`one origin is ${channel}'s (attempt ${String(attempt + 1)}); caches: ${names.join(' ')}`);
        return;
      }
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update().catch(() => undefined);
        const next = registration?.installing ?? registration?.waiting;
        if (next === null || next === undefined) return;
        if (next.state === 'installing') await new Promise(resolve => { next.addEventListener('statechange', () => { if (next.state !== 'installing') resolve(null); }); });
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a ServiceWorker's postMessage takes no origin
        next.postMessage({ type: 'SKIP_WAITING' });
        await new Promise(resolve => { navigator.serviceWorker.addEventListener('controllerchange', () => { resolve(null); }); setTimeout(resolve, 10_000); });
      }).catch(() => undefined);
    }
    throw new Error(`offline-proof: the one origin never turned to ${channel}`);
  } finally { await context.close().catch(() => undefined); }
}

/**
 * One shard on one channel: warm (once per profile), then the mode's entries.
 * @param {Channel} channel @param {Mode} mode @param {string} slug @param {string} profile
 */
async function proveShard(channel, mode, slug, profile) {
  // beside its own profile, so a different --jobs layout (a cold profile) warms again
  const warmFile = join(oneOrigin ? `${profile}.warm-${channel}-${slug}.json` : `${profile}.warm-${slug}.json`);
  const results = [];
  /** @type {Set<string> | undefined} */
  let warm;
  if (existsSync(warmFile)) warm = new Set(/** @type {string[]} */ (JSON.parse(readFileSync(warmFile, 'utf8'))));
  else {
    const label = `${channel}-warm-${slug}`;
    // Two visits: the first installs the worker (a fresh page isn't controlled), the second reads through it. A staging-like
    // load never seats, so the worker's precache (which waits for control) may never run: the second visit is the returning
    // player whose reads the worker kept.
    log(label, 'warm visits');
    const first = await enter({ channel, profile, slug, mode: 'warm', entry: 'deck', label: `${label}1`, settle: 5000 });
    const second = await enter({ channel, profile, slug, mode: 'warm', entry: 'deck', label: `${label}2`, settle: 20_000 });
    warm = new Set([...first.rows, ...second.rows].filter(row => row.origin === 'page' && row.servedBy !== 'failed').map(row => pathOf(row.url)));
    writeFileSync(warmFile, JSON.stringify([...warm]));
    results.push(record(channel, 'warm1', slug, 'deck', first, undefined), record(channel, 'warm2', slug, 'deck', second, undefined));
  }
  const entries = /** @type {('deck' | 'resume')[]} */ (entryArg === 'both' ? ['deck', 'resume'] : [entryArg]);
  for (const entry of entries) {
    const label = `${channel}-${mode}-${slug}-${entry}`;
    log(label);
    const visit = await enter({ channel, profile, slug, mode, entry, label });
    results.push(record(channel, mode, slug, entry, visit, warm));
  }
  return results;
}

/**
 * Judge one entry, keep its logs, and give its receipt line.
 * @param {Channel} channel @param {string} mode @param {string} slug @param {'deck' | 'resume'} entry
 * @param {Awaited<ReturnType<typeof enter>>} visit @param {Set<string> | undefined} warm @param {{ walkthrough?: boolean }} [extra]
 */
function record(channel, mode, slug, entry, visit, warm, extra = {}) {
  const label = `${channel}-${mode}-${slug}-${entry}`;
  writeFileSync(join(out, `${label}-requests.json`), JSON.stringify(visit.rows));
  writeFileSync(join(out, `${label}-screens.json`), JSON.stringify({ samples: visit.samples, console: visit.consoleLines }));
  const layout = channel === 'staging' && mode === 'offline' && (entry === 'deck' || extra.walkthrough === true);
  const failures = judge({ shard: slug, channel, mode, entry, rows: visit.rows, samples: visit.samples,
    outcome: visit.outcome, ...warm === undefined ? {} : { warm }, layout, proofError: visit.proofError, leaks: visit.leaks,
    requireWorld: requireWorld && !mode.startsWith('warm'), placed: gridPlaces(slug, CATALOGUE), ...extra });
  if (channel === 'staging' && !visit.world) failures.unshift({ shard: slug, rule: 'proof-not-a-world-build', detail: 'the page had no __WS_WORLD__ stamp' });
  const result = { shard: slug, channel, mode, entry, outcome: visit.outcome, ms: visit.ms, lastCard: visit.lastCard, served: servedCounts(visit.rows),
    swSoloReads: visit.rows.filter(row => row.origin === 'sw' && /serverWorker|serverRuntime|\/assets\/spawn\/server\//u.test(row.url)).length,
    caches: visit.caches, world: visit.world, failures };
  log(`${failures.length === 0 ? 'ok  ' : 'RED '} ${label}: ${visit.outcome} in ${String(Math.round(visit.ms / 1000))} s, served ${JSON.stringify(result.served)}`);
  for (const failure of failures.slice(0, 8)) log(`       ${failure.rule} ${failure.url ?? ''} ${failure.detail ?? ''}`);
  if (failures.length > 8) log(`       … ${String(failures.length - 8)} more`);
  return result;
}

/** @type {ReturnType<typeof record>[]} */
const results = [];
let code = 1;
try {
  if (walkthrough !== undefined) {
    // OF21: a fresh device, online visit with play, browser closed, reopened offline, the same shard from Shard select
    const profile = join(out, `profile-walkthrough-${walkthrough}`);
    rmSync(profile, { recursive: true, force: true });
    // the installed app: one open of the title first, so the worker controls the visit that plays, as on Jake's phone
    await installApp(profile);
    log('walk-through', walkthrough, 'online: Shard select, 30 s of play');
    const online = await enter({ channel: 'staging', profile, slug: walkthrough, mode: 'warm', entry: 'deck', label: `staging-walk-online-${walkthrough}`, play: 30_000, settle: 15_000 });
    const warm = new Set(online.rows.filter(row => row.origin === 'page' && row.servedBy !== 'failed').map(row => pathOf(row.url)));
    results.push(record('staging', 'warm', walkthrough, 'deck', online, undefined));
    log('walk-through: browser closed; reopened offline, Shard select to the same shard');
    const offline = await enter({ channel: 'staging', profile, slug: walkthrough, mode: 'offline', entry: 'deck', label: `staging-walk-offline-${walkthrough}` });
    results.push(record('staging', 'offline', walkthrough, 'deck', offline, warm, { walkthrough: true }));
  } else {
    const channels = /** @type {Channel[]} */ (oneOrigin ? ['preview', 'staging', 'preview'] : channelArg === 'both' ? ['preview', 'staging'] : [channelArg]);
    for (const channel of channels) {
      const mode = /** @type {Mode} */ (modeArg);
      if (channel === 'preview' && mode === 'nobackend') { log('preview has no world: --mode=nobackend skipped'); continue; }
      if (oneOrigin) { stampOn = channel === 'staging'; await switchChannel(join(out, 'profile-one-origin'), channel); }
      const queue = [...shards];
      const worker = async (/** @type {number} */ lane) => {
        for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
          const profile = join(out, oneOrigin ? 'profile-one-origin' : jobs > 1 ? `profile-${channel}-${slug}` : `profile-${channel}`);
          try { results.push(...await proveShard(channel, mode, slug, profile)); } catch (error) { log(`lane ${String(lane)} ${slug} broke: ${String(error)}`); results.push({ shard: slug, channel, mode, entry: 'deck', outcome: 'error', ms: 0, lastCard: '', served: {}, swSoloReads: 0, caches: {}, world: false, failures: [{ shard: slug, rule: 'proof-error', detail: String(error).slice(0, 300) }] }); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(jobs, shards.length) }, (_unused, lane) => worker(lane)));
    }
  }
  const failing = [...new Set(results.filter(result => result.failures.length > 0).map(result => `${result.channel}:${result.shard}`))];
  code = failing.length === 0 ? 0 : 1;
  const receipt = { proof: 'offline-proof.mjs (OFFLINE OF1)', build: version.build, base: upstream.origin, origins: ORIGINS, mode: walkthrough === undefined ? modeArg : 'walkthrough',
    walkthrough: walkthrough ?? null, started: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), red: code !== 0, failing, results };
  writeFileSync(join(out, `receipt-${walkthrough === undefined ? `${channelArg}-${modeArg}` : `walkthrough-${walkthrough}`}.json`), `${JSON.stringify(receipt, null, 1)}\n`);
  log(code === 0 ? 'GREEN' : `RED: ${failing.join(', ')}`, '| receipt in', out);
} finally {
  stamper.close();
  if (builtPort !== '') spawnSync('bash', ['scripts/serve-build.sh', 'stop', builtPort], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, SERVE_OWNER: process.env.SERVE_OWNER ?? 'offline-proof' } });
}
process.exit(report ? 0 : code);
