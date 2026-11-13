#!/usr/bin/env node
// AUDIO AU14 (meta docs/plans/AUDIO-PLAN.md, J299/J303/J304): the proof that audio downloads at DOWNLOAD and LOAD never asks
// the network for it, on staging and on a staging-like local build.
//
// Per entry (shard and route), one fresh persistent headless WebKit profile (402x874, touch, iPhone UA), two visits:
//   warm  the player's path on a normal link (the profile is fresh, so this visit fills the worker's caches)
//   slow  the same profile again on a 0.7 Mbit/s, 300 ms link
// Routes: `grid` is the deck entry (Shard select, ENTER WORLD: the `<shard>-grid-phone` spawn manifest); `client` is the
// one-shard page, the deep link `?chunk=<slug>&skipintro` with Developer on (the `-client-phone` manifest). Open Plots have no deck
// card, so they take `client`. The warm visit must fetch its route's own phone manifest; a later visit may read it from the
// page's store and fetch none, so it is judged against the manifest its warm visit fetched.
//
// The link: WebKit has no CDP, so `Network.emulateNetworkConditions` (the offline audits' shaping, scripts/offline-proof.mjs)
// can't run. Every byte instead goes through this script's own forward proxy (Playwright's `proxy`, loopback included):
// CONNECT tunnels for https/wss, plain forwarding for the local build's http. In slow mode each direction is a 87,500 B/s
// link (0.7 Mbit/s) and each piece lands 150 ms after it leaves the link (300 ms round trip). No request is routed with
// Playwright (a route makes the service worker skip its cache, AU2's finding), so the worker's caches behave as on a phone.
// Phases come from the page itself: a MutationObserver stamps each change of the card's phase and step, and each request takes
// the phase in force when the proof saw it.
//
// Red (exit 1), per visit:
//   load-audio      a page request for `/assets/{music,sfx}/**`, `blobs/audio/**` or a spawn part that packs audio, while the
//                   card's phase is LOAD (served by the worker or the network alike: either way LOAD asked for it), or, on the
//                   local build where the proxy sees every http URL, any network fetch of one during LOAD (the service
//                   worker's own included; on staging the worker's own fetches are TLS the proxy can't read)
//   download-short  the route's spawn manifest totals under the shard's audio MB from AU6, or its own audio rows do
//   route           the warm visit fetched no `<shard>-<route>-phone` manifest
//   no-load         the card never reached LOAD, so there was nothing to judge
//   link-blind      on the local build, no http read went through the proxy
//   silent          on a visit that reaches play: the music bus or the sound-effects bus stays silent (peak under -60 dBFS)
//                   for the first 10 s of play; the proof walks and jumps in that window so footsteps play
//                   (not on a `&skipintro` deep link: that bench path never runs ENTER WORLD, so it never starts the music
//                   or unhushes the world; its peaks are in the receipt, the bar is the deck entries')
//   no-play         the warm visit doesn't reach play (a slow visit or a bench deep link that stops short of play is reported,
//                   not red: its LOAD is still judged).
//                   On the local build rooms-staging refuses the loopback origin's socket, so its load ends at the seat (LOAD
//                   step `server`, `seat-wait`, as in offline-proof.mjs): LOAD and DOWNLOAD are judged there, audibility on staging
// The buses are found by an init script that watches `AudioNode.connect`: the mixer's master is the gain that feeds a low-pass
// that feeds the compressor (engine Audio.ts `graph()`); its first input is the `world` bus, whose first input is `sfx`; any
// later input to the master is music (Music.ts's duck gain, or `bus('music')`). Each gets an AnalyserNode beside it.
//
//   scripts/browser-lane.sh node scripts/audio-download-proof.mjs [--target=staging|local|preview|both|all] [--base=<served build>]
//       [--entry=<slug>:<grid|client>[,…]] [--jobs=<n>] [--out=<dir>]
// `preview` is the same served build with no world (the solo page): its deep links take the one-shard `client` manifest,
// which a world build no longer uses (OF2), and reach play. `both` is staging and local, `all` adds preview.
// `--target=local` or `preview` with no `--base` builds this working tree with scripts/serve-build.sh and stops that server at the end.
// The local origin stamps every document with staging's world (as offline-proof.mjs does), and its world door is the real
// rooms-staging, which refuses it (see no-play above). Staging is joined for real; prod is never touched.
// CI never runs this (no browser proof in pre-push or CI).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { join, resolve as resolvePath } from 'node:path';
import { webkit } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { CHANNELS, RELEASE_PUBLIC_KEY } from './page-release/flow.mjs';

