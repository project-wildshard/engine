#!/usr/bin/env node
// gpu-staircase.mjs, the GPU feature staircase (meta docs/plans/MEMORY-STRUCTURE-PLAN.md STR28). Each step opens
// gpu-staircase.html in a cold native WebKit at the phone view (402 x 874 @3, touch) with one GPU feature changed from
// the base (a phone-Low WebGL2 canvas cleared every frame), takes measure.mjs's settled reading [K] of WebContent and the
// GPU process, and splits the GPU process by `footprint -j` category. Steps run in rounds, the order flipped each round;
// a step's cost is the median over rounds of (step minus its reference step in the same round).
//
//   node src/scripts/memory/gpu-staircase.mjs [--rounds=3] [--steps=a,b] [--out=<file.json>] [--settle=2000]
//
// Wrap it in the desktop GPU lock (iphone/locks.mjs, MINI-DEVEX MD2):
// `lockf -k <engine>/tmp/desktop-gpu.lock lockf -k <engine>/tmp/mini-measure.lock src/scripts/browser-lane.sh node ...`.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { PHONE_VIEW, footprintCategories, minimiseInspector, settledReading, stats } from './measure.mjs';
import { MB, webkitProcesses } from './footprint.mjs';

export const PROTOCOL = 'gpu-staircase/1';

/** Every step: its query (one change from its reference) and the reference it is read against.
 * @type {readonly {id:string, group:string, query:string, ref:string}[]} */
export const STEPS = Object.freeze([
  // the canvas and its context
  { id: 'blank', group: 'canvas', query: 'canvas=0', ref: '' },
  { id: 'base', group: 'canvas', query: '', ref: 'blank' },
  { id: 'dpr2', group: 'canvas', query: 'dpr=2', ref: 'base' },
  { id: 'dpr3', group: 'canvas', query: 'dpr=3', ref: 'base' },
  { id: 'antialias', group: 'canvas', query: 'aa=1', ref: 'base' },
  { id: 'alpha0', group: 'canvas', query: 'alpha=0', ref: 'base' },
  { id: 'depth0', group: 'canvas', query: 'depth=0', ref: 'base' },
  { id: 'stencil', group: 'canvas', query: 'stencil=1', ref: 'base' },
  { id: 'preserve', group: 'canvas', query: 'pdb=1', ref: 'base' },
  { id: 'highperf', group: 'canvas', query: 'pp=high-performance', ref: 'base' },
  { id: 'desync', group: 'canvas', query: 'desync=1', ref: 'base' },
  // vertices per pass and live varyings (the tiler parameter buffer)
  { id: 'v250k-x8', group: 'vertex', query: 'verts=250000&vary=8', ref: 'base' },
  { id: 'v500k-x8', group: 'vertex', query: 'verts=500000&vary=8', ref: 'base' },
  { id: 'v1m-x8', group: 'vertex', query: 'verts=1000000&vary=8', ref: 'base' },
  { id: 'v2m-x8', group: 'vertex', query: 'verts=2000000&vary=8', ref: 'base' },
  { id: 'v1m-x0', group: 'vertex', query: 'verts=1000000&vary=0', ref: 'base' },
  { id: 'v1m-x2', group: 'vertex', query: 'verts=1000000&vary=2', ref: 'base' },
  { id: 'v1m-x4', group: 'vertex', query: 'verts=1000000&vary=4', ref: 'base' },
  { id: 'v1m-x14', group: 'vertex', query: 'verts=1000000&vary=14', ref: 'base' },
  { id: 'v1m-f14', group: 'vertex', query: 'verts=1000000&vary=14&vt=float', ref: 'base' },
  { id: 'v1m-x8-split2', group: 'vertex', query: 'verts=1000000&vary=8&split=2', ref: 'base' },
  { id: 'v1m-x8-split4', group: 'vertex', query: 'verts=1000000&vary=8&split=4', ref: 'base' },
  // render targets at the drawing buffer's size
  { id: 't3-rgba16f', group: 'targets', query: 'targets=3&fmt=rgba16f', ref: 'base' },
  { id: 't3-rgba8', group: 'targets', query: 'targets=3&fmt=rgba8', ref: 'base' },
  { id: 't3-r11g11b10f', group: 'targets', query: 'targets=3&fmt=r11f_g11f_b10f', ref: 'base' },
  { id: 't3-rgb10a2', group: 'targets', query: 'targets=3&fmt=rgb10_a2', ref: 'base' },
  { id: 't3-rgba16f-depth', group: 'targets', query: 'targets=3&fmt=rgba16f&tdepth=1', ref: 'base' },
  { id: 't3-rgba16f-dpr3', group: 'targets', query: 'targets=3&fmt=rgba16f&dpr=3', ref: 'dpr3' },
  // DOM layers over the canvas
  { id: 'layers1', group: 'layers', query: 'layers=1', ref: 'base' },
  { id: 'layers2', group: 'layers', query: 'layers=2', ref: 'base' },
  { id: 'layers4', group: 'layers', query: 'layers=4', ref: 'base' },
  { id: 'layers8', group: 'layers', query: 'layers=8', ref: 'base' },
  { id: 'layers4-hidden', group: 'layers', query: 'layers=4&ltype=hidden', ref: 'base' },
  { id: 'layers4-zero', group: 'layers', query: 'layers=4&ltype=zero', ref: 'base' },
  { id: 'layers4-plain', group: 'layers', query: 'layers=4&ltype=plain', ref: 'base' },
  { id: 'layers8-small', group: 'layers', query: 'layers=8&ltype=small', ref: 'base' },
]);

