// MIRROR-SALT-ZONE MSZ11: headless shots of the view from a vehicle's seat (src/scripts/vehicle-view-shots.entry.ts, the page's own
// `SeatEye`): the buggy's driver seat at rest and at the boosted top speed (desktop and a portrait phone), the land-sail's
// deck, and the chase view on open ground and against a wall. It fails if the boost does not widen the view by the curve's
// +14°, if the seat's eye is not at the seat's height, or if the chase view at the wall is not pulled in. MSZ14b adds a worn
// buggy's smoke and a wrecked one's break-apart (just after, and once it has settled); it fails if the worn buggy draws no
// plume, the wreck throws no chunks, or anything is still alive 4 s after the wreck.
//   src/scripts/browser-lane.sh --max 5 node src/scripts/vehicle-view-shots.mjs --scratch=tmp/<lane>/view-shots --out=<shots dir>
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
const built = await rolldown({ input: 'src/scripts/vehicle-view-shots.entry.ts', transform: { define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' } }, plugins: [{ name: 'rapier-bindings', resolveId: source => (/^\.\/rapier_wasm3d(\.js)?$/u.test(source) ? bindings : null) }] });
await built.write({ dir: bundle, format: 'es', entryFileNames: 'view-shots.js' }); await built.close();

const DESK = { width: 960, height: 720 }, PHONE = { width: 402, height: 874 };
/** Each shot: its name and the view (vehicle, where it stands, its speed, chase or seat). The buggy boosts to 30 m/s. */
const SHOTS = /** @type {const} */ ([
  ['1-seat-rest', { ...DESK, vehicle: 'buggy', z: 0, speed: 0, chase: false }],
  ['2-seat-boost', { ...DESK, vehicle: 'buggy', z: 0, speed: 30, chase: false }],
  ['3-seat-look-left', { ...DESK, vehicle: 'buggy', z: 0, speed: 0, chase: false, yaw: 1.1 }],
  ['4-sail-deck', { ...DESK, vehicle: 'sail', z: -3, speed: 12, chase: false }],
  ['5-chase', { ...DESK, vehicle: 'buggy', z: -40, speed: 20, chase: true }],
  ['6-chase-wall', { ...DESK, vehicle: 'buggy', z: 3, speed: 0, chase: true }],
  ['7-phone-seat-rest', { ...PHONE, vehicle: 'buggy', z: 0, speed: 0, chase: false }],
  ['8-phone-seat-boost', { ...PHONE, vehicle: 'buggy', z: 0, speed: 30, chase: false }],
]);
/** MSZ14b: the worn buggy after 3 s of smoke, the wreck 0.35 s and 1.2 s after it broke apart, and 4 s after (all settled). */
const WRECKS = /** @type {const} */ ([
  ['9-worn-smoke', { ...DESK, state: 'worn', seconds: 3 }],
  ['10-wreck-burst', { ...DESK, state: 'wrecked', seconds: 0.35 }],
  ['11-wreck-falling', { ...DESK, state: 'wrecked', seconds: 1.2 }],
  ['12-wreck-settled', { ...DESK, state: 'wrecked', seconds: 4 }],
  ['13-phone-worn-smoke', { ...PHONE, state: 'worn', seconds: 3 }],
]);
const wrecks = /** @type {Record<string, { puffs: number, chunks: number }>} */ ({});
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const read = /** @type {Record<string, { fov: number, zoom: number, widen: number, eye: number[] }>} */ ({}), errors = /** @type {string[]} */ ([]);
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 874 } })).newPage();
  page.on('pageerror', error => { errors.push(error.message); console.log('page error', error.message); });
  page.on('console', line => { if (line.type() === 'error') console.log('page console', line.text().slice(0, 300)); });
  await page.route('http://view.shots/**', async route => { const path = new URL(route.request().url()).pathname.slice(1); await route.fulfill(path === '' ? { contentType: 'text/html', body: '<!doctype html><script type="module" src="/view-shots.js"></script>' } : { contentType: 'text/javascript', body: readFileSync(join(bundle, path)) }); });
  await page.goto('http://view.shots/'); await page.waitForFunction(() => '__viewShots' in globalThis, undefined, { timeout: 60_000 });
  for (const [name, view] of SHOTS) {
    read[name] = await page.evaluate(v => /** @type {any} */ (globalThis).__viewShots.view(v), view);
    await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: 0, width: view.width, height: view.height } });
  }
  for (const [name, view] of WRECKS) {
    wrecks[name] = await page.evaluate(v => /** @type {any} */ (globalThis).__viewShots.wreck(v), view);
    await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 0, y: 0, width: view.width, height: view.height } });
  }
} finally { await browser.close(); }
console.log(JSON.stringify(read)); console.log(JSON.stringify(wrecks));
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ e) => Math.abs(a - b) <= e;
const fails = [
  ...errors,
  ...(near(read['1-seat-rest']?.fov ?? 0, 72, 0.1) ? [] : ['the seat at rest is not the base 72°']),
  ...(near(read['2-seat-boost']?.fov ?? 0, 86, 0.1) ? [] : ['the boosted seat is not 72° + 14°']),
  ...(near(read['1-seat-rest']?.eye[1] ?? 0, 0.9 + 0.88, 0.01) ? [] : ['the seat\'s eye is not at 1.78 m']),
  ...(near(read['4-sail-deck']?.eye[1] ?? 0, 0.83 + 1.6, 0.01) ? [] : ['the deck\'s eye is not at 2.43 m']),
  ...((read['6-chase-wall']?.eye[2] ?? 99) < 6.5 ? [] : ['the chase view went through the wall']),
  ...((read['5-chase']?.eye[2] ?? 0) > -40 + 5 ? [] : ['the chase view is not behind the buggy']),
  ...((wrecks['9-worn-smoke']?.puffs ?? 0) >= 20 ? [] : ['the worn buggy draws no plume']),
  ...((wrecks['10-wreck-burst']?.chunks ?? 0) >= 30 ? [] : ['the wreck throws no chunks']),
  ...((wrecks['12-wreck-settled']?.puffs ?? 1) + (wrecks['12-wreck-settled']?.chunks ?? 1) === 0 ? [] : ['the wreck is still breaking apart 4 s on']),
];
console.log(fails.length > 0 ? `FAIL ${JSON.stringify(fails)}` : 'PASS');
process.exitCode = fails.length > 0 ? 1 : 0;
