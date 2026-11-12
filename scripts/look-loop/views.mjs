#!/usr/bin/env node
// views.mjs: the look loop's capture (docs/look-loop.md, step 2). Per anchor of a cameras.json it shoots the nine
// fixed cameras and writes a 3x3 sheet:
//   1-4  first person at P: FRONT / LEFT / RIGHT / BACK. fp.viewport @ fp.dpr, HUD on; fp.tier phone (the default) is an
//        iPhone 16 Pro (UA, touch) and must be portrait, any other tier a desktop context
//   5    TOP, straight down on P with the front heading image-up. god.tier, god.viewport @1, HUD hidden, god.fovV
//   6-9  DIAG front / left / right / back, up and out, looking at P
// The first run resolves each anchor's cameras (ground height from the live heightfield) and writes them back into the
// JSON; every later run shoots exactly those cameras, so a before / after pair is the same frame.
//
//   node scripts/look-loop/views.mjs --cameras=<json> --out=<dir> [--anchor=a,b] [--tag=r2] [--query=k=v&...]
//        [--url=http://127.0.0.1:4173] [--settle=4] [--timeout=300] [--save=debug.lookLight=on,…]
//
// Writes <out>/<anchor>/[<tag>-]capture-<n>-<id>.jpg and <out>/[<tag>-]<anchor>-sheet.jpg (JPEG, <= 490 KB). Cells:
// row 1 FP front / left / right, row 2 FP back / TOP / DIAG front, row 3 DIAG left / right / back; each cell is labelled
// with the frame's draw calls and triangles. Shoot a served build (engine scripts/serve-build.sh, or
// scripts/preview-server.mjs on a built dist), never a dev server. One headless Chromium, muted, closed in a finally.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { NAME_ASKED, developerSettings, harnessPins, hideDeveloperOverlays, saveFixture } from '../debug-settings.mjs';
import { captureName, contextOptions, parseCameraFile, parseFlags, resolveMissing } from './cameras.mjs';

const flags = parseFlags(process.argv.slice(2), ['cameras', 'out', 'anchor', 'tag', 'query', 'url', 'settle', 'timeout', 'save', 'help']);
if (flags.help || typeof flags.cameras !== 'string' || typeof flags.out !== 'string') {
  console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^\/\/ ?/u, '')).join('\n'));
  process.exit(flags.help ? 0 : 2);
}
const str = (/** @type {string | true | undefined} */ x, /** @type {string} */ d) => (typeof x === 'string' ? x : d);
const CAMS = resolvePath(flags.cameras), OUT = resolvePath(flags.out);
const TAG = str(flags.tag, ''), EXTRA = str(flags.query, ''), BASE = str(flags.url, 'http://127.0.0.1:4173').replace(/\/$/u, '');
const SETTLE = Number(str(flags.settle, '4')) * 1000, TIMEOUT = Number(str(flags.timeout, '300')) * 1000;
const only = str(flags.anchor, '').split(',').filter(Boolean);
if (TAG !== '' && !/^[a-z0-9][a-z0-9-]*$/u.test(TAG)) throw new Error(`--tag=${TAG}: lowercase letters, digits and - only (targets.py reads it back)`);
const DEF = parseCameraFile(JSON.parse(readFileSync(CAMS, 'utf8')));
/** `--save=key=value,…`: device save slots written before the load (a Debug row read at load, e.g. debug.lookLight=on) */
const SAVES = str(flags.save, '').split(',').filter(Boolean).map(pair => { const at = pair.indexOf('='); if (at < 1) throw new Error(`--save=${pair}: key=value`); return { scope: 'device', key: pair.slice(0, at), data: pair.slice(at + 1) }; });
const unknown = only.filter(id => !DEF.anchors.some(a => a.id === id));
if (unknown.length > 0) throw new Error(`--anchor: no anchor ${unknown.join(', ')} in ${CAMS}`);
const anchors = DEF.anchors.filter(a => only.length === 0 || only.includes(a.id));
mkdirSync(OUT, { recursive: true });
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });

/** In the page: install the late-phase camera pose once. A god pose is set last in every frame (after the player's
 * camera and the free camera's Euler), and the camera's children (the viewmodel) stay hidden while it holds. */