const ROOT = resolvePath(import.meta.dirname, '..');
const argv = process.argv.slice(2);
/** @param {string} name */
const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const targetArg = option('target') ?? 'staging';
if (!['staging', 'local', 'preview', 'both', 'all'].includes(targetArg)) throw new Error(`--target is staging, local, preview, both or all, not ${targetArg}`);
/** AU6's phone audio MB per shard (engine 42f0a8f1's cook report over the pinned products); an Open Plot is 1.22 to 1.49. */
const AU6_AUDIO_MB = /** @type {Record<string, number>} */ ({ 'driftwood-isle': 3.62, 'pine-hollow': 4.73, 'nalati-grasslands': 5.47, 'nine-dragon-stack': 2.60, 'open-plot-*': 1.22 });
/** Deck card names (scripts/offline-proof-rules.mjs DECK_SHARDS). */
const CARDS = /** @type {Record<string, string>} */ ({ 'driftwood-isle': 'Driftwood Isle', 'nalati-grasslands': 'Nalati Grasslands', 'pine-hollow': 'Pine Hollow', 'nine-dragon-stack': 'Nine Dragon Stack' });
const DEFAULT_ENTRIES = 'driftwood-isle:grid,driftwood-isle:client,nalati-grasslands:grid,nine-dragon-stack:grid,pine-hollow:grid,open-plot-thin-ice:client';
const entries = (option('entry') ?? DEFAULT_ENTRIES).split(',').map(spec => {
  const [slug = '', route = 'grid'] = spec.split(':');
  if (route !== 'grid' && route !== 'client') throw new Error(`route is grid or client, not ${route}`);
  if (route === 'grid' && CARDS[slug] === undefined) throw new Error(`${slug} has no deck card: use ${slug}:client`);
  return { slug, route };
});
const jobs = Number(option('jobs') ?? 2);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs is a whole number from 1, not ${String(option('jobs'))}`);
const out = resolvePath(ROOT, option('out') ?? join('tmp', 'audio-download-proof', new Date().toISOString().replaceAll(/[:.]/gu, '-')));
mkdirSync(out, { recursive: true });
const STAGING = CHANNELS.staging;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const AUDIO = /\/assets\/(?:music|sfx)\/|\/blobs\/audio\//u;
const SPAWN = /\/assets\/spawn\/([^/]+)-(grid|client)-(phone|desktop)-[0-9a-f]+\.json$/u;
/** -60 dBFS: a bus whose peak stays under it in the window is silent. */
const AUDIBLE_PEAK = 0.001;
const PLAY_WINDOW_MS = 10_000;
/** A deep link takes the bench path `&skipintro`, except preview's deep link to a shard with a deck card. Without the flag a
 *  world build's deep link stops at the title, and a solo page loads the shard and then lands on the title, where the proof
 *  goes on by Shard select (checked 2026-11-13); an Open Plot has no card to go on by.
 * @param {string} target @param {'grid' | 'client'} route @param {string} slug */
const benchEntry = (target, route, slug) => route === 'client' && (target !== 'preview' || CARDS[slug] === undefined);
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
/** @template T @param {Promise<T>} work @param {number} ms @returns {Promise<T | undefined>} */
const bounded = (work, ms) => Promise.race([work.catch(() => undefined), sleep(ms).then(() => undefined)]);
const t0 = Date.now();
/** @param {...unknown} parts */
const log = (...parts) => { console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...parts); };

// ---- the link: a forward proxy, optionally shaped ---------------------------------------------------------------------
/**
 * One shaped direction: a serial link at `rate` bytes/s, each piece delivered `delay` ms after it leaves the link. One FIFO
 * drained by one timer, so pieces (and the empty end markers behind them) land in the order they were sent.
 * @param {number} rate @param {number} delay
 */
function lane(rate, delay) {
  let freeAt = 0;
  /** @type {{ at: number, piece: Buffer, deliver: (piece: Buffer) => void }[]} */
  const queue = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const drain = () => {
    timer = undefined;
    while (queue.length > 0 && (queue[0]?.at ?? 0) <= Date.now()) {
      const head = queue.shift();
      try { head?.deliver(head.piece); } catch { /* a socket that went away */ }
    }
    if (queue.length > 0) timer = setTimeout(drain, Math.max(0, (queue[0]?.at ?? 0) - Date.now()));
  };
  /** @param {Buffer} chunk @param {(piece: Buffer) => void} deliver */
  const send = (chunk, deliver) => {
    if (rate === 0) { deliver(chunk); return; }
    const now = Date.now();
    // an empty chunk is a marker (an end, a request's go): it lands right after everything already on the link
    if (chunk.length === 0) queue.push({ at: Math.max(now, freeAt) + delay, piece: chunk, deliver });
    for (let at = 0; at < chunk.length; at += 16_384) {
      const piece = chunk.subarray(at, at + 16_384);
      freeAt = Math.max(now, freeAt) + piece.length / rate * 1000;
      queue.push({ at: freeAt + delay, piece, deliver });
    }
    timer ??= setTimeout(drain, Math.max(0, (queue[0]?.at ?? 0) - Date.now()));
  };
  return Object.assign(send, { stop: () => { if (timer !== undefined) clearTimeout(timer); queue.length = 0; } });
}
/** A forward proxy for one browser; `slow` shapes it (each direction 0.7 Mbit/s, 150 ms one way). Logs every http URL and https
 *  host it carries, with the time. @param {boolean} slow */
async function startLink(slow) {
  const down = lane(slow ? 87_500 : 0, slow ? 150 : 0), up = lane(slow ? 87_500 : 0, slow ? 150 : 0);
  /** @type {{ t: number, url: string }[]} */
  const seen = [];
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  let closed = false;
  const server = createServer((request, response) => {
    seen.push({ t: Date.now(), url: request.url ?? '' });
    /** @type {Buffer[]} */
    const body = [];
    request.on('data', chunk => { body.push(Buffer.from(chunk)); });
    request.on('end', () => {
      // the request line and headers (about 300 bytes) and its body cross the link before it reaches the server
      up(Buffer.concat([Buffer.alloc(300), ...body]), () => undefined);
      up(Buffer.alloc(0), () => {
        if (closed || response.destroyed) return;
        let target;
        try { target = new URL(request.url ?? ''); } catch { response.writeHead(400).end(); return; }
        const headers = { ...request.headers };
        Reflect.deleteProperty(headers, 'proxy-connection');
        const upstream = httpRequest({ host: target.hostname, port: target.port || 80, path: `${target.pathname}${target.search}`, method: request.method, headers }, answer => {
          let started = false;
          const begin = () => { if (!started && !response.destroyed) { started = true; response.writeHead(answer.statusCode ?? 502, answer.headers); } };
          down(Buffer.alloc(400), () => { begin(); });
          answer.on('data', chunk => { down(chunk, piece => { begin(); if (!response.destroyed) response.write(piece); }); });
          answer.on('end', () => { down(Buffer.alloc(0), () => { begin(); if (!response.destroyed) response.end(); }); });
          answer.on('error', () => { down(Buffer.alloc(0), () => { response.destroy(); }); });
        });
        // a request the browser dropped stops using the link; a failure after the headers is a cut body, never a short one
        response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
        upstream.end(Buffer.concat(body));
      });
    });
  });
  server.on('connect', (request, client, head) => {
    seen.push({ t: Date.now(), url: `connect://${request.url ?? ''}` });
    const [host = '', port = '443'] = (request.url ?? '').split(':');
    const upstream = netConnect({ port: Number(port), host, allowHalfOpen: true }, () => {
      down(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'), piece => { client.write(piece); });
      if (head.length > 0) up(head, piece => { if (!upstream.destroyed) upstream.write(piece); });
      upstream.on('data', chunk => { down(chunk, piece => { if (!client.destroyed) client.write(piece); }); });
      client.on('data', chunk => { up(chunk, piece => { if (!upstream.destroyed) upstream.write(piece); }); });
    });
    sockets.add(client); sockets.add(upstream);
    upstream.on('close', () => { sockets.delete(upstream); });
    // the server's end or failure lands after the bytes still on the down link; the browser's goes at once
    upstream.on('end', () => { down(Buffer.alloc(0), () => { if (!client.destroyed) client.end(); }); });
    upstream.on('error', () => { down(Buffer.alloc(0), () => { client.destroy(); }); });
    client.on('end', () => { up(Buffer.alloc(0), () => { if (!upstream.destroyed) upstream.end(); }); });
    client.on('error', () => { client.destroy(); upstream.destroy(); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => { sockets.delete(socket); }); });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', () => { resolve(null); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('audio-download-proof: the link has no port');
  return { port: address.port, seen, close: () => { closed = true; down.stop(); up.stop(); for (const socket of sockets) socket.destroy(); server.close(); } };
}

