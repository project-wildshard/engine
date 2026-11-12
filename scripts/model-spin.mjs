#!/usr/bin/env node
// model-spin.mjs — a ~10 s portrait turntable clip of 1–5 models, shot in the game's REAL Model Explorer, for review on
// a phone in the Claude app (project/archive/2026-09-30-model-architecture.md M9, E315). Jake: "an agent can just make a video spinning
// the model in the Model Explorer, or a video spinning five models … in a little 10-second clip".
//
//   node scripts/model-spin.mjs --url=<served build> --shard=<slug> --models=<id,id,…|first:5> --out=<file.mp4>
//                               [--seconds=10] [--size=402x874] [--turns=1] [--fps=30] [--keep] [--debug=<key=value,…>]
//   node scripts/model-spin.mjs --url=<served build> --shard=<slug> --list      # the catalog's ids + names, in its order
//   --models=<id>@* spins each of a card's variants (its chips: Camp people's five), <id>@<n> its n-th (1-based), E353
//
//   scripts/browser-lane.sh node scripts/model-spin.mjs --url=https://play.wildshard.io \
//     --shard=driftwood-isle --models=hut --out=art/models-audit/round-3-spin-clips/driftwood-hut.mp4
//
// What it does:
//   - boots the shard at phone tier with touch, in a 402×874 CSS-px iPhone frame (3× DPR; the phone tier renders at 2×),
//     straight into the Model Explorer's catalog (`?explore=model`, harness params only, lint/url-params.json);
//   - for each model: taps back to the catalog and taps its card (the real UI path), lets it build and settle, then
//     spins it on the explorer's own turntable — its camera, its studio, its light. The explorer only idles round at
//     0.22 rad/s, so the script drives the turntable's own drag input (a pointer held on the canvas, moved sideways every
//     frame, wall-clock paced): `--turns` full turns per model (default 1) in `seconds / models` seconds each;
//   - records the game canvas at its real buffer size (captureStream + MediaRecorder, vp9 ~16 Mb/s), one segment per
//     model, so the cuts are clean. Every frame the game draws is copied by the game's own `captureFrame` (same task as
//     composer.render: the drawing buffer is not preserved) onto an opaque canvas over black — what the phone shows.
//     Recording the WebGL canvas itself does NOT work on Nine Dragon: its materials keep the view depth in alpha (E289),
//     and the recorder un-premultiplies those pixels, so every model came out a washed-out white;
//   - the canvas carries no DOM, so the explorer's own overlay (top bar, the bottom sheet with the model's name, source
//     file, tris, draw calls, build time, phone budget) is screenshot once per model with the canvas hidden (a
//     transparent PNG) and laid over that model's segment by ffmpeg. With several models a small "2 / 5" chip is added;
//   - encodes a phone H.264 MP4 at ~4.5 Mb/s (+faststart). SendUserFile silently drops files over 30 MB; 10 s ≈ 6 MB.
//     --keep leaves a master next to the MP4 (<out>-master/: the vp9 segments, the overlays, and a still of the page as
//     the phone shows it, canvas + DOM, per model); otherwise nothing but the MP4 is written.
//
// Headless Chromium on Metal, muted, one page, closed at the end. Run it inside scripts/browser-lane.sh (≤ 3 game
// browsers on this Mac).
import { execFileSync } from 'node:child_process';
import { debugSettings } from './debug-settings.mjs';
import { browserBakeBytes } from './bake-output.mjs';
import { stopSpinRecording, uploadRecordedClip } from './model-spin-recording.mjs';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a === undefined ? dflt : a.slice(name.length + 3); };
const has = (name) => argv.includes(`--${name}`);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
class SpinError extends Error { constructor(msg) { super(msg); this.name = 'SpinError'; } }
const die = (msg) => { throw new SpinError(msg); };
/** before the browser is up: print the usage and leave */
const usage = (msg) => {
  console.error(`model-spin: ${msg}\n  node scripts/model-spin.mjs --url=<served build> --shard=<slug> --models=<id,id,…|first:5> --out=<file.mp4> [--seconds=10] [--size=402x874] [--turns=1] [--fps=30] [--keep]\n  node scripts/model-spin.mjs --url=<served build> --shard=<slug> --list`);
  process.exit(1);
};

