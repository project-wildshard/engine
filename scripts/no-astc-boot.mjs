#!/usr/bin/env node
// EG-16 (meta docs/plans/test-coverage/ENGINE.md, TEST-COVERAGE row 32): the `--no-astc` boot. A phone with no ASTC draws (BUG-9).
// Chromium at the phone tier (an iPhone profile), with WEBGL_compressed_texture_astc hidden as capture.mjs --no-astc hides it (S4),
// enters a head with a phone set by its own URL and holds:
//   hidden  textures load as images, the reason names the raw-ASTC veto (src/client/engine/boot/gpuFiles.ts `rawAstcVeto`), no raw
//           ASTC 6x6 file is read, the world is entered with frames running, the frame isn't black, and nothing fatal shows;
//   shown   the control: the same page with ASTC reads raw ASTC files, so the hidden pass proves a choice, not an empty table.
// BUG-9's fault, planted at the source (`rawAstcVeto` returning null), turns the hidden pass red: the page reads Pine's raw ASTC
// phone set on a GPU that can't sample it. A harness texture pin is no plant: the veto overrules a pin too.
//   scripts/browser-lane.sh node scripts/no-astc-boot.mjs --base=http://127.0.0.1:4401/ [--slug=pine-hollow] [--out=tmp/no-astc]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { frameFailure, screenshotPixels } from './parity/black-frame.mjs';

/** @param {string} key @param {string} fallback */
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', ''), slug = arg('slug', 'pine-hollow'), out = arg('out', 'tmp/no-astc');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/$/u.test(base)) throw new Error('Requires --base=<a local served build>/ (scripts/serve-build.sh)');
/** The cook's raw ASTC 6x6 files and the hand-made overlays (gpuFiles.ts RAW_ASTC). */
const RAW_ASTC = /\/astc6\/|\.t[0-9]+-[a-f0-9]{8}\.(?:ktx2|glb)$/u;
const hideAstc = () => {
  const ext = 'WEBGL_compressed_texture_astc';
  for (const gl of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const proto = gl.prototype, realExtension = Reflect.get(proto, 'getExtension'), realList = Reflect.get(proto, 'getSupportedExtensions');
    proto.getExtension = function getExtension(name) { return name === ext ? null : Reflect.apply(realExtension, this, [name]); };
    proto.getSupportedExtensions = function getSupportedExtensions() { return Reflect.apply(realList, this, [])?.filter(name => name !== ext) ?? null; };
  }
};
const angle = process.platform === 'darwin' ? 'metal' : 'swiftshader';
const browser = await chromium.launch({ args: [...KEYCHAIN_ARGS, '--mute-audio', '--ignore-gpu-blocklist', `--use-angle=${angle}`] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];

/** One boot of `slug` on a fresh phone; what it chose, read and drew. @param {boolean} astc */
async function boot(astc) {
  const context = await browser.newContext(phone), page = await context.newPage();
  /** @type {string[]} */ const raw = [];
  /** @type {string[]} */ const fatal = [];
  if (!astc) await context.addInitScript(hideAstc);
  page.on('response', response => { const path = new URL(response.url()).pathname; if (RAW_ASTC.test(path)) raw.push(path); });
  page.on('pageerror', error => { fatal.push(error.message.slice(0, 300)); });
  page.on('console', line => { if (line.type() === 'error' || /\brefused\b/iu.test(line.text())) fatal.push(line.text().slice(0, 300)); });
  try {
    await page.goto(new URL(`?chunk=${slug}&skipintro&mute=1&nolock=1`, base).href, { waitUntil: 'load' });
    const play = setInterval(() => { void page.locator('.ws-load-play').click({ timeout: 500 }).catch(() => undefined); }, 1000);
    const entered = await page.waitForFunction(() => window.__wildshard?.world?.hud?.entered === true && document.querySelector('.ws-load') === null && window.__wildshard.world.game.frameGate(), undefined, { timeout: 180_000 })
      .then(() => true, () => false);
    clearInterval(play);
    await page.waitForTimeout(4000);
    const seen = await page.evaluate(() => {
      const api = window.__wildshard, gl = document.createElement('canvas').getContext('webgl2');
      return { textures: api?.textures?.() ?? null, astc: gl?.getExtension('WEBGL_compressed_texture_astc') !== null,
        errors: [...document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')].map(node => (node.textContent ?? '').slice(0, 200)) };
    });
    const shot = await page.screenshot();
    mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${slug}-${astc ? 'astc' : 'no-astc'}.png`), shot);
    const pixels = await page.evaluate(screenshotPixels, Array.from(shot));
    return { entered, ...seen, raw: raw.length, rawSample: raw.slice(0, 3), black: frameFailure(pixels), darkShare: Math.round(pixels.darkShare * 100) / 100, fatal: [...new Set([...fatal, ...seen.errors])].slice(0, 6) };
  } finally { await context.close(); }
}

/** @type {string[]} */ const failures = [];
const hidden = await boot(false), shown = await boot(true);
await browser.close();
/** @param {boolean} ok @param {string} what */
const check = (ok, what) => { if (!ok) failures.push(what); };
check(!hidden.astc && shown.astc, 'the extension was not hidden on one page and shown on the other');
check(hidden.entered, 'no-ASTC: the world never opened');
check(hidden.textures?.mode === 'img' && /overruled: .*no ASTC/u.test(hidden.textures.why), `no-ASTC: textures are ${JSON.stringify(hidden.textures)}, not images by the raw-ASTC veto`);
check(hidden.raw === 0, `no-ASTC: read ${hidden.raw} raw ASTC files (${hidden.rawSample.join(', ')})`);
check(hidden.black === null, `no-ASTC: ${hidden.black}`);
check(hidden.fatal.length === 0, `no-ASTC: ${hidden.fatal.join(' | ')}`);
check(shown.entered && shown.raw > 0, `control: with ASTC the page read ${shown.raw} raw ASTC files, so ${slug} has no phone set to choose against`);
console.log(JSON.stringify({ test: 'no-astc-boot', slug, hidden, shown }, null, 1));
console.log(failures.length === 0 ? `no-astc-boot green: ${slug} draws on a phone with no ASTC` : `no-astc-boot RED:\n${failures.map(line => `  ${line}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);