// ---- the local staging-like origin ------------------------------------------------------------------------------------
let builtPort = '';
/** @type {import('node:http').Server | undefined} */
let stamper;
/** @type {string | undefined} */
let builtBase;
/** The served build: `--base`, else this working tree built once with scripts/serve-build.sh. */
function servedBuild() {
  let base = option('base') ?? builtBase;
  if (base === undefined) {
    log('building this working tree (scripts/serve-build.sh)');
    const built = spawnSync('bash', ['scripts/serve-build.sh', '--name', 'audio-proof', '--hours', '2', '--shard', [...new Set(entries.map(entry => entry.slug))].join(',')],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SERVE_OWNER: process.env.SERVE_OWNER ?? 'audio-download-proof' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const url = /http:\/\/127\.0\.0\.1:(\d+)\//u.exec(built.stdout ?? '');
    if (built.status !== 0 || url === null) throw new Error('audio-download-proof: the build or its server failed (scripts/serve-build.sh)');
    base = url[0].slice(0, -1); builtPort = url[1] ?? ''; builtBase = base;
  }
  return base;
}
/** The served build as built: no world stamp, the in-page solo server (preview.wildshard.io's shape). */
function previewOrigin() { return new URL(servedBuild()).origin; }
/** The served build's origin, behind a stamper that gives every document staging's world (offline-proof.mjs's stamp). */
async function localOrigin() {
  const upstream = new URL(servedBuild());
  const release = fetch(STAGING.release, { cache: 'no-store' }).then(answer => { if (!answer.ok) throw new Error(`staging release ${String(answer.status)}`); return answer.text(); });
  release.catch(() => undefined); // a failed read fails the page's release request, never the whole run
  const RELEASE_PATH = '/__audio-proof/staging.json';
  let stamp = '';
  stamper = createServer((request, response) => {
    void (async () => {
      try {
        if (request.url === RELEASE_PATH) { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(await release); return; }
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
        answer.headers.forEach((value, name) => { if (!['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-encoding'].includes(name)) sent[name] = value; });
        const html = (answer.headers.get('content-type') ?? '').includes('text/html');
        if (html || new URL(request.url ?? '/', upstream).pathname.startsWith('/sw-core/')) {
          const text = body.toString('utf8');
          if (!text.includes('globalThis.__WS_BUILD_ID__=')) { response.writeHead(500).end('audio-download-proof: a document without the build stamp'); return; }
          const stamped = Buffer.from(text.replace('globalThis.__WS_BUILD_ID__=', `${html ? stamp : JSON.stringify(stamp).slice(1, -1)}globalThis.__WS_BUILD_ID__=`));
          for (const name of ['etag', 'last-modified']) Reflect.deleteProperty(sent, name);
          response.writeHead(answer.status, { ...sent, 'content-length': String(stamped.length) }).end(stamped);
          return;
        }
        response.writeHead(answer.status, { ...sent, 'content-length': String(body.length) }).end(body);
      } catch (error) {
        if (!response.headersSent) response.writeHead(502);
        response.end(String(error));
      }
    })();
  });
  // a fixed port per build port: the origin keys the profile's worker and caches
  const port = 7100 + Number(upstream.port || '80') % 1000;
  await new Promise((resolve, reject) => { stamper?.once('error', reject); stamper?.listen(port, '127.0.0.1', () => { resolve(null); }); });
  const origin = `http://127.0.0.1:${String(port)}`;
  stamp = `globalThis.__WS_WORLD__=${JSON.stringify({ release: `${origin}${RELEASE_PATH}`, key: RELEASE_PUBLIC_KEY })};`;
  return origin;
}

// ---- the page side ----------------------------------------------------------------------------------------------------
/** Init script: an analyser beside the mixer's buses (see the header), sampled every 100 ms into `__au14.samples`. */
function tapBuses() {
  const P = AudioNode.prototype;
  /** @type {(this: AudioNode, ...args: unknown[]) => unknown} */
  const plain = Reflect.get(P, 'connect');
  /** @type {WeakMap<AudioNode, Set<AudioNode>>} */
  const outs = new WeakMap();
  /** @type {WeakMap<AudioNode, string>} */
  const role = new WeakMap();
  /** @type {WeakMap<AudioNode, number>} */
  const inputs = new WeakMap();
  /** @type {WeakMap<BaseAudioContext, GainNode>} */
  const sinks = new WeakMap();
  /** @type {{ kind: string, node: AnalyserNode, data: Float32Array }[]} */
  const taps = [];
  /** @type {{ t: number, peaks: Record<string, number> }[]} */
  const samples = [];
  const state = { samples, taps: /** @type {string[]} */ ([]), contexts: 0 };
  Reflect.set(globalThis, '__au14', state);
  const outsOf = (/** @type {AudioNode} */ node) => [...outs.get(node) ?? []];
  const isMaster = (/** @type {AudioNode} */ node) => node instanceof GainNode && outsOf(node).some(low => low instanceof BiquadFilterNode && outsOf(low).some(comp => comp instanceof DynamicsCompressorNode));
  const tap = (/** @type {AudioNode} */ node, /** @type {string} */ kind) => {
    if (role.has(node) || !(node.context instanceof AudioContext)) return;
    role.set(node, kind);
    const context = node.context;
    let sink = sinks.get(context);
    if (sink === undefined) { sink = context.createGain(); sink.gain.value = 0; plain.call(sink, context.destination); sinks.set(context, sink); state.contexts++; }
    // 32768 frames (about 680 ms at 48 kHz) per 100 ms read: no short footstep falls between two reads
    const analyser = context.createAnalyser(); analyser.fftSize = 32_768;
    plain.call(node, analyser); plain.call(analyser, sink);
    taps.push({ kind, node: analyser, data: new Float32Array(analyser.fftSize) }); state.taps.push(kind);
  };
  /** @this {AudioNode} @param {AudioNode | AudioParam} destination @param {...number} rest */
  P.connect = /** @type {typeof P.connect} */ (function connect(destination, ...rest) {
    const result = Reflect.apply(plain, this, [destination, ...rest]);
    try {
      if (destination instanceof AudioNode) {
        const set = outs.get(this) ?? new Set(); set.add(destination); outs.set(this, set);
        if (destination === this.context.destination && this instanceof DynamicsCompressorNode) tap(this, 'out');
        else if (isMaster(destination)) {
          const n = inputs.get(destination) ?? 0; inputs.set(destination, n + 1);
          if (!role.has(this)) { if (n === 0) role.set(this, 'world'); else tap(this, 'music'); }
        } else if (role.get(destination) === 'world') {
          const n = inputs.get(destination) ?? 0; inputs.set(destination, n + 1);
          if (n === 0) tap(this, 'sfx'); else if (n === 1) tap(this, 'ambience');
        }
      }
    } catch { /* the proof's tap never breaks the game */ }
    return result;
  });
  setInterval(() => {
    /** @type {Record<string, number>} */
    const peaks = {};
    for (const one of taps) {
      one.node.getFloatTimeDomainData(/** @type {Float32Array<ArrayBuffer>} */ (one.data));
      let peak = 0; for (const value of one.data) peak = Math.max(peak, Math.abs(value));
      peaks[one.kind] = Math.max(peaks[one.kind] ?? 0, peak);
    }
    samples.push({ t: performance.now(), peaks });
    if (samples.length > 3000) samples.shift();
  }, 100);
}

/** Init script: every change of the card's phase or step, stamped in the page as it happens (a MutationObserver, so a busy
 *  main thread can't make it late the way a poll is), sent to the proof by its `__au14phase` binding. */
function logPhases() {
  let last = '';
  const read = () => {
    const load = document.querySelector('.ws-load');
    const card = load instanceof HTMLElement && !load.classList.contains('hide') && !load.hidden;
    const on = load?.querySelector('.ws-load-phase[data-state="on"]');
    const phase = card ? (on instanceof HTMLElement ? on.dataset.phase ?? 'none' : 'none') : 'page';
    const step = load instanceof HTMLElement ? load.dataset.step ?? '' : '';
    if (`${phase}/${step}` === last) return;
    last = `${phase}/${step}`;
    const send = Reflect.get(globalThis, '__au14phase');
    if (typeof send === 'function') void send({ t: Date.now(), phase, step });
  };
  new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'data-step', 'data-phase', 'class', 'hidden'] });
}

