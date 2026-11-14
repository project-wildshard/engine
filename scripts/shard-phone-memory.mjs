// G595 E2: phone-tier memory of one shard standalone at its spawn (the GLSL -> look-graph port is measured with it).
// Chromium as iPhone 16 Pro, phone tier, 2x render, muted. Samples three times 10 s apart after a 20 s settle: fps
// over 4 s, JS heap, renderer + GPU process footprint (libproc phys_footprint), three.js memory counts.
//   scripts/browser-lane.sh --max 10 node scripts/shard-phone-memory.mjs <preview url> <shard> <label> <out.json>
// Heap: <preview URL> --heap templates <label> <out.json> [--rebase] (clean diagnostic only).
// --floor samples at 10/60/120 s without forced GC, then diagnoses HTTP-cache retention.
// It also accepts menu or select as the target, with the real Developer prefetch on.
// Use core --floor --pin=<sha> for all four independent milestone floors.
// A single --floor --compiled --pin=<sha> target uses the same explicit compiled-entry contract.
// Offline C6: node scripts/shard-phone-memory.mjs audit-estimate <floor> <estimated-bytes> < <native-summary.json>
// Prints the fixed +/-15% model audit and independent G682 verdict; never re-bases either.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { devices } from 'playwright';
import * as v from 'valibot';
import { launchMemoryBrowser } from './chromium-memory-browser.mjs';
import { saveFixture } from './debug-settings.mjs';
import { chromiumProcessPeaks, chromiumAllocatorBytes } from './grid-ready-memory.mjs';
import { loadingCardIndex } from './loading-benchmark/catalogue.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';

/** G682: fixed 2026-10-24 hello-world 120s Simulator WebContent+GPU floor.
 * Same native reader: 87,397,464 + 15,927,456 bytes; no forced GC or app scripts.
 * This calibration is pinned, never automatically re-based when memory grows. */
export const webKitCoreMemoryFloorBytes = 103324920;
/** Menu/select retain G682. Templates use the picked 18d3c27d7a native pair. */
export const coreMemoryTargets = Object.freeze([
  Object.freeze({shard: 'menu', name: 'Menu', limitBytes: webKitCoreMemoryFloorBytes + 50 * 1048576}),
  Object.freeze({shard: 'select', name: 'SHARD SELECT', limitBytes: webKitCoreMemoryFloorBytes + 50 * 1048576}),
  Object.freeze({shard: '_template', name: 'Template 1', limitBytes: 274_538_200}),
  Object.freeze({shard: 'blender-template', name: 'Template 2', limitBytes: 261_512_872}),
]);
/** G682 calibration is a separate visit, never a fifth app floor or a budget gate. */
export const helloWorldMemoryTarget = Object.freeze({shard: 'hello', name: 'Hello, world', limitBytes: null});
/** Context-only diagnostic, never an app target or a replacement G682 base. */
export const webGLMemoryTarget = Object.freeze({shard: 'webgl', name: 'WebGL context', limitBytes: null});
/** Three.js code plus an empty renderer, without app/composer/content allocations. */
export const threeMemoryTarget = Object.freeze({shard: 'three', name: 'Three.js renderer', limitBytes: null});
/** No app, script, canvas, font, style or external asset is loaded by the calibration page. */
export const helloWorldMemoryHTML = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hello, world</title><body>Hello, world.</body></html>';
/** One WebGL2 context and one clear at 2x viewport pixels; no app or external assets. */
export const webGLMemoryHTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WebGL context</title><style>html,body{margin:0;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><body><canvas></canvas><script>
(() => {
  const canvas=document.querySelector('canvas');
  canvas.width=Math.round(innerWidth*2);canvas.height=Math.round(innerHeight*2);
  const state=window.__ws_coreWebGL={ready:false,contexts:0,clears:0,losses:0,viewportWidth:innerWidth,viewportHeight:innerHeight};
  canvas.addEventListener('webglcontextlost',()=>{state.losses++;});
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:true,stencil:false,preserveDrawingBuffer:false});
  if(gl===null){state.error='WebGL2 unavailable';return;}
  window.__ws_coreContext=gl;state.contexts++;
  gl.clearColor(0.1,0.1,0.1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);state.clears++;
  state.ready=gl.getError()===gl.NO_ERROR;
})();</script></body></html>`;
/** Same context attributes and clear as the raw WebGL fixture; no render loop or scene. */
export const threeMemoryHTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Three.js renderer</title><style>html,body{margin:0;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><body><canvas></canvas><script type="module">
import {WebGLRenderer,REVISION} from '/three.module.js';
const canvas=document.querySelector('canvas');
const state=window.__ws_coreThree={ready:false,contexts:0,clears:0,losses:0,viewportWidth:innerWidth,viewportHeight:innerHeight,revision:REVISION};
canvas.addEventListener('webglcontextlost',()=>{state.losses++;});
try {
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:true,stencil:false,preserveDrawingBuffer:false});
 if(gl===null)throw Error('WebGL2 unavailable');
 const renderer=window.__ws_coreRenderer=new WebGLRenderer({canvas,context:gl,alpha:false,antialias:false,depth:true,stencil:false,preserveDrawingBuffer:false});
 state.contexts++;
 renderer.setPixelRatio(2);renderer.setSize(innerWidth,innerHeight,false);
 gl.clearColor(0.1,0.1,0.1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);state.clears++;
 state.ready=gl.getError()===gl.NO_ERROR;
}catch(error){state.error=String(error);}
</script></body></html>`;
/** One loopback fixture owned by the official reader; no app preview/build is needed.
 * @param {boolean} [three] Serve only the two installed Three.js modules when explicitly requested.
 * @returns {Promise<{url: string, modules: {path: string, bytes: number, sha256: string}[], close: () => Promise<void>}>} */
