// FORMAT-PRUNE FP40 (J439 board): each legacy zone's far view with its G539 impostor and without it (the GLB alone, as
// a product ships it when the pair breaches the 1.6 MB far cap), the same camera from a neighbour's road at far-ring
// distances where the impostor has the whole band. Writes one PNG a shot and board.png (zones down, distance and
// impostor across). Headless and muted.
//   src/scripts/browser-lane.sh --max 5 node src/scripts/far-impostor-shots.mjs --scratch=tmp/<lane>/far-shots --out=<shots dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rolldown } from 'rolldown';
import { chromium } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';

const { values } = parseArgs({ options: { scratch: { type: 'string' }, out: { type: 'string' } } });
if (values.scratch === undefined || values.out === undefined) throw new Error('Use --scratch=<owned lane folder> --out=<shots folder>');
const scratch = resolve(values.scratch), out = resolve(values.out);
mkdirSync(scratch, { recursive: true }); mkdirSync(out, { recursive: true });
const bundle = join(scratch, 'bundle');
const bindings = resolve('src/server/engine/physics/rapierBindings.ts');
const built = await rolldown({ input: 'src/scripts/far-impostor-shots.entry.ts', transform: { define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' } }, plugins: [{ name: 'rapier-bindings', resolveId: source => (/^\.\/rapier_wasm3d(\.js)?$/u.test(source) ? bindings : null) }] });
await built.write({ dir: bundle, format: 'es', entryFileNames: 'far-shots.js' }); await built.close();
// G539's decode runs in its own module worker (`new URL('farImpostorDecodeWorker.ts', import.meta.url)`): bundled apart, served by that name
const worker = await rolldown({ input: 'src/client/game/grid/farImpostorDecodeWorker.ts', transform: { define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' } } });
await worker.write({ dir: bundle, format: 'es', entryFileNames: 'farImpostorDecodeWorker.ts' }); await worker.close();

const SLUGS = ['driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes'];
// metres past the cell's edge: where the impostor has the whole band (FAR_BANDS 2000 + 300) and the far ring's outer reach
const DISTANCES = [2300, 3500];
const SIZE = { width: 640, height: 360, fov: 40 };
const CROP = { x: 240, y: 150, width: 160, height: 60 };
const TYPES = { '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = /** @type {string[]} */ ([]), cells = /** @type {string[][]} */ ([]);
try {
  const page = await (await browser.newContext({ viewport: { width: SIZE.width, height: SIZE.height } })).newPage();
  page.on('pageerror', error => { errors.push(error.message); console.log('page error', error.message); });
  await page.route('http://far.shots/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module" src="/far-shots.js"></script>' });
    if (path.startsWith('assets/')) return route.fulfill({ contentType: TYPES[/** @type {keyof typeof TYPES} */ (extname(path))] ?? 'application/octet-stream', body: readFileSync(resolve('public', path)) });
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(bundle, path)) });
  });
  await page.goto('http://far.shots/'); await page.waitForFunction(() => '__farShots' in globalThis, undefined, { timeout: 60_000 });
  for (const slug of SLUGS) {
    const row = [];
    for (const distance of DISTANCES) for (const impostor of [true, false]) {
      const name = `${slug}-${String(distance)}m-${impostor ? 'impostor' : 'glb-only'}`;
      const read = await page.evaluate(v => /** @type {any} */ (globalThis).__farShots.view(v), { slug, impostor, distance, ...SIZE });
      if (impostor && !read.impostor) throw new Error(`${slug}: no impostor decoded`);
      await page.screenshot({ path: join(out, `${name}.png`) });
      // the same rendered pixels round the zone, for the board's ×4 crop (no telephoto: what the traveller's screen holds)
      await page.screenshot({ path: join(out, `${name}-crop.png`), clip: CROP });
      row.push(name);
      console.log(name, JSON.stringify(read));
    }
    cells.push(row);
  }
  // the board: one row a zone; columns 2.3 km with / without, 3.5 km with / without
  const heads = DISTANCES.flatMap(d => [`${String(d / 1000)} km, impostor (today)`, `${String(d / 1000)} km, GLB only (cap kept)`]);
  const img = /** @param {string} name */ name => `<img src="/${name}.png"><img class="crop" src="/${name}-crop.png">`;
  const html = `<!doctype html><style>body{margin:0;background:#111;color:#eee;font:15px system-ui}table{border-collapse:collapse}td,th{padding:4px}img{width:420px;display:block}img.crop{width:420px;height:158px;image-rendering:pixelated;margin-top:2px}th{text-align:left}</style>
<h2 style="margin:8px">FP40: legacy far views with and without the G539 impostor (J439: the 1.6 MB far cap)</h2><p style="margin:8px">Each cell: the traveller's frame (40° lens, on a neighbour's road), then the same pixels round the zone at ×4.</p>
<table><tr><th></th>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${cells.map((row, i) => `<tr><th>${SLUGS[i]}</th>${row.map(n => `<td>${img(n)}</td>`).join('')}</tr>`).join('')}</table>`;
  const board = await (await browser.newContext({ viewport: { width: 1900, height: 1200 } })).newPage();
  await board.route('http://far.board/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    return route.fulfill(path === '' ? { contentType: 'text/html', body: html } : { contentType: 'image/png', body: readFileSync(join(out, path)) });
  });
  await board.goto('http://far.board/'); await board.screenshot({ path: join(out, 'board.png'), fullPage: true });
} finally { await browser.close(); }
if (errors.length > 0) { console.error(errors.join('\n')); process.exitCode = 1; }