const BASE = flag('url', '');
const SHARD = flag('shard', '');
const LIST = has('list');
const MODELS = flag('models', '');
const OUT = flag('out', '');
const SECONDS = Number(flag('seconds', '10'));
const TURNS = Number(flag('turns', '1'));
const FPS = Number(flag('fps', '30'));
const KEEP = has('keep');
/** --debug=key=value,key=value: pause ▸ Settings ▸ Debug options set before the load (a face variant, E339) */
const DEBUG = Object.fromEntries(flag('debug', '').split(',').filter((kv) => kv.includes('=')).map((kv) => kv.split('=')));
const [VW = 0, VH = 0] = flag('size', '402x874').split('x').map(Number);
if (BASE === '' || SHARD === '') usage('--url=<served build> and --shard=<slug> are required');
if (!LIST && (MODELS === '' || OUT === '')) usage('--models=<id,id,…|first:N> and --out=<file.mp4> are required (or --list)');
if (!(SECONDS > 0) || !(TURNS > 0) || !(FPS > 0) || !(VW > 0) || !(VH > 0)) usage('--seconds, --turns, --fps and --size must be positive');

/** ModelExplorer.onMove: `this.yaw -= dx * 0.008` — radians of turntable per px of drag */
const RAD_PER_PX = 0.008;

/** other agents' saves full-reload a dev-server page mid-run: a stub @vite/client ignores them (a built page never asks) */
const VITE_STUB = `
import '/@vite/env';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
const hot = () => ({ data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {}, invalidate() {}, on() {}, off() {}, send() {} });
export function createHotContext() { return hot(); }
const sheets = new Map();
export function updateStyle(id, css) { let s = sheets.get(id); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); sheets.set(id, s); } s.textContent = css; }
export function removeStyle(id) { const s = sheets.get(id); if (s) { s.remove(); sheets.delete(id); } }
export function injectQuery(url) { return url; }
export class ErrorOverlay extends HTMLElement {}
`;

const url = new URL(BASE);
for (const [k, v] of Object.entries({ chunk: SHARD, tier: 'phone', touch: '1', mute: '1', nolock: '1', sw: '0', explore: 'model' })) url.searchParams.set(k, v);