export async function serveHelloWorldMemory(three = false) {
  const modules = new Map(three ? ['three.module.js', 'three.core.js'].map(name =>
    [`/${name}`, readFileSync(new URL(`../node_modules/three/build/${name}`, import.meta.url))]) : []);
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/' || path === '/webgl') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(path === '/' ? helloWorldMemoryHTML : webGLMemoryHTML); }
    else if (three && path === '/three') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(threeMemoryHTML); }
    else if (modules.has(path)) { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(modules.get(path)); }
    else if (path === '/version.json' || path === '/clear-cache.json') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({build: three ? 'webkit-three-renderer-v1' : 'webkit-hello-world-v1'}));
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') { server.close(); throw new Error('Missing hello-world fixture address'); }
  return {url: `http://127.0.0.1:${address.port}`, modules: [...modules].map(([path, bytes]) =>
    ({path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')})), close: async () => {
    await new Promise((resolve, reject) => {
      /** @param {Error} [error] */
      const done = error => { if (error === undefined) resolve(); else reject(error); };
      server.close(done);
    });
  }};
}
/** Select existing floors; the Template pair preserves original objects/order.
 * @param {string} selection */
export function selectedCoreMemoryTargets(selection) {
  if (selection === 'all') return coreMemoryTargets;
  if (selection === 'hello') return [helloWorldMemoryTarget];
  if (selection === 'webgl') return [webGLMemoryTarget];
  if (selection === 'three') return [threeMemoryTarget];
  if (selection === 'contexts') return [helloWorldMemoryTarget, webGLMemoryTarget];
  if (selection === 'templates') return coreMemoryTargets.slice(2);
  const target = coreMemoryTargets.find(row => row.shard === selection);
  if (target === undefined) throw new Error('Expected --core-memory=all, templates, contexts, hello, webgl, three or an existing core floor');
  return [target];
}
/** Scalar inventory only: no response bodies or Network-domain changes.
 * @param {readonly {name: string}[]} [entries] */
export function scriptResourceURLs(entries = performance.getEntriesByType('resource')) {
  return [...new Set(entries.filter(row => /\.m?js$/iu.test(new URL(row.name).pathname)).map(row => row.name))];
}

/** Post-acceptance provenance only: never fetch through the measured page or
 * change a native verdict when metadata is unavailable. This records the index
 * served alongside the reading, not a census of the page's resident content.
 * @param {string} base
 * @param {string} shard
 * @param {string} version Original page version JSON.
 * @param {typeof fetch} [read]
 */
export async function coreMemoryFolderIdentity(base, shard, version, read = fetch) {
  if (shard !== '_template' && shard !== 'blender-template') return null;
  try {
    const buildSchema = v.object({build: v.pipe(v.string(), v.minLength(1))});
    const expected = v.parse(buildSchema, JSON.parse(version)).build;
    // One deadline covers both version checks and the bounded index stream.
    const signal = AbortSignal.timeout(5000);
    /** @param {string} path @param {number} cap */
    const wire = async (path, cap) => {
      const response = await read(new URL(path, base), {signal, cache: 'no-store', redirect: 'error'});
      if (!response.ok || response.body === null) throw new Error('Core product metadata unavailable');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > cap)) throw new Error('Core product metadata exceeds cap');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) {
          const row = await reader.read(); if (row.done) break;
          size += row.value.length;
          if (size > cap) throw new Error('Core product metadata exceeds cap');
          chunks.push(row.value);
        }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
      return bytes;
    };
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const before = v.parse(buildSchema, JSON.parse(decoder.decode(await wire('/version.json', 65536))));
    if (before.build !== expected) throw new Error('Core product metadata build changed');
    // The first floor's directory is `_template`; its defining product uses
    // the canonical authored identity `template` (generators/product.ts).
    const folderSlug = shard === '_template' ? 'template' : shard;
    const path = `/shardfiles/${shard}/shard.json`, bytes = await wire(path, 1048576);
    // Identify the wire envelope only. Admission remains with the production
    // validator; no blob or section bodies enter this diagnostic.
    const index = v.parse(v.object({format: v.literal('wildshard.shardfile'), formatVersion: v.literal(2),
      identity: v.object({slug: v.literal(folderSlug)}),
      build: v.object({sourceHash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))})}), JSON.parse(decoder.decode(bytes)));
    const after = v.parse(buildSchema, JSON.parse(decoder.decode(await wire('/version.json', 65536))));
    if (after.build !== expected) throw new Error('Core product metadata build changed');
    return {status: 'observed', phase: 'after-120s', build: expected, shard, path, indexBytes: bytes.length,
      indexHash: createHash('sha256').update(bytes).digest('hex'), sourceHash: index.build.sourceHash};
  } catch (error) {
    return {status: 'unavailable', phase: 'after-120s', error: String(error).slice(0, 400)};
  }
}
const footprintBytes = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const floorRows = v.array(v.object({shard: v.string(), errors: v.array(v.string()),
  samples: v.array(v.object({phase: v.string(), rendererBytes: footprintBytes, gpuBytes: footprintBytes}))}));