/** The device's last-end records go before each document, so a deck entry lands on the title and not on a resume. */
function clearLastEnd() {
  try {
    const name = 'wildshard.save.v2@1.device', doc = JSON.parse(localStorage.getItem(name) ?? '{"keys":{}}');
    for (const key of Object.keys(doc.keys ?? {})) if (key.startsWith('life.')) Reflect.deleteProperty(doc.keys, key);
    localStorage.setItem(name, JSON.stringify(doc));
  } catch { /* opaque origin */ }
}

/** The screen: the card's phase and step, the title, the player (offline-proof.mjs's reading). */
const readScreen = () => {
  const load = document.querySelector('.ws-load');
  const card = load instanceof HTMLElement && !load.classList.contains('hide') && !load.hidden && getComputedStyle(load).display !== 'none';
  const on = load?.querySelector('.ws-load-phase[data-state="on"]');
  const main = document.querySelector('.ws-main');
  const title = main instanceof HTMLElement && main.offsetParent !== null;
  const world = /** @type {{ __wildshard?: { world?: { player?: unknown } } }} */ (/** @type {unknown} */ (window)).__wildshard?.world;
  return {
    // in play: a player, no card, and past ENTER WORLD (the HUD drops its `intro` class then)
    card, title: title && !card, intro: document.getElementById('hud')?.classList.contains('intro') === true,
    player: world?.player !== undefined && world.player !== null && !card && document.getElementById('hud')?.classList.contains('intro') !== true,
    phase: card ? (on instanceof HTMLElement ? on.dataset.phase ?? 'none' : 'none') : title ? 'title' : 'page',
    step: load instanceof HTMLElement ? load.dataset.step ?? '' : '',
    error: (document.querySelector('.ws-load-error')?.textContent ?? '').replaceAll(/\s+/gu, ' ').slice(0, 300),
    // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees
    text: (load instanceof HTMLElement ? load.innerText : '').replaceAll(/\s+/gu, ' ').slice(0, 600), now: performance.now(),
  };
};