function installPose() {
  const w = window.__wildshard.world;
  if (w.animals) w.animals.calm = true;
  if (window.__lookLoop) return;
  window.__lookLoop = { pose: null };
  w.game.onLate(() => {
    const p = window.__lookLoop.pose, cam = w.game.camera;
    if (!p) return;
    for (const ch of cam.children) ch.visible = false;
    cam.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.up) cam.up.set(p.up[0], p.up[1], p.up[2]); else cam.up.set(0, 1, 0);
    cam.lookAt(p.look[0], p.look[1], p.look[2]); cam.up.set(0, 1, 0);
    cam.updateMatrixWorld(true);
    if (Math.abs(cam.fov - p.fovV) > 0.01) { cam.fov = p.fovV; cam.updateProjectionMatrix(); }
  }, 'look-loop.pose');
}

/** In the page: pose one camera. A god shot parks the player under its look point with the free camera on, so
 * streaming and LOD centre on the view; an FP shot stands the player at P. Animals within 24 m are parked 70 m out. */
async function poseCamera(c) {
  const w = window.__wildshard.world, probe = window.__wildshard;
  if (c.mode === 'god') {
    await probe.pose({ x: c.look[0], z: c.look[2] });
    w.freeCamera = true; window.__lookLoop.pose = c;
    return;
  }
  window.__lookLoop.pose = null; w.freeCamera = false;
  for (const ch of w.game.camera.children) ch.visible = true;
  await probe.pose({ x: c.x, z: c.z, yaw: c.yaw, pitch: c.pitch });
  for (const an of w.animals?.animals ?? []) {
    const dx = an.position.x - c.x, dz = an.position.z - c.z, d = Math.hypot(dx, dz);
    if (!an.alive || d > 24) continue;
    const k = 70 / Math.max(d, 0.01), x = c.x + dx * k, z = c.z + dz * k;
    an.driven = true; an.speed = 0; an.position.set(x, window.__hf?.heightAt?.(x, z) ?? an.position.y, z);
  }
}

/** In the page: the ground height under P, from the heightfield, else where the pose landed the player. */
async function groundAt(P) {
  const h = window.__hf?.heightAt?.(P.x, P.z);
  if (Number.isFinite(h)) return h;
  await window.__wildshard.pose({ x: P.x, z: P.z });
  return window.__wildshard.world.player.position.y;
}

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
/** @type {Map<string, {n:number,id:string,file:string,calls:number,tris:number}[]>} */
const shots = new Map();
try {
  const iphone = devices['iPhone 16 Pro'];
  const groups = [
    { mode: 'fp', tier: DEF.fp.tier, query: DEF.fp.query, ctx: contextOptions(DEF, 'fp', iphone) },
    { mode: 'god', tier: DEF.god.tier, query: DEF.god.query, ctx: contextOptions(DEF, 'god', iphone) },
  ];
  for (const g of groups) {
    const ctx = await browser.newContext(g.ctx);
    try {
      await developerSettings(ctx, { tier: g.tier, volume: 0, ...DEF.settings });
      await ctx.addInitScript(hideDeveloperOverlays);
      for (const fixture of SAVES) await saveFixture(ctx, fixture);
      await harnessPins(ctx, { seed: 357 });
      await saveFixture(ctx, NAME_ASKED); // a page with a world asks for the Name before it joins (MP2.4); a capture never answers it
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
      const url = `${BASE}/?${[DEF.query, g.query, EXTRA].filter(Boolean).join('&')}`;
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'load' });
      try {
        await page.waitForFunction(() => Boolean(window.__wildshard?.world?.hud?.entered && !document.querySelector('.ws-load') && window.__wildshard.world.game.frameGate()), undefined, { timeout: TIMEOUT, polling: 1000 });
      } catch (error) {
        // name what holds the frame gate, so a stuck load says why instead of only timing out
        const why = await page.evaluate(() => ({ entered: Boolean(window.__wildshard?.world?.hud?.entered), loading: Boolean(document.querySelector('.ws-load')), paused: Boolean(window.__wildshard?.world?.hud?.paused), rotatePage: matchMedia('(orientation: landscape) and (pointer: coarse) and (min-aspect-ratio: 5/4)').matches, namePrompt: Boolean(document.querySelector('#ws-name-box')) })).catch(() => ({}));
        throw new Error(`[${g.mode}] ${url} not ready in ${TIMEOUT / 1000} s: ${JSON.stringify(why)}`, { cause: error });
      }
      if (await page.evaluate(() => window.__wildshard.world.hud.paused)) await page.keyboard.press('Escape');
      console.error(`[${g.mode}] ${url} ready in ${((Date.now() - t0) / 1000).toFixed(0)} s${errors.length > 0 ? `; page errors: ${errors.join(' | ')}` : ''}`);
      const groundY = new Map();
      for (const a of anchors) if (!a.cameras) groundY.set(a.id, await page.evaluate(groundAt, a.P));
      // only the anchors this run measured: an unselected anchor stays unresolved for its own first run
      const resolved = resolveMissing({ ...DEF, anchors }, a => { const y = groundY.get(a.id); if (y === undefined) throw new Error(`no ground height for ${a.id}`); return y; });
      if (resolved.length > 0) { writeFileSync(CAMS, `${JSON.stringify(DEF, null, 2)}\n`); console.error(`resolved ${resolved.join(', ')} into ${CAMS}`); }
      await page.evaluate(installPose);
      // god shots hide the HUD: every element but the world canvas and the minimap
      if (g.mode === 'god') {
        await page.evaluate(() => { for (const el of document.querySelectorAll('canvas')) { const r = el.getBoundingClientRect(); el.dataset.lookLoop = r.width * r.height >= innerWidth * innerHeight / 2 ? '1' : '0'; } });
        await page.addStyleTag({ content: 'body *{visibility:hidden!important}canvas[data-look-loop="1"]{visibility:visible!important}.ws-minimap{display:none!important}' });
      }
      await sleep(SETTLE * 2); // the first frames after a load: streaming, compiles
      for (const a of anchors) {
        const dir = join(OUT, a.id); mkdirSync(dir, { recursive: true });
        for (const c of (a.cameras ?? []).filter(x => x.mode === g.mode)) {
          await page.evaluate(poseCamera, c);
          await sleep(SETTLE);
          const perf = await page.evaluate(() => { const f = window.__wildshard.world.game.lastFrame; return { calls: f?.calls ?? 0, tris: f?.triangles ?? 0 }; });
          const file = join(dir, captureName(TAG, c));
          writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 84, scale: 'css' }));
          shots.set(a.id, [...(shots.get(a.id) ?? []), { n: c.n, id: c.id, file, ...perf }]);
          console.log(`${a.id.padEnd(8)} ${c.n} ${c.id.padEnd(11)} ${String(perf.calls).padStart(4)} calls · ${(perf.tris / 1e6).toFixed(2)} M tris`);
        }
      }
      if (errors.length > 0) console.error(`[${g.mode}] page errors: ${errors.join(' | ')}`);
    } finally { await ctx.close(); }
  }
} finally {
  await browser.close();
}