/** Admit only the complete original cold, unforced 10/60/120s calibration.
 * The selected 120s total is pinned by G682, never automatically re-based on growth.
 * @param {unknown} input */
export function helloWorldMemoryFloor(input) {
  const row = v.parse(v.object({shard: v.literal('hello'), protocol: v.literal('webkit-core-floor/1'),
    mode: v.literal('cold'), forcedGC: v.literal(false), inspectorResponseBodyBytes: v.literal(0),
    scriptURLs: v.pipe(v.array(v.string()), v.maxLength(0)),
    calibrationDocument: v.object({title: v.literal('Hello, world'), text: v.literal('Hello, world.'), scripts: v.literal(0), canvases: v.literal(0)}),
    errors: v.array(v.string()), samples: v.array(v.object({phase: v.string(), rendererBytes: footprintBytes, gpuBytes: footprintBytes}))}), input);
  if (row.errors.length > 0 || row.samples.map(sample => sample.phase).join(',') !== '10s,60s,120s') throw new Error('Incomplete hello-world calibration');
  const sample = row.samples.at(2);
  if (sample === undefined) throw new Error('Missing hello-world 120s sample');
  const totalBytes = v.parse(footprintBytes, sample.rendererBytes + sample.gpuBytes);
  return {phase: '120s', rendererBytes: sample.rendererBytes, gpuBytes: sample.gpuBytes, totalBytes,
    menuLimitBytes: totalBytes + 50 * 1048576, templateLimitBytes: totalBytes + 100 * 1048576};
}

/** Context floor has no pass threshold and never changes G682. Admit only its
 * single-context, uncollected native witness at the original three clocks.
 * @param {unknown} input */
export function webGLMemoryFloor(input) {
  const dimension = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(8192));
  const row = v.parse(v.object({shard: v.literal('webgl'), protocol: v.literal('webkit-core-floor/1'),
    mode: v.literal('cold'), forcedGC: v.literal(false), inspectorResponseBodyBytes: v.literal(0),
    scriptURLs: v.pipe(v.array(v.string()), v.maxLength(0)),
    calibrationDocument: v.object({title: v.literal('WebGL context'), scripts: v.literal(1), canvases: v.literal(1),
      ready: v.literal(true), contexts: v.literal(1), clears: v.literal(1), losses: v.literal(0), lost: v.literal(false),
      width: dimension, height: dimension, viewportWidth: dimension, viewportHeight: dimension,
      attributes: v.object({alpha: v.literal(false), antialias: v.literal(false), depth: v.literal(true), stencil: v.literal(false), preserveDrawingBuffer: v.literal(false)})}),
    errors: v.array(v.string()), samples: v.array(v.object({phase: v.string(), rendererBytes: footprintBytes, gpuBytes: footprintBytes,
      page: v.object({prefetch: v.literal(null), resources: v.literal(0)})}))}), input);
  const doc = row.calibrationDocument;
  if (doc.width !== doc.viewportWidth * 2 || doc.height !== doc.viewportHeight * 2) throw new Error('WebGL calibration requires 2x viewport pixels');
  if (row.errors.length > 0 || row.samples.map(sample => sample.phase).join(',') !== '10s,60s,120s') throw new Error('Incomplete WebGL calibration');
  const sample = row.samples.at(2);
  if (sample === undefined) throw new Error('Missing WebGL 120s sample');
  return {phase: '120s', rendererBytes: sample.rendererBytes, gpuBytes: sample.gpuBytes,
    totalBytes: v.parse(footprintBytes, sample.rendererBytes + sample.gpuBytes)};
}

