// Run by name, never in the gated Vitest suite (it needs browsers): CI's e2e job runs it in Chromium.
//   [WS_TITLE_LAYOUT=<shots dir>] [WS_TITLE_LAYOUT_BROWSERS=chromium,webkit] scripts/browser-lane.sh node --test test/title-layout-browser.proof.mjs
// Jake, 2026-11-10, on play.wildshard.io: "The hero is so fucking tiny on the main menu", and the build pill's 40-character
// commit ran over the logo's D. The real main menu, WHAT'S NEW box and build pill (test/title-layout/page.ts) with the app's
// stylesheets and fonts, Developer on and an online build's Check connection row: every row the title can show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build } from 'vite';
import { engineRelease } from '../scripts/changelog.mjs';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';

const OUT = resolve('tmp/title-layout'), SHOTS = process.env['WS_TITLE_LAYOUT'] ?? resolve('tmp/title-layout-shots');
const BROWSERS = (process.env['WS_TITLE_LAYOUT_BROWSERS'] ?? 'chromium').split(',');
/** @type {Readonly<Record<string, string>>} */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const BUILD = 'a8144a50e79afe7e66a8ecdce9406e152518c916'; // a world build's id is the full engine commit
/** 402 × 874: an iPhone with no browser chrome; 402 × 654: the same phone in Safari, toolbars showing (Jake's screenshot);
 *  874 × 402: the phone turned (the short-landscape rules); 1440 × 900: a laptop */
const SIZES = [[402, 874], [402, 654], [874, 402], [1440, 900]];

/** @typedef {{ x: number, y: number, r: number, b: number, h: number }} Box */
/** @param {Box} a @param {Box} b */
const overlaps = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

test('the title keeps a big hero, a short build label clear of the logo, and the changelog one tap away', { timeout: 180_000 }, async () => {
  mkdirSync(SHOTS, { recursive: true });
  const release = engineRelease(process.cwd());
  await build({ configFile: false, root: resolve('test/title-layout'), logLevel: 'warn', publicDir: false,
    define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: '(globalThis.__WS_BUILD_ID__ ?? "")', __DEVSERVER__: 'false', __ENGINE_RELEASE__: JSON.stringify(release) },
    build: { outDir: OUT, emptyOutDir: true, target: 'es2022', minify: false } });
  const fonts = (readFileSync('index.html', 'utf8').match(/@font-face\{[^}]*\}/gu) ?? []).join('\n');
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/fonts.css') { response.writeHead(200, { 'content-type': 'text/css' }).end(fonts); return; }
    for (const base of [OUT, resolve('public')]) {
      try { const file = join(base, path === '/' ? 'index.html' : path), bytes = readFileSync(file); response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(bytes); return; } catch { /* the next root */ }
    }
    response.writeHead(404).end();
  });
  await new Promise(ready => { server.listen(0, '127.0.0.1', () => { ready(null); }); });
  const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    for (const name of BROWSERS) {
      const browser = name === 'webkit' ? await webkit.launch() : await chromium.launch({ args: [...KEYCHAIN_ARGS] });
      try {
        for (const [width = 0, height = 0] of SIZES) for (const open of [false, true]) {
          const portrait = height > width, where = `${name} ${String(width)}x${String(height)}${open ? ' open' : ''}`;
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: portrait ? 3 : 1 });
          await page.goto(`http://127.0.0.1:${String(port)}/?build=${BUILD}`);
          await page.waitForFunction(() => /** @type {{ titleReady?: boolean }} */ (/** @type {unknown} */ (window)).titleReady === true);
          await page.evaluate(() => document.fonts.ready);
          if (open) await page.locator('.ws-whatsnew-head').click();
          const layout = await page.evaluate(() => {
            /** @param {Element | Range} el */
            const box = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, h: b.height }; };
            /** @param {string} selector */
            const one = selector => { const el = document.querySelector(selector); if (el === null) throw new Error(`missing ${selector}`); return el; };
            const range = document.createRange();
            range.selectNodeContents(one('.ws-main-logo'));
            const pill = document.querySelector('.ws-update.visible'), body = document.querySelector('.ws-whatsnew-body');
            return { vh: innerHeight, logo: box(range), pill: pill === null ? null : box(pill),
              pillText: document.querySelector('.ws-update [data-el="text"]')?.textContent ?? '',
              boxBuild: document.querySelector('.ws-whatsnew-build')?.textContent ?? '', hero: box(one('.ws-main-hero')),
              rows: ['.ws-main-cards', '.ws-main-settings', '.ws-main-dev', '.ws-main-doctor'].map(selector => box(one(selector))),
              notes: [...document.querySelectorAll('.ws-whatsnew-list li')].filter(li => li instanceof HTMLElement && li.offsetParent !== null).map(li => li.textContent),
              panel: body instanceof HTMLElement && !body.hidden ? box(body) : null };
          });
          await page.screenshot({ path: join(SHOTS, `${name}-${String(width)}x${String(height)}${open ? '-open' : ''}.png`) });
          await page.close();
          // the short commit and the engine version, never the 40-character id, and clear of the logo
          assert.match(layout.pillText, new RegExp(`^v${release.version.replaceAll('.', '\\.')} · ${BUILD.slice(0, 7)}( · reload)?$`, 'u'), where);
          assert.equal(layout.boxBuild, `V${release.version} · ${BUILD.slice(0, 7).toUpperCase()}`, where);
          assert.notEqual(layout.pill, null, where);
          if (layout.pill !== null) assert.equal(overlaps(layout.pill, layout.logo), false, `${where}: the pill runs onto the logo`);
          // every card and button whole on screen, none on another or on the hero
          for (const [i, row] of layout.rows.entries()) {
            assert.ok(row.b <= layout.vh, `${where}: row ${String(i)} runs off the screen`);
            if (portrait) assert.equal(overlaps(row, layout.hero), false, `${where}: row ${String(i)} covers the hero`);
          }
          const [cards, settings] = layout.rows;
          if (cards !== undefined && settings !== undefined) assert.equal(overlaps(cards, settings), false, where);
          // the hero is at least 30% of a portrait phone, whether or not the changelog is open
          if (portrait) assert.ok(layout.hero.h / layout.vh >= 0.3, `${where}: the hero is ${String(Math.round(layout.hero.h))} px`);
          // opening the box shows this version's bullets, exactly, on screen; folded, none
          assert.deepEqual(layout.notes, open ? release.notes : [], where);
          if (open) {
            assert.notEqual(layout.panel, null, where);
            if (layout.panel !== null) assert.ok(layout.panel.b <= layout.vh, `${where}: the changelog runs off the screen`);
          }
        }
      } finally { await browser.close(); }
    }
  } finally { await new Promise(done => { server.close(() => { done(null); }); }); }
});
