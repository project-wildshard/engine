#!/usr/bin/env node
// hero-shots.mjs — the title deck's portrait hero shots, aimed at the stage band (E396, Jake 2026-10-02: "most of the
// exciting content is above the UI in the top 50%").
//
// On Jake's iPhone (home-screen PWA, 402×813 CSS px under the status bar) the wordmark covers the top ~8 % of the hero and
// the card, the dots, the summary and ENTER WORLD cover everything below ~46 %. So a hero is framed in three bands:
//   0–8 %   sky, darkened by the menu's top shade;
//   8–46 %  THE STAGE: the shard's subject (tower, camp, cove, fire) sits here, whole;
//   46–100% foreground texture (grass, sand, ice, planks) under the panels, nothing anyone must see.
// To push the subject up the frame without pitching the camera down (verticals would lean), the camera is LENS-SHIFTED:
// `camera.setViewOffset` renders the lower part of a taller virtual frame, so the aim point lands at `center` (0.3 = 30 %
// from the top) with the horizon level and the verticals straight (a tilt-shift lens, in three.js).
//
// A view (art/hero-images/round-5-stage-band/<slug>/views.json, `{ "views": [ … ] }`):
//   { id, pos: [x, y, z], look: [x, y, z],   absolute world coordinates (y up; `posGround` / `lookGround` = [x, dy, z]
//                                             over the floor there, read by posing the player)
//     fov: 60,          the output frame's vertical field of view (as if it were centred)
//     center: 0.3,      where the look point lands, 0 = top … 1 = bottom (0.5 = no shift)
//     query: "clock=…", extra harness params for this view's load (views with the same query share one load)
//     settle: 6000, burst: 1, burstGap: 2500, eval: "<js run in the page before the shot>" }
//
//   scripts/serve-build.sh --head --name hero        # → http://127.0.0.1:<port>/
//   scripts/browser-lane.sh --max 30 node scripts/hero-shots.mjs --shard=<slug> --url=http://127.0.0.1:<port> \
//     --views=art/hero-images/round-5-stage-band/<slug>/views.json --out=<dir> [--only=a,b] [--card=<deck index>]
//   → <dir>/<id>.jpg (1206×2440, the phone's own pixels) + <id>-menu.jpg (the same hero under the real title deck)
//   scripts/browser-lane.sh --max 10 node scripts/hero-shots.mjs --shard=<slug> --url=… --overlay=<a.jpg,b.jpg> --out=<dir>
//   → only the -menu.jpg checks, for heroes already shot (or the shipped one).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { saveFixture } from './debug-settings.mjs';

const { chromium } = await import('playwright');
const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SLUG = flag('shard', '');
const URL_BASE = flag('url', '');
const OUT = resolvePath(flag('out', join(ROOT, 'art', 'hero-images', 'round-5-stage-band', SLUG)));
const OVERLAY = flag('overlay', '').split(',').filter(Boolean).map((p) => resolvePath(p));
const ONLY = flag('only', '').split(',').filter(Boolean);
if (!SLUG || !URL_BASE) { console.error('usage: hero-shots.mjs --shard=<slug> --url=<served build> (--views=<json> | --overlay=<jpgs>) [--out=<dir>] [--only=<ids>]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 402, height: 813 }; // iPhone 17 Pro, home-screen PWA, below the status bar
const SCALE = 3;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** a full-res PNG → a JPEG beside it (q86, the hero files' quality) */
const toJpeg = (png, jpg) => {
  const tmp = `${jpg}.png`; writeFileSync(tmp, png);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '86', tmp, '--out', jpg], { stdio: 'ignore' });
  execFileSync('rm', ['-f', tmp]);
};

const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];

