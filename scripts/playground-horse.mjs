#!/usr/bin/env node
// playground-horse.mjs — E307: Nalati ▸ Explore ▸ Horse playground, with real taps on an iPhone-16-Pro portrait touch page,
// and half a lap on the REAL riding (Mount.ts via Nalati's ride.ts).
//
// Title → EXPLORE WORLD → the hub → HORSE PLAYGROUND (taps) → the saddled horse waits on the start: tap USE (Mount Track
// horse) → a real touch drag on the MOVE stick, pushed full forward (a canter) for 4 s over the start line → the stick let
// go: the horse keeps its gait round the oval on its own (B1's keep-to-the-road, the track is the road here) → through the
// east bend to the half-way line on the back straight. The canvas is recorded from the mount to half way
// (canvas.captureStream, the real render size) and encoded for the phone (~4.5 Mb/s). Exit 1 when it does not get there.
//
//   scripts/browser-lane.sh node scripts/playground-horse.mjs --url=http://127.0.0.1:5173 \
//     [--out=progress/e307-playgrounds] [--video=art/explore/round-1-playgrounds/horse-playground.mp4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { bootToTitle, encodePhone, enterPlayground, flags, openHub, phonePage, sleep, startRecording, stopRecording, tap } from './playground-harness.mjs';

const { chromium } = await import('playwright');
const flag = flags();
const BASE = flag('url', 'http://127.0.0.1:5173');
const OUT = resolvePath(flag('out', 'progress/e307-playgrounds'));
const VIDEO = flag('video', '');
mkdirSync(OUT, { recursive: true });

/** @type {{ ok: boolean, hub: unknown, errors: string[], steps: Record<string, unknown>[], perf: Record<string, number> | null, video: Record<string, unknown> | null }} */
const report = { ok: false, hub: null, errors: [], steps: [], perf: null, video: null };
const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  // the riding rows at their defaults (keep to the road on: the track is the road)
  const page = await phonePage(browser, { rideRoad: 'on', rideSpur: 'on', rideSkid: 'on', ridePanic: 'on' });
  page.on('pageerror', (e) => { report.errors.push(e.message.slice(0, 240)); console.log(`pageerror: ${e.message.slice(0, 240)}`); });
  console.log(`title in ${await bootToTitle(page, BASE, 'nalati-grasslands')} s`);
  report.hub = await openHub(page);
  console.log(`hub: ${JSON.stringify(report.hub)}`);
  await page.screenshot({ path: join(OUT, 'nalati-hub.jpg'), type: 'jpeg', quality: 86 });
  await enterPlayground(page, 'horse');
  const state = () => page.evaluate(() => {
    const w = window.__wildshard?.world, p = w.player.position, m = w.ride.mount, pg = w.playground();
    const h = m.horse;
    return {
      pos: [p.x, p.y, p.z].map((v) => Number(v.toFixed(1))), mounted: w.ride.mounted, gait: m.gait, onRoad: m.onRoad,
      speed: h === null ? 0 : Number(h.speed.toFixed(1)), local: pg === null ? null : [p.x - pg.center.x, p.z - pg.center.z].map((v) => Number(v.toFixed(1))),
      use: document.querySelector('.ws-touch-use')?.textContent.trim() ?? '', chip: document.querySelector('.ws-pg')?.textContent ?? '',
      calls: w.game.lastFrame.calls, tris: w.game.lastFrame.triangles, fps: w.game.stats.fps,
    };
  });
  await sleep(2500);
  const start = await state();
  report.steps.push({ at: 'start', ...start });
  report.perf = { calls: start.calls, tris: start.tris };
  console.log(`start: ${JSON.stringify(start)}`);
  await page.screenshot({ path: join(OUT, 'horse-1-start.jpg'), type: 'jpeg', quality: 86 });
  // mount: the USE band reads "Mount Track horse"
  await tap(page, '.ws-touch-use');
  await page.waitForFunction(() => window.__wildshard.world.ride.mounted === true, undefined, { timeout: 8000, polling: 100 });
  await sleep(1200);
  const mounted = await state();
  report.steps.push({ at: 'mounted', ...mounted });
  await page.screenshot({ path: join(OUT, 'horse-2-mounted.jpg'), type: 'jpeg', quality: 86 });
  if (VIDEO) await startRecording(page);
  // the MOVE stick: a real touch, dragged full forward and held
  const ring = await (await page.$('.ws-touch-stick'))?.boundingBox();
  if (!ring) throw new Error('no MOVE stick');
  const cx = ring.x + ring.width / 2, cy = ring.y + ring.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7, radiusX: 8, radiusY: 8, force: 1 }] });
  await touch('touchStart', cx, cy);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', cx, cy - k * 14); await sleep(30); }
  await sleep(4200);
  const pushed = await state();
  report.steps.push({ at: 'stick', ...pushed });
  console.log(`pushed: ${JSON.stringify(pushed)}`);
  await touch('touchEnd', cx, cy - 84);
  // let go: the track keeps the horse; wait for the east bend (a frame there), then half way
  let bend = false, half = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 70000 && half === null) {
    await sleep(250);
    const s = await state();
    if (!bend && s.local !== null && s.local[0] > 75) {
      bend = true; report.steps.push({ at: 'bend', ...s });
      await page.screenshot({ path: join(OUT, 'horse-3-track.jpg'), type: 'jpeg', quality: 86 });
    }
    if (/½/.test(s.chip)) half = s;
  }
  report.steps.push({ at: 'half', ...(half ?? await state()) });
  if (half !== null) await page.screenshot({ path: join(OUT, 'horse-4-half.jpg'), type: 'jpeg', quality: 86 });
  report.ok = half !== null && half.mounted && Math.abs((half.local?.[1] ?? 0) + 38) < 8;
  console.log(`half: ${JSON.stringify(half)} after ${Math.round((Date.now() - t0) / 1000)} s`);
  if (VIDEO) {
    await sleep(1500);
    const webm = join(OUT, 'horse-run.webm');
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
writeFileSync(join(OUT, 'horse-report.json'), JSON.stringify(report, null, 2));
console.log(`${report.ok ? 'PASS' : 'FAIL'}  horse playground: ${report.ok ? 'mounted, half a lap' : 'did not reach half way'} · ${JSON.stringify(report.perf)}${report.video ? ` · video ${report.video.file}` : ''}`);
process.exit(report.ok ? 0 : 1);