/** Shard select, the shard's card, ENTER WORLD. @param {import('playwright').Page} page @param {string} slug @param {string} mode */
async function pickFromDeck(page, slug, mode) {
  const select = page.locator('.ws-main-select');
  await select.waitFor({ state: 'visible', timeout: mode === 'slow' ? 180_000 : 60_000 });
  let opened = false;
  for (let i = 0; i < 8 && !opened; i++) {
    if (await page.locator('#wsdrop').isVisible().catch(() => false)) await page.locator('#wsdrop button.dismiss').click({ timeout: 3000 }).catch(() => undefined);
    opened = await select.click({ timeout: 4000 }).then(() => true, () => false);
  }
  if (!opened) throw new Error('could not open Shard select');
  await page.locator('.ws-menu-card b').first().waitFor({ state: 'attached', timeout: 30_000 });
  const names = await page.locator('.ws-menu-card b').allTextContents();
  const index = names.findIndex(name => name.trim().toLowerCase() === (CARDS[slug] ?? '').toLowerCase());
  if (index === -1) throw new Error(`no deck card "${CARDS[slug] ?? ''}" (deck: ${names.join(', ')})`);
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).click();
  await page.locator('.ws-menu-play').click();
}

/**
 * One visit in one browser.
 * @param {{ origin: string, target: string, profile: string, slug: string, route: 'grid' | 'client', mode: 'warm' | 'slow', label: string }} run
 */
async function visit(run) {
  const { profile } = run;
  const link = await startLink(run.mode === 'slow');
  /** @type {import('playwright').BrowserContext | undefined} */
  let context;
  try {
    // `<-loopback>`: loopback goes through the link too (checked: the local origin's http reads reach the proxy's log)
    context = await webkit.launchPersistentContext(profile, {
      headless: true, viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE,
      serviceWorkers: 'allow', proxy: { server: `http://127.0.0.1:${String(link.port)}`, bypass: '<-loopback>' },
    });
    return await drive(run, context, link);
  } finally {
    await bounded(context?.close() ?? Promise.resolve(), 30_000);
    link.close();
  }
}

/**
 * @param {Parameters<typeof visit>[0]} run @param {import('playwright').BrowserContext} context
 * @param {Awaited<ReturnType<typeof startLink>>} link
 */