/** Empty Three.js renderer only; this attribution diagnostic has no budget and
 * cannot replace the pinned hello-world calibration or qualify an app floor.
 * @param {unknown} input */
export function threeMemoryFloor(input) {
  const dimension = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(8192));
  const row = v.parse(v.object({shard: v.literal('three'), protocol: v.literal('webkit-core-floor/1'),
    mode: v.literal('cold'), forcedGC: v.literal(false), inspectorResponseBodyBytes: v.literal(0),
    scriptURLs: v.pipe(v.array(v.string()), v.length(2)),
    fixtureModules: v.pipe(v.array(v.object({path: v.string(), bytes: v.pipe(footprintBytes, v.minValue(1)),
      sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))})), v.length(2)),
    calibrationDocument: v.object({title: v.literal('Three.js renderer'), scripts: v.literal(1), canvases: v.literal(1),
      ready: v.literal(true), contexts: v.literal(1), clears: v.literal(1), losses: v.literal(0), lost: v.literal(false),
      revision: v.pipe(v.string(), v.regex(/^\d+$/u)),
      rendererInfo: v.object({geometries: v.literal(0), textures: v.literal(0), programs: v.literal(0), calls: v.literal(0)}),
      width: dimension, height: dimension, viewportWidth: dimension, viewportHeight: dimension,
      attributes: v.object({alpha: v.literal(false), antialias: v.literal(false), depth: v.literal(true), stencil: v.literal(false), preserveDrawingBuffer: v.literal(false)})}),
    errors: v.array(v.string()), samples: v.array(v.object({phase: v.string(), rendererBytes: footprintBytes, gpuBytes: footprintBytes,
      page: v.object({href: v.string(), prefetch: v.literal(null), resources: v.literal(2)})}))}), input);
  const paths = ['/three.core.js', '/three.module.js'];
  if (row.fixtureModules.map(module => module.path).sort().join(',') !== paths.join(',')) throw new Error('Unexpected Three.js fixture modules');
  const scripts = row.scriptURLs.map(url => new URL(url));
  const origin = scripts[0]?.origin;
  if (scripts.some(url => url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.search !== '' || url.hash !== '')
    || scripts.map(url => url.pathname).sort().join(',') !== paths.join(',')) throw new Error('Unexpected Three.js script closure');
  const doc = row.calibrationDocument;
  if (doc.width !== doc.viewportWidth * 2 || doc.height !== doc.viewportHeight * 2) throw new Error('Three.js calibration requires 2x viewport pixels');
  if (row.errors.length > 0 || row.samples.map(sample => sample.phase).join(',') !== '10s,60s,120s') throw new Error('Incomplete Three.js calibration');
  for (const sample of row.samples) if (sample.page.href !== `${origin}/three`) throw new Error('Foreign Three.js fixture page');
  const sample = row.samples.at(2);
  if (sample === undefined) throw new Error('Missing Three.js 120s sample');
  return {phase: '120s', rendererBytes: sample.rendererBytes, gpuBytes: sample.gpuBytes,
    totalBytes: v.parse(footprintBytes, sample.rendererBytes + sample.gpuBytes)};
}

/** Keep completed raw captures reportable when strict diagnostic admission
 * refuses. The reader writes the summary, reports the error and exits nonzero.
 * @param {unknown} input */
export function contextMemoryDiagnostic(input) {
  try {
    const {shard} = v.parse(v.object({shard: v.picklist(['hello', 'webgl', 'three'])}), input);
    const sample = shard === 'hello' ? helloWorldMemoryFloor(input) : shard === 'three' ? threeMemoryFloor(input) : webGLMemoryFloor(input);
    return {calibration: {shard, phase: sample.phase, rendererBytes: sample.rendererBytes, gpuBytes: sample.gpuBytes, totalBytes: sample.totalBytes}, error: null};
  } catch (error) {
    return {calibration: null, error: String(error).slice(0, 400)};
  }
}

/** Read only the original 120-second floor, never the cache-clear diagnostic.
 * Zero WebContent is unavailable evidence, even when a GPU reading exists.
 * @param {unknown} input
 * @param {string} [selection] One app floor, the Template pair, or all four by default. */
