#!/usr/bin/env node
// browser-lane: original public title/select, page-requested code only, no forced GC or response bodies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { devices } from 'playwright';
import { launchMemoryBrowser } from './chromium-memory-browser.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = option('base'), pin = option('pin'), output = option('out'), directory = option('dist');
if (!base || !/^[a-f0-9]{40}$/u.test(pin ?? '') || !output || !directory) throw new Error('Expected --base --pin --dist --out');
const version = await (await fetch(new URL('/version.json', base))).json();
if (!version.build.startsWith((pin ?? '').slice(0, 7))) throw new Error('Preview pin differs');
const dist = resolvePath(directory), modules = JSON.parse(readFileSync(resolvePath(dist, '.vite/chunk-modules.json'), 'utf8'));
const memory = await launchMemoryBrowser(['--mute-audio', '--enable-precise-memory-info', '--use-angle=metal']);
const result = { pin, version, serviceWorkers: 'blocked', forcedGC: false, rows: /** @type {any[]} */ ([]), errors: /** @type {string[]} */ ([]) };
try {
  const context = await memory.browser.newContext({ ...devices['iPhone 16 Pro'], serviceWorkers: 'block' });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: false });
  await saveFixture(context, { scope: 'global', key: 'settings', data: { tier: 'phone', volume: 0, music: 0 }, merge: true });
  const page = await context.newPage(), session = await context.newCDPSession(page);
  page.on('pageerror', error => result.errors.push(error.message));
  const entryURL = new URL(base); entryURL.searchParams.set('sw', '0');
  await page.goto(entryURL.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60000 });
  for (const stage of ['title', 'select']) {
    if (stage === 'select') await page.locator('.ws-main-select').click();
    await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(undefined); }); }); }));
    const urls = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource').map(row => row.name).filter(url => /\.js(?:[?#]|$)/u.test(url)))]);
    const files = [...new Set(urls.map(url => new URL(url).pathname.replace(/^\//u, '')))];
    const code = files.map(file => {
      const row = modules[file]; if (!row) throw new Error(`No module receipt for ${file}`);
      if (!Number.isSafeInteger(row.gzBytes) || row.gzBytes < 0) throw new Error(`Missing gzip bytes for ${file}`);
      return { file, rawBytes: readFileSync(resolvePath(dist, file)).length, gzipBytes: row.gzBytes, modules: row.moduleIds };
    });
    result.rows.push({ stage, files: code, rawBytes: code.reduce((sum, row) => sum + row.rawBytes, 0),
      gzipBytes: code.reduce((sum, row) => sum + row.gzipBytes, 0), heap: await session.send('Runtime.getHeapUsage') });
  }
} finally { await memory.close(); }
if (result.errors.length > 0) throw new Error(result.errors.join('\n'));
const kernels = new Map();
for (const row of result.rows) {
  const key = JSON.stringify(row.files.map((/** @type {{ file: string }} */ item) => item.file));
  if (kernels.has(key)) { row.compileKernel = kernels.get(key); continue; }
  const kernel = spawnSync(process.execPath, ['--expose-gc', '--experimental-vm-modules', 'scripts/js-payload-heap.mjs', ...row.files.map((/** @type {{ file: string }} */ item) => resolvePath(dist, item.file))], { encoding: 'utf8' });
  if (kernel.status !== 0) throw new Error(kernel.stderr ?? 'Compile kernel refused');
  row.compileKernel = JSON.parse(kernel.stdout);
  kernels.set(key, row.compileKernel);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.rows.map(row => ({ stage: row.stage, raw: row.rawBytes, gzip: row.gzipBytes, heap: row.heap }))));