async function drive(run, context, link) {
  const { origin, slug, route, mode, label } = run;
  let phase = 'title', step = '';
  const started = Date.now(), at = () => Date.now() - started;
  /** @type {{ t: number, ts: number, url: string, phase: string, step: string, fromSW: boolean | null, status: number }[]} */
  const rows = [];
  /** @type {{ t: number, phase: string, step: string }[]} the page's own phase log (absolute ms) */
  const pagePhases = [];
  /** @type {string[]} */
  const consoleLines = [];
  /** @type {{ t: number, phase: string, step: string }[]} */
  const phases = [];
  let outcome = 'stalled', downloadCardMB = 0, playAt = 0, proofError = '';
  /** @type {Record<string, number>} */
  let windowPeaks = {};
  /** @type {Record<string, number>} */
  let firstHeard = {};
  let taps = /** @type {string[]} */ ([]);
  {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'device', key: 'nameAsked', data: true });
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    await context.exposeBinding('__au14phase', (_source, /** @type {{ t: number, phase: string, step: string }} */ row) => { pagePhases.push(row); });
    await context.addInitScript(clearLastEnd);
    await context.addInitScript(tapBuses);
    await context.addInitScript(logPhases);
    /** @type {Map<import('playwright').Request, (typeof rows)[number]>} */
    const byRequest = new Map();
    context.on('request', request => { const row = { t: at(), ts: Date.now(), url: request.url(), phase, step, fromSW: null, status: 0 }; byRequest.set(request, row); rows.push(row); });
    context.on('response', response => { const row = byRequest.get(response.request()); if (row !== undefined) { row.status = response.status(); row.fromSW = response.fromServiceWorker(); } });
    const page = context.pages()[0] ?? await context.newPage();
    page.on('console', line => { if (line.type() === 'error') consoleLines.push(`${String(at())} ${line.text().slice(0, 300)}`); });
    page.on('pageerror', error => { consoleLines.push(`${String(at())} pageerror ${error.message.slice(0, 300)}`); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => undefined); });
    /** @type {ReturnType<typeof readScreen> | undefined} */
    let last;
    let polling = false;
    const poller = setInterval(() => {
      if (polling) return;
      polling = true;
      void bounded(page.evaluate(readScreen), 5000).then(screen => {
        polling = false;
        if (screen === undefined) return undefined;
        last = screen; phase = screen.phase; step = screen.step;
        if (phases.at(-1)?.phase !== phase || phases.at(-1)?.step !== step) phases.push({ t: at(), phase, step });
        const total = /DOWNLOAD [\d.]+ of ([\d.]+) MB/u.exec(screen.text)?.[1];
        if (total !== undefined) downloadCardMB = Math.max(downloadCardMB, Number(total));
        return undefined;
      });
    }, 200);
    const timeout = mode === 'slow' ? 240_000 : 120_000;
    try {
      if (route === 'client') {
        phase = 'none';
        // `&skipintro` (offline-proof.mjs's Open Plot entry) is the bench path (play.ts `markEntered`): it never runs ENTER
        // WORLD, so the music never starts on a one-shard page and the world bus stays hushed on a grid page. Its LOAD and
        // DOWNLOAD are judged; its sound is reported, not judged (see `silent`).
        await page.goto(new URL(`/?chunk=${slug}${benchEntry(run.target, route, slug) ? '&skipintro' : ''}`, origin).href, { waitUntil: 'commit', timeout: 120_000 });
      } else {
        await page.goto(new URL('/', origin).href, { waitUntil: 'commit', timeout: 120_000 });
        await pickFromDeck(page, slug, mode);
        phase = 'none';
      }
      let key = '', changed = Date.now(), stepKey = '', stepSince = Date.now(), cardSeen = false, picked = false;
      for (;;) {
        await sleep(400);
        if (at() > timeout) { outcome = 'stalled'; break; }
        const screen = last;
        if (screen === undefined) continue;
        if (await page.locator('.ws-load-play').isVisible().catch(() => false)) await page.locator('.ws-load-play').click({ timeout: 3000 }).catch(() => undefined);
        cardSeen ||= screen.card;
        // preview's deep link without the bench flag loads the shard, then lands on the title: the player's next step is
        // Shard select, its card, ENTER WORLD (the resident shard enters at once, HUD `enterNow`)
        if (route === 'client' && !benchEntry(run.target, route, slug) && cardSeen && screen.title && !picked) { picked = true; await pickFromDeck(page, slug, mode); }
        const now = JSON.stringify([screen.phase, screen.step, screen.error, screen.text.slice(0, 200)]);
        if (now !== key) { key = now; changed = Date.now(); }
        // the card's clock ticks in its text, so the seat wait is timed on the phase and step alone
        if (`${screen.phase}/${screen.step}` !== stepKey) { stepKey = `${screen.phase}/${screen.step}`; stepSince = Date.now(); }
        if (screen.player) { outcome = 'play'; playAt = screen.now; break; }
        if (screen.error !== '') { outcome = 'error'; break; }
        // the local build's world door: rooms-staging refuses a loopback origin, so a staging-like load ends at the seat
        // (offline-proof.mjs's seat-wait); LOAD's reads before it are what this target judges
        if (run.target === 'local' && screen.phase === 'load' && screen.step === 'server' && Date.now() - stepSince > 10_000) { outcome = 'seat-wait'; break; }
        if (Date.now() - changed > (mode === 'slow' ? 90_000 : 45_000) || at() > timeout) { outcome = 'stalled'; break; }
      }
      await page.screenshot({ path: join(out, `${label}-${outcome}.png`), timeout: 10_000 }).catch(() => undefined);
      if (outcome === 'play') {
        // the first 10 s of play: a tap (the first gesture, if the entry had none), then walk and jump so footsteps play
        const box = page.viewportSize() ?? { width: 402, height: 874 };
        await page.mouse.click(box.width / 2, box.height * 0.4).catch(() => undefined);
        const walk = async (/** @type {number} */ ms) => {
          const until = Date.now() + ms - 600;
          for (let turn = 0; Date.now() < until; turn++) {
            const held = ['w', 'a', 'w', 'd'][turn % 4] ?? 'w';
            await page.keyboard.down(held); await sleep(1200); await page.keyboard.press('Space').catch(() => undefined); await sleep(600); await page.keyboard.up(held);
          }
          await sleep(Math.max(0, until + 600 - Date.now()));
        };
        const heard = () => bounded(page.evaluate(([from, floor]) => {
          const state = /** @type {{ samples: { t: number, peaks: Record<string, number> }[], taps: string[] } | undefined} */ (Reflect.get(globalThis, '__au14'));
          /** @type {Record<string, number>} the loudest peak in the first 10 s */
          const peaks = {};
          /** @type {Record<string, number>} ms after play that each bus was first over the floor */
          const first = {};
          for (const sample of state?.samples ?? []) {
            if (sample.t < from) continue;
            for (const [kind, peak] of Object.entries(sample.peaks)) {
              if (sample.t <= from + 10_000) peaks[kind] = Math.max(peaks[kind] ?? 0, peak);
              if (peak >= floor && first[kind] === undefined) first[kind] = Math.round(sample.t - from);
            }
          }
          return { peaks, first, taps: state?.taps ?? [] };
        }, [playAt, AUDIBLE_PEAK]), 10_000);
        await walk(PLAY_WINDOW_MS);
        let audio = await heard();
        await page.screenshot({ path: join(out, `${label}-after-10s.png`), timeout: 10_000 }).catch(() => undefined);
        // a bus silent in the window: keep playing to 30 s, so the receipt says when (or whether) it starts
        if ((audio?.peaks.music ?? 0) < AUDIBLE_PEAK || (audio?.peaks.sfx ?? 0) < AUDIBLE_PEAK) { await walk(20_000); audio = await heard() ?? audio; }
        windowPeaks = audio?.peaks ?? {}; firstHeard = audio?.first ?? {}; taps = audio?.taps ?? [];
      }
    } catch (error) {
      outcome = 'error'; proofError = String(error).slice(0, 300); consoleLines.push(`proof ${proofError}`);
      await page.screenshot({ path: join(out, `${label}-error.png`), timeout: 10_000 }).catch(() => undefined);
    }
    clearInterval(poller);
    return { rows, phases, pagePhases, consoleLines, outcome, ms: at(), playAt, downloadCardMB, windowPeaks, firstHeard, taps, proofError, network: link.seen };
  }
}

/** The spawn manifest a visit read: its flow, its DOWNLOAD total and its audio on the wire. @param {string} url */
async function manifestOf(url) {
  const manifest = /** @type {{ flow?: string, wireBytes?: number, totalBytes: number, files: { url: string, bytes: number, wireBytes?: number }[],
    parts?: { url: string, members: [number, number][] }[] }} */ (await (await fetch(url)).json());
  const audio = manifest.files.filter(file => AUDIO.test(file.url));
  // the packed parts that carry audio: reading one in LOAD is reading audio from the network too
  const audioParts = new Set((manifest.parts ?? []).filter(part => part.members.some(([at]) => AUDIO.test(manifest.files[at]?.url ?? ''))).map(part => new URL(part.url, url).pathname));
  return { flow: manifest.flow ?? SPAWN.exec(new URL(url).pathname)?.[2] ?? '', downloadMB: (manifest.wireBytes ?? manifest.totalBytes) / 1e6, audioRows: audio.length,
    audioMB: audio.reduce((sum, file) => sum + (file.wireBytes ?? file.bytes), 0) / 1e6, audioParts };
}
/** The card's phase at an absolute time, from the page's own log; `fallback` (the poll's reading) when the log is empty.
 * @param {{ t: number, phase: string, step: string }[]} changes @param {number} t @param {{ phase: string, step: string }} fallback */