function coreFloorTotals(input, selection = 'all') {
  const targets = selection === 'templates' ? coreMemoryTargets.slice(2)
    : coreMemoryTargets.filter(target => selection === 'all' || target.shard === selection);
  if (targets.length === 0) throw new Error('Unknown app core memory floor');
  const rows = v.parse(floorRows, input);
  if (new Set(rows.map(row => row.shard)).size !== rows.length || rows.some(row => !targets.some(target => target.shard === row.shard))) throw new Error('Duplicate or unknown core memory floor');
  return targets.map(target => {
    const row = rows.find(value => value.shard === target.shard), samples = row?.samples.filter(sample => sample.phase === '120s') ?? [];
    if (samples.length > 1) throw new Error(`Duplicate 120s floor: ${target.shard}`);
    const sample = samples[0], totalBytes = sample === undefined || sample.rendererBytes === 0 || row?.errors.length !== 0 ? null : sample.rendererBytes + sample.gpuBytes;
    return {shard: target.shard, name: target.name, limitBytes: target.limitBytes, totalBytes};
  });
}

/** G682 applies only to the cold, uncollected native WebKit reader.
 * Missing/failed floors stay unknown and fail; Chromium is not phone RAM.
 * @param {unknown} input
 * @param {string} [selection] One app floor, the Template pair, or all four by default. */
export function coreMemorySummary(input, selection = 'all') {
  const totals = coreFloorTotals(input, selection);
  v.parse(v.array(v.object({protocol: v.literal('webkit-core-floor/1'), mode: v.literal('cold'),
    forcedGC: v.literal(false), inspectorResponseBodyBytes: v.literal(0)})), input);
  return totals.map(({shard, name, limitBytes, totalBytes}) => ({shard, name, limitBytes, totalBytes,
    passed: totalBytes !== null && totalBytes <= limitBytes}));
}

/** Audit an explicit model prediction against an original native floor.
 * The 15% comparison uses exact byte arithmetic; display rounding cannot pass
 * a boundary miss. Model accuracy never changes the independent G682 verdict.
 * @param {unknown} input
 * @param {string} selection
 * @param {number} estimate */
export function coreMemoryEstimateAudit(input, selection, estimate) {
  const estimatedBytes = v.parse(v.pipe(footprintBytes, v.minValue(1)), estimate);
  const row = coreMemorySummary(input).find(floor => floor.shard === selection);
  if (row === undefined) throw new Error('Unknown app core memory floor');
  const measuredBytes = row.totalBytes === null ? null : v.parse(footprintBytes, row.totalBytes);
  const known = measuredBytes !== null && measuredBytes > 0;
  const difference = known ? BigInt(estimatedBytes) - BigInt(measuredBytes) : null;
  const absolute = difference === null ? null : difference < 0n ? -difference : difference;
  return {shard: row.shard, estimatedBytes, measuredBytes, budgetPassed: row.passed,
    errorPercent: known ? (estimatedBytes / measuredBytes - 1) * 100 : null,
    within15Percent: absolute === null || !known ? null : absolute * 100n <= BigInt(measuredBytes) * 15n};
}

/** Chromium diagnostics report totals without qualifying a WebKit budget.
 * @param {unknown} input */
export function chromiumCoreMemorySummary(input) {
  const totals = coreFloorTotals(input);
  v.parse(v.array(v.object({protocol: v.literal('chromium-phone-core/1')})), input);
  return totals.map(({shard, name, totalBytes}) => ({shard, name, totalBytes}));
}

const processRows = v.array(v.object({pid: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  startAbstime: v.pipe(v.number(), v.safeInteger(), v.minValue(1)), physicalFootprintBytes: v.pipe(footprintBytes, v.minValue(1))}));
/** Validate every native identity and positive footprint, before summing.
 * An absent GPU process is distinct from a present but unreadable one.
 * @param {unknown} input */
export function simulatorCoreFootprint(input) {
  const row = v.parse(v.object({webContent: processRows, gpu: processRows}), input);
  const processes = [...row.webContent, ...row.gpu];
  if (row.webContent.length === 0 || new Set(processes.map(process => process.pid)).size !== processes.length) throw new Error('Missing or duplicate Simulator memory process');
  return {...row, rendererBytes: row.webContent.reduce((sum, process) => sum + process.physicalFootprintBytes, 0),
    gpuBytes: row.gpu.reduce((sum, process) => sum + process.physicalFootprintBytes, 0)};
}

/** Same libproc reader as the Simulator watchdog, with no interval reset or GC.
 * Caller owns sim-lane; process ancestry confines this to its Simulator.
 * @param {string} device */