/** The GPU-process categories a step is split by (`graphics` is the two Metal-owned ones, as measure.mjs's closure). */
const CATEGORIES = Object.freeze({
  ioaccel: 'IOAccelerator (graphics)', unmappedGraphics: 'Owned physical footprint (unmapped) (graphics)',
  iosurface: 'IOSurface', unmapped: 'Owned physical footprint (unmapped)', malloc: 'Malloc Small',
});

/** One cold reading of one step. @param {string} url @param {{settleMs:number}} o */
async function readStep(url, { settleMs }) {
  const { webkit } = await import('../browser-playwright.mjs');
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...PHONE_VIEW });
    const page = await context.newPage(); page.setDefaultTimeout(60_000);
    await page.goto(url, { waitUntil: 'commit' });
    await minimiseInspector(page);
    await page.waitForFunction(() => Reflect.get(window, '__stair')?.done === true);
    const settled = await settledReading(page, webkitProcesses(), { settleMs, gcs: 2, reads: 5 });
    const procs = webkitProcesses();
    const cats = footprintCategories(procs).gpu;
    const got = await page.evaluate(() => Reflect.get(window, '__stair').got);
    /** @type {Record<string, number>} */ const gpuCats = {};
    for (const [k, name] of Object.entries(CATEGORIES)) gpuCats[k] = cats[name] ?? 0;
    return { webcontent: settled.webcontent, gpu: settled.gpu, gpuCats, got };
  } finally { await browser.close(); }
}

/** Per step: the median over rounds of the step minus its reference, per measure.
 * @param {readonly Record<string, {webcontent:number, gpu:number, gpuCats:Record<string, number>}>[]} rounds */
export function stepCosts(rounds, steps = STEPS) {
  return steps.filter((s) => rounds.every((r) => r[s.id])).map((s) => {
    const diff = (/** @type {(x: {webcontent:number, gpu:number, gpuCats:Record<string, number>}) => number} */ f) => {
      const d = rounds.map((r) => f(r[s.id]) - (s.ref ? f(r[s.ref]) : 0));
      const st = stats(d); return { median: st.median, min: Math.min(...d), max: Math.max(...d) };
    };
    /** @type {Record<string, {median:number, min:number, max:number}>} */ const cats = {};
    for (const k of Object.keys(CATEGORIES)) cats[k] = diff((x) => x.gpuCats[k] ?? 0);
    return { id: s.id, group: s.group, ref: s.ref, sum: diff((x) => x.webcontent + x.gpu), webcontent: diff((x) => x.webcontent), gpu: diff((x) => x.gpu), cats };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const rounds = Number(flag('rounds', '3')), settleMs = Number(flag('settle', '2000'));
  const only = flag('steps', '');
  const want = new Set(only ? only.split(',') : STEPS.map((s) => s.id));
  for (const s of STEPS) if (want.has(s.id) && s.ref) want.add(s.ref); // a step needs its reference in every round
  for (const s of STEPS) if (want.has(s.ref) && STEPS.find((x) => x.id === s.ref)?.ref) want.add(/** @type {string} */ (STEPS.find((x) => x.id === s.ref)?.ref));
  const steps = STEPS.filter((s) => want.has(s.id));
  const out = resolvePath(flag('out', 'tmp/gpu-staircase/staircase.json'));
  const page = readFileSync(new URL('gpu-staircase.html', import.meta.url));
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(page); });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  /** @type {Record<string, any>[]} */ const all = [];
  try {
    for (let r = 0; r < rounds; r++) {
      const order = r % 2 === 0 ? steps : [...steps].reverse();
      /** @type {Record<string, any>} */ const round = {};
      for (const s of order) {
        const reading = await readStep(`http://127.0.0.1:${port}/?${s.query}`, { settleMs });
        round[s.id] = reading;
        const errs = reading.got.errors?.length ? ` ERR ${reading.got.errors.join('; ')}` : '';
        console.log(`round ${r + 1} ${s.id.padEnd(18)} WC ${(reading.webcontent / MB).toFixed(1).padStart(7)} GPU ${(reading.gpu / MB).toFixed(1).padStart(7)} MB${errs}`);
      }
      all.push(round);
    }
  } finally { server.closeAllConnections(); server.close(); }
  const costs = stepCosts(all, steps);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ protocol: PROTOCOL, rounds: all, costs }, null, 1));
  const f = (/** @type {number} */ b) => (b / MB).toFixed(1).padStart(7);
  console.log('step               ref     sum[K]  (min..max)        WC     GPU  ioaccel unmapG  iosurf unmapped');
  for (const c of costs) console.log(`${c.id.padEnd(18)} ${c.ref.padEnd(6)} ${f(c.sum.median)} (${f(c.sum.min)}..${f(c.sum.max)}) ${f(c.webcontent.median)} ${f(c.gpu.median)} ${f(c.cats.ioaccel.median)} ${f(c.cats.unmappedGraphics.median)} ${f(c.cats.iosurface.median)} ${f(c.cats.unmapped.median)}`);
  console.log(`wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