function phaseAt(changes, t, fallback) {
  let found;
  for (const change of changes) { if (change.t <= t) found = change; else break; }
  return found ?? (changes.length === 0 ? fallback : { phase: 'title', step: '' });
}

/**
 * Judge one visit and keep its logs.
 * @param {string} target @param {{ slug: string, route: 'grid' | 'client' }} entry @param {'warm' | 'slow'} mode
 * @param {Awaited<ReturnType<typeof visit>>} result @param {string | undefined} earlier the warm visit's manifest URL
 */
async function judge(target, entry, mode, result, earlier) {
  const label = `${target}-${entry.slug}-${entry.route}-${mode}`;
  // every request takes the phase the page's own log had when the proof saw it (the event comes after the request left, so a
  // read at the DOWNLOAD/LOAD edge counts as LOAD: the strict side)
  for (const row of result.rows) { const at = phaseAt(result.pagePhases, row.ts, row); row.phase = at.phase; row.step = at.step; }
  const network = result.network.map(row => ({ ...row, phase: phaseAt(result.pagePhases, row.t, { phase: '?', step: '' }).phase }));
  writeFileSync(join(out, `${label}-requests.json`), JSON.stringify({ rows: result.rows, network, phases: result.phases, pagePhases: result.pagePhases, console: result.consoleLines }));
  /** @type {{ rule: string, detail: string }[]} */
  const failures = [];
  // the route's own manifest; a later visit can read it from the page's store and fetch none, so it falls back to the
  // manifest the profile's earlier visit fetched for this route
  const read = result.rows.map(row => ({ url: row.url, match: SPAWN.exec(new URL(row.url).pathname) })).filter(row => row.match?.[1] === entry.slug);
  // a world build sends a deep link the grid way too (OFFLINE OF2: world builds never take the solo route), so a deep link's
  // manifest is whichever phone manifest it fetched, the one-shard `client` one first
  const phone = read.filter(row => row.match?.[3] === 'phone');
  const own = (phone.find(row => row.match?.[2] === entry.route) ?? (entry.route === 'client' ? phone[0] : undefined))?.url;
  const spawnUrl = own ?? earlier;
  const manifest = spawnUrl === undefined ? undefined : await manifestOf(spawnUrl).catch(() => undefined);
  const isAudio = (/** @type {string} */ url) => { const path = new URL(url).pathname; return AUDIO.test(path) || manifest?.audioParts.has(path) === true; };
  const audioRows = result.rows.filter(row => isAudio(row.url));
  const loadAudio = audioRows.filter(row => row.phase === 'load');
  const served = (/** @type {boolean | null} */ fromSW) => fromSW === true ? 'worker' : fromSW === false ? 'network' : 'no response';
  for (const row of loadAudio.slice(0, 5)) failures.push({ rule: 'load-audio', detail: `${row.url} (${served(row.fromSW)}, step ${row.step})` });
  if (loadAudio.length > 5) failures.push({ rule: 'load-audio', detail: `… ${String(loadAudio.length - 5)} more` });
  const netAudio = network.filter(row => !row.url.startsWith('connect://') && isAudio(row.url));
  const netLoadAudio = netAudio.filter(row => row.phase === 'load');
  for (const row of netLoadAudio.slice(0, 5)) failures.push({ rule: 'load-audio', detail: `network fetch ${row.url}` });
  /** @type {Record<string, number>} */
  const audioByPhase = {};
  for (const row of audioRows) audioByPhase[row.phase] = (audioByPhase[row.phase] ?? 0) + 1;
  // the local build's reads must reach the link, or its network check proves nothing
  if (target === 'local' && !network.some(row => row.url.startsWith('http://127.0.0.1'))) failures.push({ rule: 'link-blind', detail: 'no local http read went through the proxy' });
  if (mode === 'warm' && own === undefined) failures.push({ rule: 'route', detail: `no ${entry.slug} ${entry.route === 'grid' ? 'grid' : ''} phone manifest fetched (fetched: ${read.map(row => row.match?.[0] ?? '').join(', ') || 'none'})` });
  if (!result.pagePhases.some(row => row.phase === 'load')) failures.push({ rule: 'no-load', detail: `the card never reached LOAD (${result.outcome})` });
  const au6 = AU6_AUDIO_MB[entry.slug] ?? (entry.slug.startsWith('open-plot-') ? AU6_AUDIO_MB['open-plot-*'] ?? 0 : 0);
  if (manifest === undefined) failures.push({ rule: 'download-short', detail: `no ${entry.slug}-${entry.route}-phone spawn manifest to read` });
  else {
    if (!(manifest.downloadMB >= au6)) failures.push({ rule: 'download-short', detail: `DOWNLOAD ${manifest.downloadMB.toFixed(2)} MB < AU6 audio ${au6.toFixed(2)} MB` });
    // the download's own audio, not only its total: AU6 measured the same manifests' audio rows (2 decimals)
    if (!(manifest.audioMB >= au6 - 0.005)) failures.push({ rule: 'download-short', detail: `the download's audio ${manifest.audioMB.toFixed(2)} MB < AU6 ${au6.toFixed(2)} MB (${String(manifest.audioRows)} rows)` });
  }
  const peaks = result.windowPeaks;
  const audible = { music: (peaks.music ?? 0) >= AUDIBLE_PEAK, sfx: (peaks.sfx ?? 0) >= AUDIBLE_PEAK };
  const bench = benchEntry(target, entry.route, entry.slug);
  if (result.outcome === 'play' && !bench && !(audible.music && audible.sfx)) failures.push({ rule: 'silent', detail: `first 10 s of play: ${JSON.stringify(peaks)}, first heard (ms after play, 30 s watched) ${JSON.stringify(result.firstHeard)} (taps ${result.taps.join(',') || 'none'})` });
  // the bench deep link is not a player's entry: on a world build Driftwood's lands on the title after its LOAD (seen on staging
  // 6d11b137), so it needs LOAD (no-load) but not play
  if (result.outcome !== 'play' && !(target === 'local' && result.outcome === 'seat-wait') && !bench && mode === 'warm') failures.push({ rule: 'no-play', detail: `${result.outcome} at ${result.phases.at(-1)?.phase ?? ''}/${result.phases.at(-1)?.step ?? ''} ${result.proofError}` });
  const row = {
    entry: bench ? 'deep link, skipintro (bench path: sound not judged)' : entry.route === 'grid' ? 'Shard select, ENTER WORLD' : 'deep link, ENTER WORLD',
    target, shard: entry.slug, route: entry.route, flowRead: manifest?.flow ?? '', manifest: spawnUrl === undefined ? null : new URL(spawnUrl).pathname,
    manifestsFetched: read.map(one => new URL(one.url).pathname.split('/').pop() ?? ''), mode, outcome: result.outcome, seconds: Math.round(result.ms / 100) / 10,
    loadAudioRequests: loadAudio.length, loadAudioNetworkFetches: netLoadAudio.length, audioRequestsByPhase: audioByPhase, networkAudioFetches: netAudio.length,
    linkSeen: network.filter(one => !one.url.startsWith('connect://')).length,
    downloadMB: manifest === undefined ? null : Number(manifest.downloadMB.toFixed(2)), downloadCardMB: result.downloadCardMB || null,
    manifestAudioMB: manifest === undefined ? null : Number(manifest.audioMB.toFixed(2)), manifestAudioRows: manifest?.audioRows ?? 0, au6AudioMB: au6,
    peaksFirst10s: Object.fromEntries(Object.entries(peaks).map(([kind, peak]) => [kind, Number(peak.toFixed(4))])), firstHeardMs: result.firstHeard, audible, failures,
  };
  log(`${failures.length === 0 ? 'ok ' : 'RED'} ${label}: ${result.outcome} in ${String(row.seconds)} s, flow ${row.flowRead}, LOAD audio ${String(row.loadAudioRequests)}, `
    + `DOWNLOAD ${String(row.downloadMB)} MB (audio ${String(row.manifestAudioMB)} MB, AU6 ${String(au6)}), peaks ${JSON.stringify(row.peaksFirst10s)}`);
  for (const failure of failures) log(`      ${failure.rule} ${failure.detail}`);
  return row;
}