export function readSimulatorCoreFootprint(device) {
  const native = spawnSync('python3', ['-c', String.raw`
import json,runpy,sys
tool=runpy.run_path('scripts/ios-memory-watchdog.py')
manager=int(tool['command'](['xcrun','simctl','spawn',sys.argv[1],'launchctl','managerpid']))
native=tool['NativeMemory']()
def readings(name):
    return [native.sample(pid) for pid in sorted(tool['simulator_processes'](manager,name))]
print(json.dumps({'webContent':readings('com.apple.WebKit.WebContent'),'gpu':readings('com.apple.WebKit.GPU')}))
`, device], {cwd: resolvePath(import.meta.dirname, '..'), encoding: 'utf8'});
  if (native.status !== 0) throw new Error(`Simulator native footprint failed: ${native.stderr.trim()}`);
  return simulatorCoreFootprint(JSON.parse(native.stdout));
}
const PY = String.raw`
import ctypes, json, sys
class R(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(n, ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime')]
lib = ctypes.CDLL('/usr/lib/libproc.dylib'); out = {}
for p in sys.argv[1:]:
    u = R()
    out[p] = u.phys_footprint if lib.proc_pid_rusage(int(p), 0, ctypes.byref(u)) == 0 else None
print(json.dumps(out))
`;
async function footprint(session) {
  const info = await session.send('SystemInfo.getProcessInfo');
  const pids = info.processInfo.filter(row => row.type === 'renderer' || row.type === 'GPU');
  const measured = spawnSync('python3', ['-c', PY, ...pids.map(row => String(row.id))], { encoding: 'utf8' });
  if (measured.status !== 0) throw new Error('Process footprint reader failed');
  const sizes = JSON.parse(measured.stdout);
  if (pids.some(row => !Number.isSafeInteger(sizes[String(row.id)]))) throw new Error('Missing process footprint');
  const bytes = type => pids.filter(row => row.type === type).reduce((sum, row) => sum + sizes[String(row.id)], 0);
  return { rendererBytes: bytes('renderer'), gpuBytes: bytes('GPU') };
}
async function memoryDump(session, phase) {
  const events = [], collect = event => { events.push(...event.value); };
  session.on('Tracing.dataCollected', collect);
  try {
    await session.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } } });
    const dump = await session.send('Tracing.requestMemoryDump', { levelOfDetail: 'detailed', deterministic: false });
    const ended = new Promise(resolve => { session.once('Tracing.tracingComplete', resolve); });
    await session.send('Tracing.end'); await ended;
    if (!dump.success) throw new Error('Memory dump refused');
    return { phase, at: Date.now(), process: chromiumProcessPeaks(events), allocators: chromiumAllocatorBytes(events) };
  } finally { session.off('Tracing.dataCollected', collect); }
}
async function floors(page, context, browser, result) {
  const session = await browser.newBrowserCDPSession(), cdp = await context.newCDPSession(page), started = Date.now();
  const sample = async phase => {
    const heap = await cdp.send('Runtime.getHeapUsage');
    return { phase, elapsedMs: Date.now() - started, ...await footprint(session), heap,
      workers: page.workers().map(worker => worker.url()),
      page: await page.evaluate(() => ({ prefetch: window.__ws_gridPrefetch?.() ?? null,
        resources: performance.getEntriesByType('resource').length, href: location.href })),
      scriptURLs: await page.evaluate(scriptResourceURLs) };
  };
  for (const second of [10, 60, 120]) {
    await page.waitForTimeout(Math.max(0, second * 1000 - (Date.now() - started)));
    result.samples.push(await sample(`${second}s`));
  }
  // Original scalar owner ledger, after acceptance; never resource getters or GC.
  result.attribution = await page.evaluate(`(() => {const api=window.__wildshard;return ${pageMemoryAttributionExpression};})()`);
  result.memoryDumps = [await memoryDump(session, '120s-unmodified')];
  // Diagnostic only, AFTER the acceptance samples. CacheStorage stays intact.
  await cdp.send('Network.clearBrowserCache'); await page.waitForTimeout(5000);
  result.afterHttpCacheClear = await sample('after-http-cache-clear');
  result.memoryDumps.push(await memoryDump(session, 'after-http-cache-clear'));
}

