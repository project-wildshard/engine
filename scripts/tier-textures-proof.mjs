#!/usr/bin/env node
// S12 (J330): does a shard page load and look the same with its phone textures cut to a tier size by the cook's mip trim
// (src/cook/game/tierTextures.ts)? Phone tier, iPhone 17 Pro viewport, headless. Every `.glb` and `.ktx2` the page reads
// is fetched from the served build and, with --max, answered with `tierGlb` / `trimKtx2` at that size, so the page reads
// exactly what a trim-only cook would ship. Reports the bytes those responses carried, the page's GPU ledger and three's
// texture count once the player stands in the world, and saves a screenshot to compare.
//   scripts/browser-lane.sh node --import ./scripts/bake-loader.mjs scripts/tier-textures-proof.mjs --base=http://127.0.0.1:<port>
//     [--engine=chromium|webkit] [--slug=pine-hollow] [--max=512] [--out=tmp/<lane>/tier-proof] [--label=<name>]
// Loopback only: never staging or production.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';

const { tierGlb, trimKtx2 } = await import('../src/cook/game/tierTextures.ts');

/** @type {Record<string, string>} */
const args = Object.fromEntries(process.argv.slice(2).map(arg => /^--([^=]+)(?:=(.*))?$/u.exec(arg)).filter(match => match !== null).map(match => [match[1], match.at(2) ?? '1']));
const base = (args.base ?? '').replace(/\/$/u, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(base)) throw new Error('--base takes a loopback build only');
const engineName = args.engine ?? 'chromium', slug = args.slug ?? 'pine-hollow', max = args.max === undefined ? 0 : Number(args.max);
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error(`No engine ${engineName}`);
const label = args.label ?? `${engineName}-${max === 0 ? 'master' : `max${max}`}`, out = absolute(args.out ?? 'tmp/tier-proof');
mkdirSync(out, { recursive: true });
const MB = 1e6;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

const READ = `(() => {
  const api = window.__wildshard, mem = (() => { try { return ${pageMemoryAttributionExpression}; } catch (e) { return { error: String(e) }; } })();
  const rows = Array.isArray(mem?.allocations) ? mem.allocations : [], kinds = {};
  for (const r of rows) { const k = r.domain + ' ' + r.kind; kinds[k] = (kinds[k] ?? 0) + r.bytes; }
  let three = null; try { const r = api.requireWorld().game.renderer; three = { textures: r.info.memory.textures, geometries: r.info.memory.geometries }; } catch {}
  let mode = null; try { mode = api.textures?.()?.mode ?? null; } catch {}
  return { totals: mem?.totals ?? null, kinds, three, mode };
})()`;

const result = { engine: engineName, base, slug, max, label, at: new Date().toISOString(), outcome: 'none', errors: /** @type {string[]} */ ([]),
  glb: { files: 0, served: 0, read: 0 }, ktx2: { files: 0, served: 0, read: 0 }, page: /** @type {unknown} */ (null) };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true,
  args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: engineName === 'chromium', hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1' });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
  await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
  await context.route(/\.(?:glb|ktx2)(?:\?.*)?$/u, async route => {
    const response = await route.fetch(), body = new Uint8Array(await response.body());
    const glb = /\.glb(?:\?|$)/u.test(route.request().url()), row = glb ? result.glb : result.ktx2;
    const read = max === 0 || response.status() !== 200 ? body : glb ? tierGlb(body, max) : trimKtx2(body, max);
    row.files++; row.served += body.length; row.read += read.length;
    const headers = { ...response.headers() };
    delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
    await route.fulfill({ status: response.status(), headers, body: Buffer.from(read) });
  });
  const page = await context.newPage(); page.setDefaultTimeout(240_000);
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await page.goto(`${base}/?chunk=${slug}&skipintro&mute=1&nolock=1`, { waitUntil: 'commit', timeout: 120_000 });
  const started = Date.now();
  for (;;) {
    await sleep(500);
    if (Date.now() - started > 240_000) { result.outcome = 'stalled'; break; }
    if (await page.locator('.ws-load-play').isVisible().catch(() => false)) await page.locator('.ws-load-play').click({ timeout: 3000 }).catch(() => undefined);
    const ready = await page.evaluate(() => {
      const api = /** @type {any} */ (window).__wildshard; let world = null; try { world = api?.requireWorld?.() ?? null; } catch { /* not yet */ }
      return world?.player !== undefined && world?.player !== null && document.getElementById('hud')?.classList.contains('intro') !== true;
    }).catch(() => false);
    if (ready) { result.outcome = 'play'; break; }
  }
  await sleep(12_000);
  result.page = await page.evaluate(READ);
  await page.screenshot({ path: join(out, `${label}.png`) }).catch(() => undefined);
  if (result.outcome !== 'play') code = 1;
} catch (error) {
  result.errors.push(String(error).slice(0, 400)); code = 1;
} finally {
  await browser.close();
}
writeFileSync(join(out, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
const page = /** @type {any} */ (result.page);
const gpuTex = page ? Object.entries(page.kinds ?? {}).filter(([k]) => /^gpu .*tex/iu.test(k)).reduce((total, [, bytes]) => total + Number(bytes), 0) : 0;
console.log(`${label}: ${result.outcome}, mode ${page?.mode ?? '?'}, glb ${result.glb.files} files ${(result.glb.served / MB).toFixed(2)} -> ${(result.glb.read / MB).toFixed(2)} MB, ktx2 ${result.ktx2.files} files ${(result.ktx2.served / MB).toFixed(2)} -> ${(result.ktx2.read / MB).toFixed(2)} MB, GPU textures ${(gpuTex / MB).toFixed(1)} MB, GPU total ${((page?.totals?.gpu ?? 0) / MB).toFixed(1)} MB, three textures ${page?.three?.textures ?? '?'}, errors ${result.errors.length}`);
process.exit(code);
