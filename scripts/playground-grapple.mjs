#!/usr/bin/env node
// playground-grapple.mjs — E307: Nine Dragon ▸ Explore ▸ Grapple playground, with real taps on an iPhone-16-Pro portrait
// touch page, and the run through the course with the REAL Fei Zhua: START → P1 → P2 → BASE, then the tower's three chained
// hooks BASE → L1 → L2 → the top (FINISH).
//
// Each hop: turn to the next ring (the view, as a LOOK drag would), wait for LOCK to read GRAPPLE (the E286 relabel), tap
// LOCK (→ LOCKED, JUMP → ZIP), tap ZIP, wait until the feet are on that pad. The canvas is recorded from the first LOCK to
// the top (canvas.captureStream, the real render size) and encoded for the phone (~4.5 Mb/s). Exit 1 when a hop fails.
//
//   scripts/browser-lane.sh node scripts/playground-grapple.mjs --url=http://127.0.0.1:5173 \
//     [--out=progress/e307-playgrounds] [--video=art/explore/round-1-playgrounds/grapple-playground.mp4]
//
// It holds one of the Nine Dragon browser slots (.git/nine-dragon-browser-{1,2}.lock) like the other Nine Dragon tools.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { aimAt, bootToTitle, encodePhone, enterPlayground, flags, openHub, phonePage, sleep, startRecording, stopRecording, tap } from './playground-harness.mjs';

const { chromium } = await import('playwright');
const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const flag = flags();
const BASE = flag('url', 'http://127.0.0.1:5173');
const OUT = resolvePath(flag('out', 'progress/e307-playgrounds'));
const VIDEO = flag('video', '');
mkdirSync(OUT, { recursive: true });

// ── a Nine Dragon browser slot ──
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function takeSlot() {
  for (;;) {
    for (const n of [1, 2]) {
      const p = join(ROOT, `.git/nine-dragon-browser-${n}.lock`);
      if (existsSync(p)) {
        const pid = Number(readFileSync(p, 'utf8').trim());
        if (pid && alive(pid)) continue;
        try { unlinkSync(p); } catch { /* raced */ }
      }
      try { const fd = openSync(p, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd); return p; } catch { /* raced */ }
    }
    await sleep(5000);
  }
}
const slot = await takeSlot();
const releaseSlot = () => { try { if (readFileSync(slot, 'utf8').trim() === String(process.pid)) unlinkSync(slot); } catch { /* gone */ } };
process.on('exit', releaseSlot);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { releaseSlot(); process.exit(1); });

