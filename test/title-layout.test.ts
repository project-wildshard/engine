// oxlint-disable-next-line import/no-nodejs-modules -- It serves the built title page and keeps its screenshots.
import { mkdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import type { AddressInfo } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { extname, join, resolve } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { engineRelease } from '../scripts/changelog.mjs';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';

// Jake, 2026-11-10, on play.wildshard.io: "The hero is so fucking tiny on the main menu", and the build pill's 40-character
// commit ran over the logo's D. The real main menu, WHAT'S NEW box and build pill (test/title-layout/page.ts) with the app's
// stylesheets and fonts, Developer on and an online build's Check connection row: every row the title can show. It needs a
// browser, so it runs only by name (CI's e2e job runs it in Chromium):
//   WS_TITLE_LAYOUT=<folder> [WS_TITLE_LAYOUT_BROWSERS=chromium,webkit] scripts/browser-lane.sh pnpm exec vitest run test/title-layout.test.ts
const FOLDER = process.env['WS_TITLE_LAYOUT'], OUT = resolve('tmp/title-layout');
const BROWSERS = (process.env['WS_TITLE_LAYOUT_BROWSERS'] ?? 'chromium').split(',');
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const BUILD = 'a8144a50e79afe7e66a8ecdce9406e152518c916'; // a world build's id is the full engine commit
/** 402 × 874: an iPhone with no browser chrome; 402 × 654: the same phone in Safari, toolbars showing (Jake's screenshot) */
const SIZES = [[402, 874], [402, 654], [1440, 900]] as const;

interface Box { readonly x: number; readonly y: number; readonly r: number; readonly b: number; readonly h: number }
interface Layout {
  readonly vh: number; readonly logo: Box; readonly pill: Box | null; readonly pillText: string; readonly boxBuild: string;
  readonly hero: Box; readonly rows: readonly Box[]; readonly notes: number;
}
const overlaps = (a: Box, b: Box): boolean => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

test.skipIf(FOLDER === undefined)('the title keeps a big hero, a short build label clear of the logo, and the changelog one tap away', async () => {
  if (FOLDER === undefined) return;
  mkdirSync(FOLDER, { recursive: true });
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
  await new Promise<void>(ready => { server.listen(0, '127.0.0.1', ready); });
  const { port } = server.address() as AddressInfo;
  try {
    for (const name of BROWSERS) {
      const browser: Browser = name === 'webkit' ? await webkit.launch() : await chromium.launch({ args: [...KEYCHAIN_ARGS] });
      try {
        for (const [width, height] of SIZES) for (const open of [false, true]) {
          const portrait = height > width, where = `${name} ${String(width)}x${String(height)}${open ? ' open' : ''}`;
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: portrait ? 3 : 1 });
          await page.goto(`http://127.0.0.1:${String(port)}/?build=${BUILD}`);
          await page.waitForFunction(() => (window as unknown as { titleReady?: boolean }).titleReady === true);
          await page.evaluate(() => document.fonts.ready);
          if (open) await page.locator('.ws-whatsnew-head').click();
          const layout = await page.evaluate((): Layout => {
            const box = (el: Element | Range): Box => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, h: b.height }; };
            const one = (selector: string): Element => { const el = document.querySelector(selector); if (el === null) throw new Error(`missing ${selector}`); return el; };
            const range = document.createRange();
            range.selectNodeContents(one('.ws-main-logo'));
            const pill = document.querySelector('.ws-update.visible');
            return { vh: innerHeight, logo: box(range), pill: pill === null ? null : box(pill),
              pillText: document.querySelector('.ws-update [data-el="text"]')?.textContent ?? '',
              boxBuild: document.querySelector('.ws-whatsnew-build')?.textContent ?? '', hero: box(one('.ws-main-hero')),
              rows: ['.ws-main-cards', '.ws-main-settings', '.ws-main-dev', '.ws-main-doctor'].map(selector => box(one(selector))),
              notes: document.querySelectorAll('.ws-whatsnew-list li').length };
          });
          await page.screenshot({ path: join(FOLDER, `${name}-${String(width)}x${String(height)}${open ? '-open' : ''}.png`) });
          await page.close();
          // the short commit and the engine version, never the 40-character id, and clear of the logo
          expect(layout.pillText, where).toMatch(new RegExp(`^v${release.version.replaceAll('.', '\\.')} · ${BUILD.slice(0, 7)}( · reload)?$`, 'u'));
          expect(layout.boxBuild, where).toBe(`V${release.version} · ${BUILD.slice(0, 7).toUpperCase()}`);
          expect(layout.pill, where).not.toBeNull();
          if (layout.pill !== null) expect(overlaps(layout.pill, layout.logo), `${where}: the pill runs onto the logo`).toBe(false);
          // every card and button whole on screen, none on another or on the hero
          for (const [i, row] of layout.rows.entries()) {
            expect(row.b, `${where}: row ${String(i)} runs off the screen`).toBeLessThanOrEqual(layout.vh);
            if (portrait) expect(overlaps(row, layout.hero), `${where}: row ${String(i)} covers the hero`).toBe(false);
          }
          expect(overlaps(layout.rows[0] ?? layout.hero, layout.rows[1] ?? layout.hero), where).toBe(false);
          // the hero is at least 30% of a portrait phone, whether or not the changelog is open
          if (portrait) expect(layout.hero.h / layout.vh, `${where}: the hero is ${String(Math.round(layout.hero.h))} px`).toBeGreaterThanOrEqual(0.3);
          if (open) expect(layout.notes, where).toBe(release.notes.length);
        }
      } finally { await browser.close(); }
    }
  } finally { await new Promise(done => { server.close(done); }); }
}, 120_000);