const esc = (/** @type {string} */ s) => s.replaceAll(/[<>&"]/gu, ch => `&#${ch.codePointAt(0)};`);
/** One 3x3 sheet per anchor, cells in camera order, <= 490 KB. */
for (const a of anchors) {
  const rows = (shots.get(a.id) ?? []).sort((x, y) => x.n - y.n);
  const CW = 640, CH = 560, GAP = 6, TOP = 26, LABEL = 22, W = CW * 3 + GAP * 4, H = CH * 3 + GAP * 4 + TOP;
  const title = `${a.name ?? a.id} · P (${a.P.x}, ${a.P.z}) · ${TAG || 'baseline'} · FP ${DEF.fp.viewport.join('×')} · god ${DEF.god.viewport.join('×')}`;
  const layers = [], text = [`<text x="${GAP + 4}" y="19" fill="#ffd98a" font-family="monospace" font-size="15" font-weight="600">${esc(title)}</text>`];
  for (const [i, r] of rows.entries()) {
    const x = GAP + (i % 3) * (CW + GAP), y = TOP + GAP + Math.floor(i / 3) * (CH + GAP);
    const cell = await sharp(r.file).resize(CW, CH - LABEL, { fit: 'contain', background: '#111111' }).toBuffer();
    layers.push({ input: cell, left: x, top: y });
    text.push(`<text x="${x + 4}" y="${y + CH - 6}" fill="#9fe6ff" font-family="monospace" font-size="13" font-weight="600">${esc(`${r.n} ${r.id} · ${r.calls} calls · ${(r.tris / 1e6).toFixed(2)} M`)}</text>`);
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${text.join('')}</svg>`), left: 0, top: 0 });
  const canvas = await sharp({ create: { width: W, height: H, channels: 3, background: '#111111' } }).composite(layers).png().toBuffer();
  let jpg = Buffer.alloc(0);
  for (let q = 86; q >= 35; q -= 4) { jpg = await sharp(canvas).jpeg({ quality: q, mozjpeg: true }).toBuffer(); if (jpg.byteLength < 490 * 1024) break; }
  const out = join(OUT, `${TAG ? `${TAG}-` : ''}${a.id}-sheet.jpg`);
  writeFileSync(out, jpg);
  console.log(`sheet: ${out} (${rows.length} of 9 cells, ${(jpg.byteLength / 1024).toFixed(0)} KB)`);
}
