#!/usr/bin/env node
// Render the first-document shell as iOS's pre-document launch image.
// Rebuild after changing its approved hero/style: node scripts/generate-title-launch.mjs
import { readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { titleAssetURLs } from './title-assets.mjs';
import { browserPool } from './parity/pool.mjs';

const root = resolve(import.meta.dirname, '..');
const titleSources = new Map(Object.entries(titleAssetURLs(root)).map(([source, url]) => [url, source]));
const source = readFileSync(resolve(root, 'index.html'), 'utf8');
const style = /<style>([\s\S]*?)<\/style>/u.exec(source)?.[1];
const shell = /<div class="ws-launch" data-title-shell>[\s\S]*?<\/div><!-- \/title-shell -->/u.exec(source)?.[0];
if (style === undefined || shell === undefined) throw new Error('Missing first-document title shell');
// Standalone content starts below the 62 px phone status area (index.html E58).
const nativeInset = 62;
const previous = /rel="apple-touch-startup-image" href="([^"]+)"/u.exec(source)?.[1];
if (previous === undefined) throw new Error('Missing native launch image link');
const pool = browserPool(root, 1, 'metal');
try {
  const browser = await pool.browser(0);
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  try {
    await context.route('http://launch.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="title-first"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style} html.title-first .ws-launch { top: ${nativeInset}px; }</style></head><body>${shell}</body></html>` });
      } else if (path.startsWith('/assets/title/') || path.startsWith('/fonts/')) {
        const asset = resolve(root, 'public', `.${titleSources.get(path) ?? path}`);
        if (!asset.startsWith(`${resolve(root, 'public')}/`)) throw new Error('Invalid launch asset');
        await route.fulfill({ path: asset });
      } else throw new Error(`Unexpected launch dependency: ${path}`);
    });
    const page = await context.newPage();
    await page.goto('http://launch.test/', { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await document.fonts.ready; });
    // Keep the exact rendered pixels inside the existing native launch byte pin.
    const png = await sharp(await page.screenshot({ animations: 'disabled' }))
      .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);
    const url = `/assets/title/launch-1206x2622-${hash}.png`;
    const output = resolve(root, `public${url}`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, png);
    writeFileSync(resolve(root, 'index.html'), source.replace(previous, url));
    if (previous !== url && /^\/assets\/title\/launch-1206x2622(?:-[a-f0-9]{12})?\.png$/u.test(previous)) {
      const old = resolve(root, `public${previous}`);
      if (existsSync(old)) unlinkSync(old);
    }
    console.info(`${output} (${png.byteLength} bytes); refresh its exact storage pin`);
  } finally { await context.close(); }
} finally { await pool.close(); }
