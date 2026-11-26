// MIRROR-SALT-ZONE MSZ10: headless shots of what a second page draws of players seated in the vehicles example's buggy and
// land-sail (src/scripts/vehicle-seat-shots.entry.ts, the page's own OtherPlayers), at rest and driving at 15 m/s. It fails if a
// seated body ever shows a walk gait or holds an item.
//   src/scripts/browser-lane.sh --max 5 node src/scripts/vehicle-seat-shots.mjs --scratch=tmp/<lane>/seat-shots --out=<shots dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rolldown } from 'rolldown';
import { chromium } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';

const { values } = parseArgs({ options: { scratch: { type: 'string' }, out: { type: 'string' } } });
if (values.scratch === undefined || values.out === undefined) throw new Error('Use --scratch=<owned lane folder> --out=<shots folder>');
const scratch = resolve(values.scratch), out = resolve(values.out);
mkdirSync(scratch, { recursive: true }); mkdirSync(out, { recursive: true });
const bundle = join(scratch, 'bundle');
// Rapier's wasm-importing module goes to the plain bindings, as vite/rapier.ts aliases it for the app
const bindings = resolve('src/server/engine/physics/rapierBindings.ts');
const built = await rolldown({ input: 'src/scripts/vehicle-seat-shots.entry.ts', transform: { define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' } }, plugins: [{ name: 'rapier-bindings', resolveId: source => (/^\.\/rapier_wasm3d(\.js)?$/u.test(source) ? bindings : null) }] });
await built.write({ dir: bundle, format: 'es', entryFileNames: 'seat-shots.js' }); await built.close();

/** Each view: the eye and its aim, offsets from the buggy (it faces -z turned 0.35 rad; the sail stands off its right). */
const VIEWS = /** @type {const} */ ([
  ['1-front-quarter', [-3.2, 1.6, -5.5], [0, 1.1, 0]],
  ['2-driver-side', [-5.5, 1.6, 0.6], [0, 1.1, 0.3]],
  ['3-behind', [1.5, 1.8, 6.5], [0.6, 1.2, -1]],
  ['4-sail', [12.5, 2, 5], [7, 1.8, -2]],
]);
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 720 } })).newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message); console.log('page error', error.message); });
  page.on('console', line => { if (line.type() === 'error') console.log('page console', line.text().slice(0, 300)); });
  // the bundle's chunks, served from a made-up origin straight off the disk
  await page.route('http://seat.shots/**', async route => { const path = new URL(route.request().url()).pathname.slice(1); await route.fulfill(path === '' ? { contentType: 'text/html', body: '<!doctype html><script type="module" src="/seat-shots.js"></script>' } : { contentType: 'text/javascript', body: readFileSync(join(bundle, path)) }); });
  await page.goto('http://seat.shots/'); await page.waitForFunction(() => '__seatShots' in globalThis, undefined, { timeout: 60_000 });
  for (const [name, from, at] of VIEWS) { await page.evaluate(([f, a]) => { /** @type {any} */ (globalThis).__seatShots.view(f, a); }, [from, at]); await page.screenshot({ path: join(out, `${name}.png`) }); }
  await page.evaluate(() => { /** @type {any} */ (globalThis).__seatShots.drive(1); });
  const driving = /** @type {{ name: string, seated: string, gait: string, speed: number, item: string }[]} */ (await page.evaluate(() => /** @type {any} */ (globalThis).__seatShots.shown()));
  for (const [name, from, at] of VIEWS.slice(0, 2)) { await page.evaluate(([f, a]) => { /** @type {any} */ (globalThis).__seatShots.view(f, a); }, [from, at]); await page.screenshot({ path: join(out, `${name}-driving.png`) }); }
  console.log(JSON.stringify(driving));
  const walking = driving.filter(body => body.seated === '' || body.gait !== 'idle' || body.item !== '' || body.speed < 10);
  if (walking.length > 0 || errors.length > 0) { failed = true; console.log('FAIL', JSON.stringify({ walking, errors })); }
} finally { await browser.close(); }
console.log(failed ? 'FAIL' : 'PASS');
process.exitCode = failed ? 1 : 0;