const { chromium } = await import('playwright');
const scratch = resolvePath(import.meta.dirname, '../tmp'); mkdirSync(scratch, { recursive: true });
const work = mkdtempSync(join(scratch, 'model-spin-'));
/** @type {import('playwright').Browser|undefined} */
let browser;
try {
  browser = await chromium.launch({ args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (Object.keys(DEBUG).length > 0) await debugSettings(ctx, DEBUG);
  const page = await ctx.newPage();
  await page.route('**/@vite/client', (r) => r.fulfill({ contentType: 'application/javascript', body: VITE_STUB }));
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message.slice(0, 200)); });

  // ── boot straight into the Model Explorer's catalog ──
  const t0 = Date.now();
  console.log(`model-spin: ${url.href}`);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  const opened = await page.waitForFunction(() => {
    if (document.querySelector('.ws-x-empty-models.show') !== null) return 'empty';
    const shown = document.querySelector('.ws-x.show[data-mode="model"] .ws-x-models.show[data-view="catalog"]');
    return shown !== null && document.querySelectorAll('.ws-x-grid .ws-x-model').length > 0 && window.__wildshard?.world !== undefined ? 'catalog' : false;
  }, undefined, { timeout: 480_000, polling: 1000 }).then((h) => h.jsonValue());
  if (opened === 'empty') die(`${SHARD} has no models in its catalog`);
  console.log(`model-spin: explorer open in ${Math.round((Date.now() - t0) / 1000)} s`);

  const catalog = await page.evaluate(() => [...document.querySelectorAll('.ws-x-grid .ws-x-model')].map((c) => ({ id: c.dataset.id ?? '', name: c.querySelector('b')?.textContent ?? '' })));
  if (LIST) {
    for (const [i, c] of catalog.entries()) console.log(`${String(i + 1).padStart(3)}  ${c.id.padEnd(34)} ${c.name}`);
    process.exitCode = 0;
  } else {
    const first = /^first:(\d+)$/u.exec(MODELS);
    const asked = first ? catalog.slice(0, Number(first[1])).map((c) => c.id) : MODELS.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const unknown = asked.map((s) => s.split('@')[0] ?? '').filter((id) => !catalog.some((c) => c.id === id));
    if (unknown.length > 0) die(`not in ${SHARD}'s catalog: ${unknown.join(', ')}\n  catalog: ${catalog.map((c) => c.id).join(', ')}`);
    // `id@*` spins every one of a card's variants (its chips under the name: Camp people's five, E353), `id@n` its n-th (1-based)
    const ids = [];
    for (const spec of asked) {
      const [id = '', v] = spec.split('@');
      if (v !== '*') { ids.push(spec); continue; }
      const n = await page.evaluate((m) => {
        const q = (s) => document.querySelector(s);
        if (q('.ws-x-models')?.dataset.view === 'model') q('.ws-x-back')?.click();
        [...document.querySelectorAll('.ws-x-grid .ws-x-model')].find((c) => c.dataset.id === m)?.click();
        const count = document.querySelectorAll('.ws-x-variants button').length;
        q('.ws-x-back')?.click();
        return count;
      }, id);
      if (n === 0) die(`${id} has no variants (its card shows no variant chips)`);
      for (let k = 1; k <= n; k++) ids.push(`${id}@${k}`);
    }
    if (ids.length === 0) die('no models to spin');
    if (first && ids.length < Number(first[1])) console.log(`model-spin: the catalog has only ${ids.length} models`);
    const seg = SECONDS / ids.length;

    if (!(await page.evaluate(() => typeof window.__wildshard?.world?.game?.captureFrame === 'function'))) die('this build has no game.captureFrame (src/client/engine/core/Game.ts) to copy its frames with');

    // ── in-page helpers: select a card, the turntable drive, the recorder ──
    await page.evaluate(() => {
      const canvas = window.__wildshard.world.game.renderer.domElement;
      const q = (s) => document.querySelector(s);
      let raf = 0;
      window.__spin = {
        canvas,
        /** the real UI path: ‹ Catalog (when a model is up), then the model's card, then (`id@n`) its n-th variant chip */
        select(spec) {
          const [id, v] = spec.split('@');
          const view = q('.ws-x-models')?.dataset.view;
          if (view === 'model') q('.ws-x-back')?.click();
          const card = [...document.querySelectorAll('.ws-x-grid .ws-x-model')].find((c) => c.dataset.id === id);
          if (!card) return false;
          card.click();
          if (v !== undefined) {
            const chip = Number(v) >= 1 ? [...document.querySelectorAll('.ws-x-variants button')].at(Number(v) - 1) : undefined;
            if (!chip) return false;
            chip.click();
          }
          return q('.ws-x-models')?.dataset.view === 'model';
        },
        /** what the sheet says about the model on show */
        facts() {
          const t = (s) => (q(s)?.textContent ?? '').trim();
          return { name: t('.ws-x-name'), variant: t('.ws-x-variants button.on'), file: t('.ws-x-file'), tris: t('.ws-x-stats b[data-s="tris"]'), calls: t('.ws-x-stats b[data-s="calls"]'), build: t('.ws-x-stats b[data-s="build"]'), budget: t('.ws-x-budget span') };
        },
        /** the camera's azimuth round what it looks at: the turntable's yaw (camera = target + (sin yaw, …, cos yaw) · d) */
        yaw() {
          const c = window.__wildshard.world.game.camera, e = c.matrixWorld.elements;
          return Math.atan2(e[8], e[10]); // the camera's +Z (backwards) axis, horizontal part
        },
        /** hold a finger on the canvas and slide it: `px` of drag spread evenly over `ms` of wall clock */
        spin(px, ms) {
          const x0 = innerWidth / 2, y0 = innerHeight * 0.4, id = 77;
          const ev = (type, x) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y0, bubbles: true, cancelable: true });
          canvas.dispatchEvent(ev('pointerdown', x0));
          const start = performance.now();
          let last = this.yaw(), turned = 0;
          const tick = () => {
            const k = Math.min(1, (performance.now() - start) / ms);
            window.dispatchEvent(ev('pointermove', x0 - px * k));
            const y = this.yaw(); let d = y - last; last = y;
            if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
            turned += d;
            this.turned = turned;
            if (k < 1) raf = requestAnimationFrame(tick);
          };
          this.turned = 0;
          raf = requestAnimationFrame(tick);
          this.release = () => { cancelAnimationFrame(raf); window.dispatchEvent(ev('pointerup', x0 - px)); };
        },
        release() { /* set by spin */ },
        turned: 0,
        /** every frame the game draws → an opaque canvas over black (the phone's view: Nine Dragon keeps depth in alpha,
         *  E289) → one video frame. The copy is the game's own captureFrame, taken in the same task as composer.render. */
        record() {
          const game = window.__wildshard.world.game;
          const w = canvas.width, h = canvas.height;
          const flat = document.createElement('canvas'); flat.width = w; flat.height = h;
          const g = flat.getContext('2d', { alpha: false });
          const stream = flat.captureStream(0);
          const [track] = stream.getVideoTracks();
          const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
          const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
          const parts = [];
          let frames = 0;
          const state = { on: true };
          const live = () => state.on; // (a call: the recorder's stop flips it between awaits)
          const pull = async () => {
            while (live()) {
              const c = await game.captureFrame(w);
              if (!live()) return;
              g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
              g.drawImage(c, 0, 0, w, h);
              track.requestFrame();
              frames++;
            }
          };
          rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
          const started = new Promise((resolve) => { rec.onstart = resolve; });
          rec.start(250);
          void pull();
          this.rec = { rec, parts, frames: () => frames, off: () => { state.on = false; }, size: [w, h] };
          return started.then(() => true);
        },
        /** the explorer's DOM on its own: canvas hidden, page background transparent (for a screenshot) */
        bare(on, label) {
          canvas.style.visibility = on ? 'hidden' : '';
          for (const el of [document.documentElement, document.body]) el.style.setProperty('background', on ? 'transparent' : '', on ? 'important' : '');
          q('.ws-spin-count')?.remove();
          if (on && label !== '') {
            const chip = document.createElement('div');
            chip.className = 'ws-spin-count';
            chip.textContent = label;
            // right-aligned just above the bottom sheet: clear of the view / light rows (top) and the variant chips (left)
            const sheetTop = q('.ws-x-sheet')?.getBoundingClientRect().top ?? innerHeight * 0.75;
            Object.assign(chip.style, { position: 'fixed', right: '12px', bottom: `${Math.round(innerHeight - sheetTop + 10)}px`, zIndex: '99999', padding: '5px 9px', font: '600 11px/1 ui-monospace, Menlo, monospace', letterSpacing: '0.14em', color: '#8fe3ff', background: 'rgba(13, 27, 38, 0.8)', border: '1px solid rgba(143, 227, 255, 0.55)' });
            document.body.append(chip);
          }
        },
      };
    });

    const segments = [];
    for (const [i, id] of ids.entries()) {
      const ok = await page.evaluate((m) => window.__spin.select(m), id);
      if (!ok) die(`could not open ${id} on the turntable`);
      // let it build (a batch member or a GLB is built on first view; ws:model-ready swaps a loaded GLB in) and settle
      let facts = await page.evaluate(() => window.__spin.facts());
      for (let n = 0, prev = ''; n < 16; n++) {
        await sleep(500);
        facts = await page.evaluate(() => window.__spin.facts());
        const key = `${facts.name}|${facts.tris}`;
        if (n >= 2 && key === prev && facts.tris !== '') break;
        prev = key;
      }
      // --keep: the page as the phone shows it (canvas + DOM), to check the video's frames against
      const still = join(work, `still-${i}.jpg`);
      if (KEEP) await page.screenshot({ path: still, type: 'jpeg', quality: 85 });
      // the explorer's overlay for this model, as it draws it
      const label = ids.length > 1 ? `${i + 1} / ${ids.length}` : '';
      await page.evaluate((l) => { window.__spin.bare(true, l); }, label);
      await sleep(120);
      const overlay = join(work, `overlay-${i}.png`);
      await page.screenshot({ path: overlay, omitBackground: true });
      await page.evaluate(() => { window.__spin.bare(false, ''); });
      await sleep(250);
      // spin + record
      await page.evaluate(() => window.__spin.record());
      await page.evaluate(([px, ms]) => { window.__spin.spin(px, ms); }, [(TURNS * Math.PI * 2) / RAD_PER_PX, seg * 1000]);
      await sleep(seg * 1000 + 120);
      const turned = await page.evaluate(() => { window.__spin.release(); return window.__spin.turned; });
      const clip = await page.evaluate(stopSpinRecording), { size, drawn } = clip;
      const webm = join(work, `seg-${i}.webm`);
      try {
        const sink = await browserBakeBytes(page, { maxBytes: Math.max(1, clip.bytes), maxFiles: 1 });
        try {
          await page.evaluate(uploadRecordedClip, { source: clip.url, destination: `${sink.url}clip` });
          const bytes = sink.take('clip');
          if (bytes.byteLength !== clip.bytes) throw new SpinError('Recorded clip byte count changed');
          writeFileSync(webm, bytes);
        } finally { await sink.dispose(); }
      } finally { await page.evaluate(source => { URL.revokeObjectURL(source); }, clip.url); }
      const deg = Math.round((Math.abs(turned) * 180) / Math.PI);
      console.log(`model-spin: ${i + 1}/${ids.length} ${id} — ${facts.name}${facts.variant !== '' ? ` (${facts.variant})` : ''} · ${facts.tris} tris · ${facts.calls} calls · build ${facts.build} · turned ${deg}° · ${Math.round(drawn / seg)} fps drawn · ${facts.file}`);
      if (Math.abs(deg - TURNS * 360) > 20) console.log(`model-spin:   the turntable turned ${deg}°, not ${TURNS * 360}° (did ModelExplorer's drag rate change from ${RAD_PER_PX} rad/px?)`);
      if (drawn < seg * 10) console.log(`model-spin:   only ${drawn} frames drawn in ${seg.toFixed(1)} s: the clip will stutter (a busy machine? scripts/browser-lane.sh status)`);
      segments.push({ id, facts, webm, overlay, still, size, deg });
    }

    // ── compose: each segment + its overlay, cut to its share, concatenated; the phone encode ──
    const [cw, ch] = segments[0]?.size ?? [0, 0];
    const W = Math.floor(cw / 2) * 2, H = Math.floor(ch / 2) * 2;
    const inputs = segments.flatMap((s) => ['-i', s.webm, '-i', s.overlay]);
    const chains = segments.map((_, i) => `[${i * 2}:v]trim=duration=${seg.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1[v${i}];`
      + `[${i * 2 + 1}:v]scale=${W}:${H}:flags=lanczos,format=rgba[o${i}];[v${i}][o${i}]overlay=0:0:eof_action=repeat,format=yuv420p[s${i}]`);
    const filter = `${chains.join(';')};${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[out]`;
    const out = resolvePath(OUT);
    mkdirSync(dirname(out), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high',
      '-b:v', '4500k', '-maxrate', '5000k', '-bufsize', '9000k', '-r', String(FPS), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,nb_frames', '-of', 'json', out]).toString());
    const mb = statSync(out).size / 1e6;
    console.log(`model-spin: wrote ${out} — ${probe.streams?.[0]?.width}×${probe.streams?.[0]?.height}, ${Number(probe.format?.duration ?? 0).toFixed(1)} s, ${mb.toFixed(1)} MB`);
    if (mb > 30) console.log('model-spin: over 30 MB — SendUserFile will silently drop it; use fewer --seconds');
    if (KEEP) {
      const master = `${out.replace(/\.mp4$/u, '')}-master`;
      mkdirSync(master, { recursive: true });
      for (const s of segments) { execFileSync('cp', [s.webm, s.overlay, s.still, master]); }
      console.log(`model-spin: master segments, overlays and stills in ${master}`);
    }
  }
  if (errors.length > 0) console.log(`model-spin: page errors: ${errors.slice(0, 5).join(' | ')}`);
} catch (error) {
  if (!(error instanceof SpinError)) throw error;
  console.error(`model-spin: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { rmSync(work, { recursive: true, force: true }); }
}