/** @type {Awaited<ReturnType<typeof judge>>[]} */
const results = [];
let code = 1;
try {
  /** @type {{ target: string, origin: string }[]} */
  const targets = [];
  if (['staging', 'both', 'all'].includes(targetArg)) targets.push({ target: 'staging', origin: STAGING.origin });
  if (['local', 'both', 'all'].includes(targetArg)) targets.push({ target: 'local', origin: await localOrigin() });
  // the same build as served, no world: the solo page, where a deep link takes the one-shard `client` manifest
  if (['preview', 'all'].includes(targetArg)) targets.push({ target: 'preview', origin: previewOrigin() });
  /** @type {Record<string, string>} */
  const builds = {};
  for (const { target, origin } of targets) {
    builds[target] = /** @type {{ build: string }} */ (await (await fetch(new URL('/version.json', origin))).json()).build;
    log(target, origin, 'build', builds[target]);
    // preview has no world and no deck route to judge: only the deep links
    const queue = entries.filter(entry => target !== 'preview' || entry.route === 'client');
    const worker = async () => {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        const profile = join(out, `profile-${target}-${entry.slug}-${entry.route}`);
        rmSync(profile, { recursive: true, force: true });
        /** @type {string | undefined} */
        let earlier;
        for (const mode of /** @type {const} */ (['warm', 'slow'])) {
          const label = `${target}-${entry.slug}-${entry.route}-${mode}`;
          log(label);
          try {
            const row = await judge(target, entry, mode, await visit({ origin, target, profile, slug: entry.slug, route: entry.route, mode, label }), earlier);
            if (row.manifest !== null) earlier = new URL(row.manifest, origin).href;
            results.push(row);
          }
          catch (error) { log(`${label} broke: ${String(error)}`); results.push({ target, shard: entry.slug, route: entry.route, flowRead: '', manifest: null, manifestsFetched: [], mode, outcome: 'error', seconds: 0, loadAudioRequests: 0, loadAudioNetworkFetches: 0, audioRequestsByPhase: {}, networkAudioFetches: 0, linkSeen: 0, downloadMB: null, downloadCardMB: null, manifestAudioMB: null, manifestAudioRows: 0, au6AudioMB: 0, peaksFirst10s: {}, firstHeardMs: {}, audible: { music: false, sfx: false }, failures: [{ rule: 'proof-error', detail: String(error).slice(0, 300) }] }); }
        }
        rmSync(profile, { recursive: true, force: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => worker()));
  }
  const failing = results.filter(row => row.failures.length > 0).map(row => `${row.target}:${row.shard}:${row.route}:${row.mode}`);
  code = failing.length === 0 ? 0 : 1;
  const receipt = { proof: 'audio-download-proof.mjs (AUDIO AU14)', browser: `webkit ${webkit.name()} headless 402x874`, link: 'own forward proxy; slow = 0.7 Mbit/s shared, 150 ms each way',
    builds, started: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), red: code !== 0, failing, results };
  writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 1)}\n`);
  log(code === 0 ? 'GREEN' : `RED: ${failing.join(', ')}`, '| receipt in', out);
} finally {
  stamper?.close();
  if (builtPort !== '') spawnSync('bash', ['scripts/serve-build.sh', 'stop', builtPort], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, SERVE_OWNER: process.env.SERVE_OWNER ?? 'audio-download-proof' } });
}
process.exit(code);
