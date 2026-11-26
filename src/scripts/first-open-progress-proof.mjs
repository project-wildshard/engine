#!/usr/bin/env node
// FIRST-OPEN-PROGRESS (QA-FEEDBACK 2026-11-16 row 17, PAGE-SIZE PZ29): Jake's iPhone sat ~10 s on the static WILDSHARD title
// with no progress on a cold first open of v0.1.29. This proof opens the built page cold in headless WebKit at 402x874 (a
// fresh context: no cache, no service worker) through a shaped phone line, records every animation frame from the first
// until the live menu is up, and saves a video, a screenshot every 250 ms and a contact sheet. Manual, outside hooks:
//
//   pnpm build:game && node src/scripts/first-open-progress-proof.mjs [--standalone] [--dist=dist] [--out=tmp/first-open] [--kbps=1600] [--rtt=150]
//   node src/scripts/first-open-progress-proof.mjs --serve   (only the shaped server, for the iOS Simulator's Safari)
//
// A frame passes when progress on screen moves: the static shell's bar with its CSS sweep running (no JS needed), or a bar
// fill or step text that changed within the last second. It exits 1 on any frame before the menu that fails. Headless WebKit
// paints the shell at once either way; a Home Screen iPhone shows its still launch image until the document's `load`, so
// --standalone (navigator.standalone) also fails unless `load` comes before the first bundle request (lateBootTags).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve as absolute } from 'node:path';
import { webkit } from "./browser-playwright.mjs";

const arg = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dist = absolute(arg('dist', 'dist')), out = absolute(arg('out', 'tmp/first-open')), kbps = Number(arg('kbps', '1600')), rtt = Number(arg('rtt', '150'));
if (!existsSync(join(dist, 'index.html'))) throw new Error(`no built page at ${dist}: pnpm build:game first`);
mkdirSync(out, { recursive: true });