/** The real title deck with `jpg` as this shard's hero: the same card selected, the same panels, on the phone's viewport. */
async function overlay(jpgs) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, userAgent: IPHONE });
  await saveFixture(ctx, { scope: 'device', key: 'devMode', data: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`${URL_BASE}/?mute=1&sw=0&tier=phone&touch=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ws-menu-card', { timeout: 240000 });
  await sleep(1500);
  // pick this shard's card: its hero url carries the slug
  // (the loaded shard's hero can be a blob: url, so `--card=<index>` names the card outright)
  const ok = await page.evaluate(async ([slug, card]) => {
    const dots = Array.from(document.querySelectorAll('.ws-menu-dots i'));
    const hero = document.querySelector('.ws-menu-hero');
    for (const [i, d] of dots.entries()) {
      if (card >= 0 && i !== card) continue;
      d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => { setTimeout(resolve, 400); });
      if (card === i || (hero instanceof HTMLElement && hero.style.backgroundImage.includes(slug))) return true;
    }
    return false;
  }, [SLUG, Number(flag('card', '-1'))]);
  if (!ok) errors.push(`overlay: no card whose hero names ${SLUG}`);
  await sleep(1200);
  for (const jpg of jpgs) {
    const bytes = readFileSync(jpg);
    const url = new URL(`/__wildshard_hero/${randomUUID()}.jpg`, page.url()).href;
    const serve = (/** @type {import('playwright').Route} */ route) => route.fulfill({ contentType: 'image/jpeg', body: bytes });
    await page.route(url, serve);
    try {
      await page.evaluate((src) => {
        let st = document.getElementById('__hero'); if (!st) { st = document.createElement('style'); st.id = '__hero'; document.head.append(st); }
        st.textContent = `.ws-menu .ws-menu-hero{background-image:url("${src}")!important;opacity:1!important;transition:none!important}`;
      }, url);
      await sleep(800);
      toJpeg(await page.screenshot({ type: 'png' }), join(OUT, `${basename(jpg, '.jpg')}-menu.jpg`));
      console.log('menu check', basename(jpg));
    } finally { await page.unroute(url, serve); }
  }
  await ctx.close();
}

try {
  if (OVERLAY.length > 0) {
    await overlay(OVERLAY);
  } else {
    const all = JSON.parse(readFileSync(resolvePath(flag('views', join(OUT, 'views.json'))), 'utf8')).views;
    const list = all.filter((v) => ONLY.length === 0 || ONLY.includes(v.id));
    const groups = new Map();
    for (const v of list) { const q = v.query ?? ''; if (!groups.has(q)) groups.set(q, []); groups.get(q).push(v); }
    const shot = [];
    for (const [q, views] of groups) {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
      await saveFixture(ctx, { scope: 'device', key: 'devMode', data: true }); // experimental shards enter only in developer mode
      await saveFixture(ctx, { scope: 'global', key: 'gfx', data: { dpr: 'native', aa: 'on' } });
      await ctx.addInitScript(() => { window.__wildshardHarness = { seed: 0x2545f491, capture: null, lane: 'local', sha: '', browser: 'chromium', errors: [], saves: { read: [], written: [] }, audioRequests: [], gpuBytes: () => ({ textures: 0, renderbuffers: 0, buffers: 0, total: 0 }) }; });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      const url = `${URL_BASE}/?chunk=${SLUG}&tier=desktop&mute=1&nolock=1&sw=0&perf=0&skipintro=1${q ? `&${q}` : ''}`;
      console.log('load', url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__wildshard?.world?.player && window.__wildshard?.world?.game) && document.querySelector('.ws-load') === null,
        undefined, { timeout: 480000, polling: 1000 });
      await page.evaluate(() => {
        const w = window.__wildshard.world, cam = w.game.camera;
        try { w.animals.calm = true; } catch { /* a shard without animals */ }
        const st = document.createElement('style'); st.textContent = 'body *{visibility:hidden!important} canvas.__game{visibility:visible!important}';
        w.game.renderer.domElement.classList.add('__game'); document.head.append(st);
        window.__hv = null;
        // posed last in the frame: position, aim, then the lens shift (see the header)
        w.game.onLate(() => {
          const v = window.__hv; if (!v) return;
          cam.position.set(v.pos[0], v.pos[1], v.pos[2]); cam.up.set(0, 1, 0); cam.lookAt(v.look[0], v.look[1], v.look[2]);
          const c = v.center ?? 0.5, span = 2 * Math.tan((v.fov * Math.PI) / 360), a = innerWidth / innerHeight;
          const fh = 2 * Math.max(c, 1 - c), oy = c < 0.5 ? 1 - 2 * c : 0;
          cam.fov = (2 * Math.atan((fh / 2) * span) * 180) / Math.PI;
          cam.far = Math.max(cam.far, 6000);
          cam.setViewOffset(a, fh, 0, oy, a, 1); // sets aspect = a / fh and updates the projection
          for (const ch of cam.children) ch.visible = false;
          cam.updateMatrixWorld(true);
        });
      });
      await sleep(8000);
      for (const v of views) {
        const ground = (p) => page.evaluate(async ([x, dy, z]) => {
          await window.__wildshard.pose({ x, z, yaw: 0, pitch: 0 });
          await new Promise((resolve) => { setTimeout(resolve, 1500); });
          return window.__wildshard.world.player.position.y + dy; // the player's feet
        }, p);
        const pos = v.posGround ? [v.posGround[0], await ground(v.posGround), v.posGround[2]] : v.pos;
        const look = v.lookGround ? [v.lookGround[0], await ground(v.lookGround), v.lookGround[2]] : v.look;
        await page.evaluate((hv) => { window.__hv = hv; }, { ...v, pos, look });
        await sleep(v.settle ?? 6000);
        if (v.eval) { await page.evaluate(v.eval); await sleep(1000); }
        const n = v.burst ?? 1;
        for (let i = 0; i < n; i++) {
          const id = n > 1 ? `${v.id}-${i}` : v.id;
          toJpeg(await page.screenshot({ type: 'png' }), join(OUT, `${id}.jpg`)); shot.push(join(OUT, `${id}.jpg`));
          console.log('captured', id, JSON.stringify({ pos: pos.map((x) => Number(x.toFixed(2))), look: look.map((x) => Number(x.toFixed(2))) }));
          if (i < n - 1) await sleep(v.burstGap ?? 2500);
        }
      }
      await ctx.close();
    }
    if (!argv.includes('--no-menu')) await overlay(shot);
  }
  if (errors.length > 0) console.log('page errors:', errors.slice(0, 4).join(' | '));
} finally { await browser.close(); }
