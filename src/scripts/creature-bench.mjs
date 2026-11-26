#!/usr/bin/env node
// ONE-FORMAT CC53/CC54/CC55: the 30-deer phone bench. Builds src/scripts/creature-bench/ with vite, serves it with one GLB as
// /deer.glb, and reads each (mode, distance) page in a fresh page of one headless, muted Chromium (the browser broker's
// slot, src/scripts/browser-playwright.mjs) on the iPhone 17 Pro viewport (402x874 CSS, device scale 3), the renderer at
// the phone tier's pixel ratio 2, CPU throttled 4x as the draw census does. rAF caps the page at 60 fps; each page is
// closed the moment its numbers are read.
//
//   node src/scripts/creature-bench.mjs --glb=<deer.glb> --out=<dir> [--modes=skinned,baked,sprite] [--dists=20,60,120]
//                                   [--n=30] [--frames=180] [--cpu=4] [--shots]
// Prints a markdown table and writes <out>/creature-bench.json. Diagnostic: no gate reads it.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve as resolvePath, sep } from 'node:path';
import { build } from 'vite';

/** @param {string} name @param {string} fallback @returns {string} */
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const glb = arg('glb', '');
const out = arg('out', '');
if (glb === '' || out === '' || !existsSync(glb)) {
  console.error('usage: node src/scripts/creature-bench.mjs --glb=<deer.glb> --out=<dir> [--modes=…] [--dists=…]');
  process.exit(2);
}
const modes = arg('modes', 'skinned').split(',');
const dists = arg('dists', '20,60,120').split(',').map(Number);
const shots = process.argv.includes('--shots');
const n = Number(arg('n', '30')), frames = Number(arg('frames', '180')), cpuRate = Number(arg('cpu', '4'));

const root = resolvePath('src/scripts/creature-bench');
const dist = resolvePath(out, 'dist');
mkdirSync(out, { recursive: true });
await build({ root, base: './', logLevel: 'warn', configFile: false, build: { outDir: dist, emptyOutDir: true, target: 'es2022' } });

/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const file = path === '/deer.glb' ? resolvePath(glb) : resolvePath(dist, `.${path === '/' ? '/index.html' : path}`);
  if (file !== resolvePath(glb) && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
const address = server.address();
const port = typeof address === 'object' && address !== null ? address.port : 0;

const { chromium } = await import('./browser-playwright.mjs');
const browser = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--use-mock-keychain', '--password-store=basic', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
/** @typedef {{ p50: number, p95: number }} Spread */
/** @typedef {{ mode: string, dist: number, n: number, calls: number, triangles: number, cpuMs: Spread, poseMs: Spread,
 *   gpuMs: Spread | null, intervalMs: Spread, renderer: string, canvas: number[] }} BenchRow */
/** @type {BenchRow[]} */
const rows = [];
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  for (const mode of modes) for (const d of dists) {
    const page = await context.newPage();
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      await page.goto(`http://127.0.0.1:${port}/?mode=${mode}&dist=${d}&n=${n}&frames=${frames}`);
      await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 120_000 });
      /** @type {BenchRow | { error: string } | undefined} */
      const r = await page.evaluate(() => /** @type {any} */ (window).__bench);
      if (r === undefined || 'error' in r) throw new Error(`${mode}@${d}: ${r === undefined ? 'no result' : r.error}`);
      rows.push(r);
      if (shots) await page.screenshot({ path: join(out, `${mode}-${d}m.png`) });
      console.error(`${mode} ${d} m: cpu p50 ${r.cpuMs.p50} ms, calls ${r.calls}`);
    } finally { await page.close(); }
  }
  await context.close();
} finally {
  await browser.close();
  server.close();
}

/** @param {number | null | undefined} x */
const ms = (x) => (x === null || x === undefined ? 'n/a' : x.toFixed(2));
const table = [
  `| mode | dist m | deer | draw calls | triangles | CPU ms p50 / p95 | pose ms p50 / p95 | GPU ms p50 / p95 | frame interval p95 |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.mode} | ${r.dist} | ${r.n} | ${r.calls} | ${r.triangles} | ${ms(r.cpuMs.p50)} / ${ms(r.cpuMs.p95)} | ${ms(r.poseMs.p50)} / ${ms(r.poseMs.p95)} | ${r.gpuMs === null ? 'n/a' : `${ms(r.gpuMs.p50)} / ${ms(r.gpuMs.p95)}`} | ${ms(r.intervalMs.p95)} |`),
].join('\n');
writeFileSync(join(out, 'creature-bench.json'), `${JSON.stringify({ cpuRate, viewport: [402, 874, 3], rows }, null, 2)}\n`);
console.log(`renderer: ${rows[0]?.renderer ?? 'n/a'}; canvas ${rows[0]?.canvas.join('x') ?? 'n/a'}; CPU ${cpuRate}x\n${table}`);