const HOPS = ['p1', 'p2', 'base', 'l1', 'l2', 'top']; // the run's hooks, in HOOKS order (grappleCourse.ts)
/** @type {{ ok: boolean, hub: unknown, hops: Record<string, unknown>[], errors: string[], perf: Record<string, number> | null, video: Record<string, unknown> | null, end?: unknown, exit?: { menu: { sub: string, exit: string }, left: boolean, back: boolean } }} */
const report = { ok: false, hub: null, hops: [], errors: [], perf: null, video: null };
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await phonePage(browser);
  page.on('pageerror', (e) => { report.errors.push(e.message.slice(0, 240)); console.log(`pageerror: ${e.message.slice(0, 240)}`); });
  // a shader that fails to compile (the rope, the ring, the hook) is only a console error in three.js: it fails the run
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && /WebGLProgram|Shader Error/.test(t)) { report.errors.push(t.slice(0, 240)); console.log(`shader: ${t.slice(0, 240)}`); } });
  const boot = await bootToTitle(page, BASE, 'nine-dragon-stack');
  console.log(`title in ${boot} s`);
  report.hub = await openHub(page);
  console.log(`hub: ${JSON.stringify(report.hub)}`);
  await page.screenshot({ path: join(OUT, 'nine-dragon-hub.jpg'), type: 'jpeg', quality: 86 });
  await enterPlayground(page, 'grapple');
  const state = () => page.evaluate(() => {
    const w = window.__wildshard?.world, p = w.player.position, pg = w.playground();
    const vis = (el) => el !== null && getComputedStyle(el).display !== 'none';
    const lock = document.querySelector('.ws-touch-disc.lock'), jump = document.querySelector('.ws-touch-disc.jump');
    return {
      pos: [p.x, p.y, p.z].map((v) => Number(v.toFixed(2))), onGround: w.player.onGround,
      pad: pg?.padUnder?.()?.id ?? null,
      chip: document.querySelector('.ws-pg')?.textContent ?? '', hookChip: vis(document.querySelector('.ws-dragon-hook')) ? document.querySelector('.ws-dragon-hook').textContent : null,
      marks: [...document.querySelectorAll('.ws-dragon-mark')].filter(vis).length,
      lock: lock?.querySelector('span')?.textContent ?? null, jump: jump?.querySelector('span')?.textContent ?? null,
      calls: w.game.lastFrame.calls, tris: w.game.lastFrame.triangles, fps: w.game.stats.fps,
    };
  });
  await sleep(1500);
  const start = await state();
  console.log(`start: ${JSON.stringify(start)}`);
  report.perf = { calls: start.calls, tris: start.tris };
  await page.screenshot({ path: join(OUT, 'grapple-1-start.jpg'), type: 'jpeg', quality: 86 });
  const hooks = await page.evaluate(() => window.__wildshard.world.playground().hooks.map((h) => [h.x, h.y, h.z]));
  if (VIDEO) await startRecording(page);
  for (let i = 0; i < HOPS.length; i++) {
    const to = HOPS[i], hook = hooks[i];
    const hop = { to, ok: false };
    report.hops.push(hop);
    await aimAt(page, hook);
    // wait for the relabel: LOCK reads GRAPPLE once this ring is the candidate
    let ready = null;
    for (let k = 0; k < 40 && ready === null; k++) { await sleep(100); const s = await state(); if (s.lock === 'Grapple') ready = s; }
    if (ready === null) { hop.error = 'LOCK never read GRAPPLE'; hop.at = await state(); console.log(JSON.stringify(hop)); break; }
    hop.grapple = { marks: ready.marks, chip: ready.hookChip };
    await tap(page, '.ws-touch-disc.lock');
    await sleep(250);
    const locked = await state();
    hop.locked = { lock: locked.lock, jump: locked.jump, chip: locked.hookChip };
    if (locked.jump !== 'Zip') { hop.error = `after LOCK: ${locked.lock} / ${locked.jump}`; console.log(JSON.stringify(hop)); break; }
    await tap(page, '.ws-touch-disc.jump');
    const t0 = Date.now();
    if (to === 'l1') { await sleep(520); await page.screenshot({ path: join(OUT, 'grapple-2-mid-zip.jpg'), type: 'jpeg', quality: 86 }); }
    let landed = null;
    for (let k = 0; k < 60 && landed === null; k++) { await sleep(100); const s = await state(); if (s.pad === to && s.onGround) landed = s; }
    hop.ms = Date.now() - t0;
    if (landed === null) { hop.error = `never stood on ${to}`; hop.at = await state(); console.log(JSON.stringify(hop)); break; }
    hop.ok = true; hop.pos = landed.pos; hop.chip = landed.chip;
    console.log(`hop → ${to}: ${hop.ms} ms, at ${landed.pos.join(', ')} · ${landed.chip}`);
    await sleep(600);
  }
  const end = await state();
  report.end = end;
  report.ok = report.hops.length === HOPS.length && report.hops.every((h) => h.ok) && end.pad === 'top' && /FINISH/.test(end.chip);
  // the top: look back down the course, over the tower's ledges toward START
  await aimAt(page, hooks[6]);
  await page.evaluate(() => { window.__wildshard.world.player.pitch -= 0.12; });
  await sleep(1200);
  await page.screenshot({ path: join(OUT, 'grapple-3-top.jpg'), type: 'jpeg', quality: 86 });
  const top = await state();
  report.perf = { ...report.perf, topCalls: top.calls, topTris: top.tris, fps: top.fps };
  // pause ▸ the menu names the room and exits to Explore's hub; the card again puts you back on START, the clock reset
  if (!VIDEO) {
    await tap(page, '.ws-touch-pause');
    await page.waitForFunction(() => document.querySelector('.ws-gmenu-exit') !== null && getComputedStyle(document.querySelector('.ws-gmenu-exit')).display !== 'none', undefined, { timeout: 8000, polling: 100 });
    await sleep(500);
    const menu = await page.evaluate(() => ({ sub: document.querySelector('.ws-gmenu-sub')?.textContent ?? '', exit: document.querySelector('.ws-gmenu-exit')?.getAttribute('aria-label') ?? '' }));
    await page.screenshot({ path: join(OUT, 'grapple-4-pause.jpg'), type: 'jpeg', quality: 86 });
    await tap(page, '.ws-gmenu-exit');
    await page.waitForFunction(() => document.querySelector('.ws-x.show[data-mode="hub"]') !== null, undefined, { timeout: 30000, polling: 250 });
    const out = await page.evaluate(() => window.__wildshard.world.playground()?.entered ?? null);
    await sleep(1000);
    await enterPlayground(page, 'grapple');
    const again = await state();
    report.exit = { menu, left: out !== true, back: again.pad === 'start' && /READY/.test(again.chip) };
    report.ok &&= report.exit.left && report.exit.back && menu.sub === 'Grapple playground' && menu.exit === 'Exit to Explore';
    console.log(`exit: ${JSON.stringify(report.exit)}`);
  }
  if (VIDEO) {
    await sleep(800);
    const webm = join(OUT, 'grapple-run.webm');
    const size = await stopRecording(page, webm);
    const mp4 = resolvePath(VIDEO);
    mkdirSync(dirname(mp4), { recursive: true });
    report.video = { canvas: size, ...encodePhone(webm, mp4), file: mp4 };
  }
} catch (error) {
  report.errors.push(String(error).slice(0, 400));
  console.log(`error: ${String(error).slice(0, 400)}`);
} finally {
  await browser.close();
}
if (report.errors.some((e) => /WebGLProgram|Shader Error/.test(e))) report.ok = false;
writeFileSync(join(OUT, 'grapple-report.json'), JSON.stringify(report, null, 2));
console.log(`${report.ok ? 'PASS' : 'FAIL'}  grapple playground: ${report.hops.filter((h) => h.ok).length}/${HOPS.length} hops · ${JSON.stringify(report.perf)}${report.video ? ` · video ${report.video.file}` : ''}`);
process.exit(report.ok ? 0 : 1);
