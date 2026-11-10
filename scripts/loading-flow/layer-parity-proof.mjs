#!/usr/bin/env node
// NINE-DRAGON-BENCHMAX NB2's parity proof: a paint layer's texels from the image worker (imageDecode.worker.ts, its
// OffscreenCanvas path) against the page's own read-back (worldSceneTextures.ts `pixels` and its alpha merge), byte for byte,
// for every paint layer a served build carries. Both run from their source files in one headless Chromium page; the files
// are the served build's own (`--base`, a scripts/serve-build.sh preview with Nine). A named proof, not a gated test.
//   node scripts/loading-flow/layer-parity-proof.mjs --base http://127.0.0.1:4400 [--size 512] [--engine chromium|webkit]
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { parseArgs } from 'node:util';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, size: { type: 'string', default: '512' },
  layers: { type: 'string', default: 'flag:a,flag2:a,stone,panel,concrete,tiles,lacquer,wood,poster:a' }, engine: { type: 'string', default: 'chromium' } } });
if (values.base === undefined) { console.error('usage: layer-parity-proof.mjs --base <url> [--size 512] [--layers name[:a],…]'); process.exit(2); }
const root = new URL('../..', import.meta.url);
const source = (/** @type {string} */ path) => readFileSync(new URL(path, root), 'utf8');
// the worker module as it ships, without its boot-timing import (a page-relative module it cannot resolve from a blob)
const worker = stripTypeScriptTypes(source('src/client/engine/boot/imageDecode.worker.ts')
  .replace(/^import .*$/mu, '').replace(/^installWorkerBootTiming\(.*\);$/mu, ''));
// the page's read-back as worldSceneTextures.ts has it
const page = /function pixels\(image: ImageBitmap, size: number\): Uint8ClampedArray \{[\s\S]*?\n\}/u.exec(source('src/client/game/shardfile/worldSceneTextures.ts'))?.[0];
if (page === undefined) throw new Error('worldSceneTextures.ts pixels() not found');
const pixels = stripTypeScriptTypes(page);
const base = values.base.replace(/\/$/u, ''), size = Number(values.size);
const layers = values.layers.split(',').map(row => { const [name = '', alpha] = row.split(':'); return { name, alpha: alpha === 'a' }; });

// WebKit too: the phone's engine, where the page's own decode may finish on its main thread
const browser = values.engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS] });
try {
  const tab = await (await browser.newContext()).newPage();
  await tab.goto(`${base}/version.json`);
  // the page path's own source, as a script of the page (its `pixels` on window)
  await tab.addScriptTag({ content: pixels });
  const result = await tab.evaluate(async input => {
    const edge = input.size;
    const read = async (/** @type {string} */ url) => { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.blob(); };
    const pagePixels = /** @type {(image: ImageBitmap, edge: number) => Uint8ClampedArray} */ (Reflect.get(window, 'pixels'));
    const decoder = new Worker(URL.createObjectURL(new Blob([input.worker], { type: 'text/javascript' })), { type: 'module' });
    let id = 0;
    const viaWorker = (/** @type {Blob} */ rgb, /** @type {Blob | null} */ alpha) => new Promise((resolve, reject) => {
      const ask = ++id;
      const answer = (/** @type {MessageEvent} */ event) => { if (event.data.id !== ask) return; decoder.removeEventListener('message', answer);
        if (event.data.texels instanceof Uint8ClampedArray) resolve(event.data.texels); else reject(new Error(String(event.data.error))); };
      decoder.addEventListener('message', answer);
      decoder.postMessage({ id: ask, layer: { rgb, alpha, size: edge } }, []);
    });
    const rows = [];
    for (const layer of input.layers) {
      const rgb = await read(`${input.base}/assets/nine-dragon/paint/${layer.name}.phone.webp`), alpha = layer.alpha ? await read(`${input.base}/assets/nine-dragon/paint/${layer.name}-a.phone.webp`) : null;
      const colour = await createImageBitmap(rgb), cover = alpha === null ? null : await createImageBitmap(alpha);
      const expected = pagePixels(colour, edge), mask = cover === null ? null : pagePixels(cover, edge);
      for (let k = 0; k < edge * edge; k++) expected[k * 4 + 3] = mask === null ? 128 : mask[k * 4] ?? 128;
      const actual = /** @type {Uint8ClampedArray} */ (await viaWorker(rgb, alpha));
      let differ = 0, worst = 0;
      for (let k = 0; k < expected.length; k++) { const d = Math.abs((expected[k] ?? 0) - (actual[k] ?? 0)); if (d > 0) differ++; worst = Math.max(worst, d); }
      rows.push({ layer: layer.name, alpha: layer.alpha, bytes: actual.length, differ, worst });
    }
    decoder.terminate();
    return rows;
  }, { worker, pixels, base, size, layers });
  let failed = false;
  for (const row of result) {
    failed ||= row.differ !== 0 || row.bytes !== size * size * 4;
    console.log(`${row.differ === 0 ? 'same' : 'DIFFERS'} ${row.layer}${row.alpha ? ' (+alpha)' : ''}: ${row.bytes} bytes, ${row.differ} differ (worst ${row.worst})`);
  }
  console.log(failed ? 'layer parity: FAIL' : `layer parity: ${result.length} layers byte-identical`);
  process.exitCode = failed ? 1 : 0;
} finally { await browser.close(); }