async function measureTarget(base, shard, label, out, pin, floor, requireCompiled = false) {
const title = shard === 'menu' || shard === 'select';
const memoryBrowser = await launchMemoryBrowser(['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info']);
const {browser} = memoryBrowser;
const result = { label, shard, base, pin, floor, protocol: 'chromium-phone-core/1', compiledEntryRequired: requireCompiled && !title, inspectorResponseBodyBytes: 0, samples: [], errors: [] };
try {
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], serviceWorkers: floor ? 'block' : 'allow' });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', fps: 'auto', volume: 0 } });
  await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } });
  await context.addInitScript(() => { window.__wildshardHarness = { seed: 357, capture: null }; });
  await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
  const page = await context.newPage(); page.setDefaultTimeout(240000);
  page.on('pageerror', error => { result.errors.push(error.message); });
  if (floor) {
    await page.goto(`${base}?sw=0`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ws-main').waitFor({ state: 'visible' });
    if (shard !== 'menu') {
      await page.locator('.ws-main-select').click(); await page.locator('.ws-title-stack[data-screen="select"]').waitFor();
      if (shard !== 'select') {
        const titles = await page.locator('.ws-menu-card b').allTextContents(), selected = loadingCardIndex(titles, shard);
        await page.locator(`.ws-menu-dots i[data-i="${selected}"]`).click();
        await page.locator(`.ws-menu-card.selected[data-i="${selected}"]`).waitFor();
        // ENTER WORLD is the one entry and enters the compiled shardfile (QD7 LD5 removed LEGACY)
        const enter = page.locator('.ws-menu-play');
        if (requireCompiled && (!await enter.isVisible() || await enter.isDisabled())) throw new Error(`Missing compiled floor entry: ${shard}`);
        await enter.click();
        await page.waitForURL(url => url.searchParams.get('chunk') === shard);
      }
    }
  } else {
  await page.goto(`${base}?chunk=${shard}&mute=1&skipintro=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
  }
  if (!title) {
  await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)));
  const failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
  if (failure) throw new Error(failure);
  await page.evaluate(() => window.__wildshard.requireWorld().hud.enterNow());
  }
  if (floor) await floors(page, context, browser, result);
  else {
  await page.waitForTimeout(20000);
  for (let i = 0; i < 3; i++) {
    const fps = await page.evaluate(() => new Promise(resolve => {
      let frames = 0; const start = performance.now();
      const tick = () => { frames++; if (performance.now() - start < 4000) requestAnimationFrame(tick); else resolve(frames * 1000 / (performance.now() - start)); };
      requestAnimationFrame(tick);
    }));
    const page_ = await page.evaluate(() => { const g = window.__wildshard.requireWorld().game, r = g.renderer;
      return { heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), textures: r.info.memory.textures, geometries: r.info.memory.geometries,
        programs: r.info.programs?.length ?? null, calls: g.lastFrame.calls, renderScale: r.getPixelRatio(), tier: window.__wildshard.boot.tier }; });
    const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getProcessInfo');
    const pids = info.processInfo.filter(row => row.type === 'renderer' || row.type === 'GPU');
    const sizes = JSON.parse(spawnSync('python3', ['-c', PY, ...pids.map(row => String(row.id))], { encoding: 'utf8' }).stdout);
    const mb = type => Math.round(pids.filter(row => row.type === type).reduce((sum, row) => sum + (sizes[String(row.id)] ?? 0), 0) / 1048576);
    result.samples.push({ fps: Math.round(fps * 10) / 10, rendererMB: mb('renderer'), gpuMB: mb('GPU'), ...page_ });
    await page.waitForTimeout(10000);
  }
  }
  await page.screenshot({ path: out.replace(/\.json$/u, '.jpg'), type: 'jpeg', quality: 70 });
} catch (error) { result.errors.push(String(error)); }
finally { await memoryBrowser.close(); }
return result;
}

async function main() {
  if (process.argv[2] === 'heap-check') {
    const [report,limits]=process.argv.slice(3);
    if(!report||!limits||process.argv.length!==5)throw new Error('Expected heap-check <report.json> <ratchet.json>');
    const {checkHeapRatchet}=await import('./memory/jsHeap.mjs');
    const input=v.parse(v.object({readings:v.array(v.unknown())}),JSON.parse(readFileSync(report,'utf8')));
    const verdict=checkHeapRatchet(input.readings,JSON.parse(readFileSync(limits,'utf8')));
    console.info(JSON.stringify(verdict));if(!verdict.passed)process.exitCode=1;return;
  }
  if (process.argv[3] === '--heap') {
    const [base, , target, label, out, flag] = process.argv.slice(2);
    if (!base || !target || !label || !out?.endsWith('.json') || !['_template','blender-template','templates'].includes(target)
      || (flag !== undefined && flag !== '--rebase') || process.argv.length > 8)
      throw new Error('Expected <preview URL> --heap <_template|blender-template|templates> <label> <out.json> [--rebase]');
    const {measureCleanHeap} = await import('./memory/heapReader.mjs');
    const {checkHeapRatchet} = await import('./memory/jsHeap.mjs');
    const ratchetFile=new URL('memory/js-heap-ratchet.json',import.meta.url);
    const baseline=JSON.parse(readFileSync(ratchetFile,'utf8'));
    const targets=target==='templates'?['_template','blender-template']:[target];
    const readings=[];
    for(const shard of targets) {
      if(shard!=='_template'&&shard!=='blender-template')throw new Error('Unsupported heap target');
      const row=await measureCleanHeap(base,shard);readings.push(row);
      const m=row.metrics;
      console.info(`${shard}: boot ${(m.bootAllocatedBytes/1048576).toFixed(2)} MiB; settled post-GC ${(m.settledUsedBytes/1048576).toFixed(2)} MiB; idle ${(m.idleBytesPerSecond/1048576).toFixed(3)} MiB/s; major GC ${m.majorGCsPer30Seconds.toFixed(2)}/30s`);
    }
    if(new Set(readings.map(row=>row.build)).size!==1)throw new Error('Heap targets must share one served build');
    const verdict=checkHeapRatchet(readings,baseline,flag==='--rebase');
    writeFileSync(out,`${JSON.stringify({label,base,readings,verdict},null,2)}\n`);
    for(const failure of verdict.failures)console.error(failure);
    if(!verdict.passed)process.exitCode=1;
    else if(flag==='--rebase')writeFileSync(ratchetFile,`${JSON.stringify(verdict.ratchet,null,2)}\n`);
    return;
  }
  if (process.argv[2] === 'audit-estimate') {
    const [target, estimate] = process.argv.slice(3);
    if (process.argv.length !== 5 || target === undefined || estimate === undefined || !/^[0-9]+$/u.test(estimate)) throw new Error('Expected audit-estimate <floor> <estimated-bytes> with the native summary on stdin');
    const summary = v.parse(v.object({rev: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/u)), coreMemory: v.string(),
      results: v.array(v.looseObject({version: v.string()}))}), JSON.parse(readFileSync(0, 'utf8')));
    if (!selectedCoreMemoryTargets(summary.coreMemory).some(row => row.shard === target)) throw new Error('Native summary does not select the requested floor');
    for (const row of summary.results) {
      const version = v.parse(v.object({build: v.string()}), JSON.parse(row.version));
      if (!version.build.startsWith(`${summary.rev.slice(0, 7)}-`)) throw new Error('Native summary source pin differs from its reading');
    }
    coreMemorySummary(summary.results, summary.coreMemory);
    const audit = coreMemoryEstimateAudit(summary.results, target, Number(estimate));
    console.info(JSON.stringify({sourcePin: summary.rev, ...audit}));
    if (!audit.budgetPassed) process.exitCode = 1;
    return;
  }
  const [base, shard, label, out] = process.argv.slice(2), floor = process.argv.includes('--floor'), compiled = process.argv.includes('--compiled');
  const pin = process.argv.find(arg => arg.startsWith('--pin='))?.slice(6);
  if (!base || !shard || !label || !out || !out.endsWith('.json')) throw new Error('Expected <preview URL> <shard|menu|select|core> <label> <out.json>');
  if (['menu', 'select', 'core'].includes(shard) && !floor) throw new Error('Menu/core targets require --floor');
  if (shard === 'core' && pin === undefined) throw new Error('Core floors require --pin=<full-sha>');
  if (compiled && (!floor || pin === undefined || ['menu', 'select'].includes(shard))) throw new Error('Compiled floor requires a shard, --floor and --pin=<full-sha>');
  if (pin !== undefined) {
    if (!/^[a-f0-9]{40}$/u.test(pin)) throw new Error('Expected exact served source pin');
    const version = await (await fetch(new URL('/version.json', base))).json();
    if (!version.build?.startsWith(pin.slice(0, 7))) throw new Error('Served source differs from pin');
  }
  if (shard !== 'core') {
    const result = await measureTarget(base, shard, label, out, pin, floor, compiled);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
    if (result.errors.length > 0) process.exitCode = 1;
    return;
  }
  const result = {label, base, pin, protocol: 'chromium-phone-core/1', targets: [], summary: []};
  try {
    for (const target of coreMemoryTargets) {
      // A fresh browser (not just context) prevents the previous floor's GPU/
      // renderer processes and prefetch payloads from inflating the next floor.
      const row = await measureTarget(base, target.shard, label, out.replace(/\.json$/u, `-${target.shard}.json`), pin, true, true);
      result.targets.push(row);
      if (row.errors.length > 0) break;
    }
  } finally {
    result.summary = chromiumCoreMemorySummary(result.targets);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    for (const row of result.summary) console.log(`${row.name}: ${row.totalBytes === null ? 'UNKNOWN' : `${(row.totalBytes / 1048576).toFixed(1)} MiB`} (Chromium diagnostic; WebKit budget unqualified)`);
    if (result.summary.some(row => row.totalBytes === null)) process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) await main();