const TYPES = /** @type {Record<string,string>} */ ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2' });
// One shared line: every response's bytes queue behind the others', as on a phone's single link, after one round trip.
const bytesPerMs = (kbps * 1000) / 8 / 1000;
let lineFree = 0;
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/u, '');
  // The build splits content (title art, shard files) into dist-content; a deploy serves both from one origin.
  const file = [dist, `${dist}-content`].map(root => join(root, path === '/' ? 'index.html' : path)).find(name => name.startsWith(dist) && existsSync(name) && statSync(name).isFile());
  if (file === undefined) { response.writeHead(404).end(); return; }
  const size = statSync(file).size, now = performance.now(), start = Math.max(now + rtt, lineFree);
  lineFree = start + size / bytesPerMs;
  if (process.argv.includes('--serve')) console.log(`${Math.round(now)} ms ${path} ${size} B, done by ${Math.round(lineFree)} ms`);
  setTimeout(() => {
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': size,
      // as deployed: hashed files immutable, so the stylesheet's print-to-all swap reuses its bytes; the page always revalidates
      'cache-control': path.startsWith('/b/') || path.startsWith('/assets/') || path.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    const stream = createReadStream(file, { highWaterMark: 16 * 1024 });
    stream.on('data', chunk => { stream.pause(); response.write(chunk); setTimeout(() => { stream.resume(); }, chunk.length / bytesPerMs); });
    stream.on('end', () => { response.end(); });
  }, start - now);
});
await new Promise(resolve => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
// --serve: only the shaped server, for a real Safari (the iOS Simulator shares this Mac's loopback). Stops on SIGINT.
if (process.argv.includes('--serve')) {
  console.log(`serving ${dist} at ${origin} (${kbps} kbps, ${rtt} ms)`);
  await new Promise(resolve => { process.once('SIGINT', resolve); });
  server.close();
  process.exit(0);
}

/** @typedef {{t:number,shell:boolean,shellBar:boolean,sweep:string,fills:string,bars:number,texts:string,menu:boolean,cls:string}} Frame */
const standalone = process.argv.includes('--standalone');
let handover = { load: Number.NaN, firstBundle: Number.NaN };
const browser = await webkit.launch({ headless: true });
/** @type {Frame[]} */ let frames = [];
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    recordVideo: { dir: out, size: { width: 402, height: 874 } } });
  // Only this server: nothing reaches a real host from a proof.
  await context.route(url => !url.href.startsWith(origin), route => route.abort());
  // Playwright's own calls wait while WebKit parses and loads, which is the very stretch under test, so the page records
  // itself on each animation frame and the proof reads the record once the menu is up.
  await context.addInitScript(() => {
    /** @type {unknown[]} */ const rows = [];
    Object.defineProperty(globalThis, '__firstOpen', { value: rows });
    const visible = (/** @type {Element|null} */ el) => {
      if (el === null) return false;
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && (el.checkVisibility?.() ?? true);
    };
    const frame = () => {
      if (document.documentElement !== null && document.body !== null) {
        const shellBar = document.querySelector('[data-title-shell] .ws-launch-bar');
        const bars = [...document.querySelectorAll('[data-launch-fill], .ws-load-fill, .ws-launch-bar, .ws-load-bar')].filter(visible);
        const texts = [...document.querySelectorAll('[data-launch-step], .ws-load [data-el="clock"], .ws-load [data-el="foot"]')].filter(visible).map(el => el.textContent).join(' | ');
        rows.push({ t: performance.now(), shell: visible(document.querySelector('[data-title-shell]')), shellBar: visible(shellBar),
          sweep: shellBar === null ? 'none' : getComputedStyle(shellBar, '::after').animationName,
          fills: bars.map(el => el instanceof HTMLElement ? el.style.width : '').join(','), bars: bars.length, texts,
          // the menu counts once it is up and styled: an unstyled deck is no menu a player can use
          menu: performance.getEntriesByName('wildshard.title').length > 0 && [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link instanceof HTMLLinkElement && link.media !== 'print' && link.sheet !== null),
          cls: document.documentElement.className });
      }
      if (rows.length < 5000) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  // --standalone: a Home Screen launch, as index.html and lateBootTags test it.
  if (standalone) await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true }); });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => /** @type {any[]} */ ((/** @type {any} */ (globalThis)).__firstOpen).some(row => row.menu), undefined, { timeout: 90_000, polling: 250 });
  await page.waitForTimeout(1500);
  // a real screenshot of the menu (the recorded video can lag the page by a second or more)
  await page.screenshot({ path: join(out, 'menu.png') });
  frames = await page.evaluate(() => /** @type {any} */ (globalThis).__firstOpen);
  const timing = await page.evaluate(() => ({ paint: performance.getEntriesByType('paint').map(row => [row.name, Math.round(row.startTime)]),
    nav: performance.getEntriesByType('navigation').map(row => { const nav = /** @type {PerformanceNavigationTiming} */ (row); return { responseStart: Math.round(nav.responseStart), responseEnd: Math.round(nav.responseEnd), domInteractive: Math.round(nav.domInteractive), load: Math.round(nav.loadEventStart), bytes: nav.transferSize || nav.decodedBodySize }; }),
    resources: /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource')).filter(res => res.startTime < 8000)
      .map(res => [Math.round(res.startTime), Math.round(res.responseEnd), res.decodedBodySize, res.name.replace(location.origin, '')]) }));
  writeFileSync(join(out, 'timing.json'), JSON.stringify(timing, null, 1));
  console.log(`first paint ${JSON.stringify(timing.paint)}; document ${JSON.stringify(timing.nav)}`);
  for (const [start, end, bytes, name] of timing.resources.slice(0, 14)) console.log(`  ${String(start).padStart(5)}-${String(end).padStart(5)} ms ${String(bytes).padStart(8)} B ${name}`);
  // iOS keeps a Home Screen app's still launch image until `load`: the moment the live shell can first be seen.
  handover = { load: timing.nav[0]?.load ?? Number.NaN, firstBundle: Math.min(...timing.resources.filter(row => String(row[3]).startsWith('/b/')).map(row => Number(row[0]))) };
  const video = page.video();
  await context.close();
  if (video !== null) {
    const file = await video.path();
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'fps=4', join(out, 'frame-%03d.png')]);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'fps=2,scale=201:-1,tile=8x3', '-frames:v', '1', join(out, 'sheet.png')]);
  }
} finally {
  await browser.close();
  server.close();
}
let failed = 0, lastChange = -Infinity, lastKey = '';
const verdicts = frames.map(row => {
  const key = `${row.fills}|${row.texts}`;
  if (key !== lastKey) { lastKey = key; lastChange = row.t; }
  const moving = (row.shellBar && row.sweep !== 'none') || (row.bars > 0 && row.t - lastChange < 1000);
  if (!row.menu && !moving) failed++;
  return Object.assign(row, { moving });
});
const firstMenu = verdicts.find(row => row.menu);
verdicts.forEach((row, at) => {
  const before = verdicts[at - 1];
  if (at % 20 !== 0 && before?.moving === row.moving && before?.menu === row.menu) return;
  console.log(`${(row.t / 1000).toFixed(2).padStart(6)} s ${row.menu ? 'MENU ' : row.moving ? 'ok   ' : 'STILL'} shell=${row.shell} shellBar=${row.shellBar} sweep=${row.sweep} bars=${row.bars} "${row.texts.slice(0, 70)}" cls="${row.cls}"`);
});
writeFileSync(join(out, 'frames.json'), JSON.stringify({ kbps, rtt, frames: verdicts }, null, 1));
console.log(`${verdicts.length} frames from ${((verdicts[0]?.t ?? 0) / 1000).toFixed(2)} s, menu at ${firstMenu === undefined ? 'never' : `${(firstMenu.t / 1000).toFixed(2)} s`}; ${failed} frame(s) before it with no moving progress; ${out}`);
// A Home Screen launch must reach `load` before it fetches any bundle byte, or iOS shows the still image for the whole boot.
const handedOver = !standalone || handover.load <= handover.firstBundle;
console.log(`load at ${handover.load} ms, first bundle request at ${handover.firstBundle} ms${standalone ? `: the launch image hands over ${handedOver ? 'before the bundle' : 'only after the bundle (FAIL)'}` : ''}`);
process.exitCode = failed === 0 && firstMenu !== undefined && handedOver ? 0 : 1;
