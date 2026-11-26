#!/usr/bin/env node
// The trailer capture: deterministic in-engine frames for any trailer (docs/trailer.md). Restored from singleplayer
// scripts/steam-trailer/capture.mjs at cf104912d3^ and ported to today's client (meta ALPHA-2-TRAILER AT1).
//
//   node scripts/trailer/capture.mjs <outDir> --shots <set>[,<set>] --base <serve-build URL> [--only a,b] [--edl <edl.json>]
//        [--dry] [--sub 2] [--scale 2] [--frames N] [--wall] [--no-lock]
//
//   --shots   shot files: zone slugs under scripts/trailer/shots/ (driftwood-isle, glowfen …) or paths to .mjs files
//   --base    a served build: scripts/serve-build.sh --head (never a dev server; HMR reloads every open page)
//   --dry     the scouting pass: 3 stills per shot (first, middle, last frame), no sub-frames kept
//   --edl     write only the frames a cut uses (cut.mjs's edl.json, ±0.25 s handles); the sim still runs every frame
//   --wall    leave performance.now / Date.now on wall time (the default puts them on the capture's virtual clock)
//   --no-lock skip desktop-gpu.lock (a test); every real capture holds it (scripts/memory/iphone/locks.mjs)
//
// What makes it a trailer capture rather than a screen recording:
//   * the game's clock is in capture mode (GameClock.setCapture) and the frame gate opens for exactly one frame per step,
//     so every frame is simulated and drawn once at a fixed step, however slow the GPU is; performance.now and Date.now
//     follow the same virtual time (monotonic, advanced per drawn frame), so anything that reads wall time moves at sim speed;
//   * it renders at `scale` × 1920×1080 (Render scale native, deviceScaleFactor 2 = 3840×2160), downsampled later with
//     Lanczos (edit.mjs): supersampled anti-aliasing on every edge;
//   * each output frame is `sub` sub-frames 1/(60·sub) s apart (120 Hz at --sub 2); edit.mjs averages them (a 180° shutter);
//   * every page element but the world canvas is hidden (HUD, lock-on, chat, developer chips), the chunk boundary lines
//     too, and the viewmodel on rig shots (unless the rig says `viewmodel: true`);
//   * headless Chromium, muted, with the keychain flags (scripts/chromium-keychain.mjs), under desktop-gpu.lock.
// Frames land in <outDir>/<shot>/<nnnnnn>.jpg at 60·sub fps; <outDir>/<shot>/meta.json records the pose track and probe.
import { enterZone } from '../zone-entry.mjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { enterCell, enterGrid } from './grid.mjs';
import { bootGroups, bootUrl, loadShots, RELEASE_HELD } from './shots/lib.mjs';

// ── in-page runtime ─────────────────────────────────────────────────────────────────────────────────────────────
// Installed once per page. window.__tr.rig = { keys: [{ t, p:[x,y,z], l:[x,y,z], fov, roll }], ease } drives the camera.
export const RUNTIME = String.raw`((wall) => {
  const w = window.__wildshard.world, g = w.game, cam = g.camera;
  const tr = window.__tr = { go: 0, t: 0, rig: null, dt: 1 / 60, lastPose: null, drawn: 0, vt: 0, calls: 0 };
  // the capture clock: GameClock.setCapture(1 / dt) makes every drawn frame advance exactly dt
  tr.setStep = (dt) => { tr.dt = dt; g.app.clock.setCapture(1 / dt); };
  tr.setStep(1 / 60);
  // virtual wall time: performance.now / Date.now = boot time + the frames drawn × their step, plus 1 µs per read inside a
  // frame (a time-budgeted loop still ends), never going back
  const realPerf = performance.now.bind(performance), realDate = Date.now, p0 = realPerf(), d0 = realDate();
  let last = p0;
  tr.realNow = realPerf;
  if (!wall) {
    const vnow = () => { last = Math.max(last, p0 + tr.vt * 1000 + (tr.calls++) * 1e-3); return last; };
    performance.now = vnow;
    Date.now = () => d0 + (vnow() - p0);
  }
  // the gate: the game's own (entered, not paused, the cell ready) AND one frame asked for
  tr.gate = () => tr.go > 0 && tr.base();
  tr.base = g.frameGate; g.frameGate = tr.gate;
  // the world watch (worldWatch.ts) judges 48 px copies of the frame a few seconds after control; a rig can hold the lens
  // where no player stands (Nine Dragon's shaft, under the city: the clear colour), which it reads as an undrawn world and
  // pauses on its error card mid-shot. The capture answers its looks with a drawn grey thumbnail; larger copies pass.
  const realCaptureFrame = g.captureFrame.bind(g);
  g.captureFrame = (maxW) => { if (maxW > 64) return realCaptureFrame(maxW); const c = document.createElement('canvas'); c.width = 48; c.height = 27; const x = c.getContext('2d'); x.fillStyle = '#7f8890'; x.fillRect(0, 0, 48, 27); return Promise.resolve(c); };
  // centripetal-ish Catmull-Rom on a key array, time-parametrised, the whole move eased in-out when rig.ease
  const cr = (p0, p1, p2, p3, u) => { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); };
  const easeIO = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const sample = (keys, t, field) => {
    if (t <= keys[0].t) return Array.isArray(keys[0][field]) ? [...keys[0][field]] : keys[0][field];
    const n = keys.length; if (t >= keys[n - 1].t) return Array.isArray(keys[n - 1][field]) ? [...keys[n - 1][field]] : keys[n - 1][field];
    let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
    const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(n - 1, i + 2)];
    const u = (t - b.t) / (c.t - b.t);
    if (typeof b[field] === 'number') return cr(a[field] ?? b[field], b[field], c[field], d[field] ?? c[field], u);
    return [0, 1, 2].map((j) => cr(a[field][j], b[field][j], c[field][j], d[field][j], u));
  };
  // rel: key heights are metres above the ground (or the water, whichever is higher) at that key. On the grid the ground is
  // the active cell's (the player's frame queries, grid/liveSession.ts bind): window.__hf is the home level's heightfield,
  // which put Nalati's and the Dunes' cameras under their ground (11-25)
  tr.ground = (x, z) => {
    const q = w.player?.frameQueries;
    if (q) { const h = q.heightAt(x, z), sea = q.waterSurfaceAt(x, z); return typeof sea === 'number' ? Math.max(h, sea) : h; }
    const h = window.__hf?.heightAt?.(x, z) ?? 0, sea = w.water?.level ?? w.chunk?.ocean?.level; return typeof sea === 'number' ? Math.max(h, sea) : h;
  };
  tr.pose = (t) => {
    const r = tr.rig; if (!r) return;
    const t0 = r.keys[0].t, t1 = r.keys.at(-1).t;
    const T = r.ease ? t0 + easeIO(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) * (t1 - t0) : t;
    const p = sample(r.keys, T, 'p'), l = sample(r.keys, T, 'l');
    const fov = r.keys[0].fov !== undefined ? sample(r.keys, T, 'fov') : cam.fov;
    const roll = r.keys[0].roll !== undefined ? sample(r.keys, T, 'roll') : 0;
    // a hand-held breath: two slow incommensurate sines, a few cm and a fraction of a degree
    const hh = r.handheld ?? 0.25;
    p[0] += Math.sin(t * 0.73) * 0.03 * hh; p[1] += Math.sin(t * 1.11 + 1) * 0.025 * hh; p[2] += Math.sin(t * 0.57 + 2) * 0.03 * hh;
    cam.position.set(p[0], p[1], p[2]);
    cam.up.set(0, 1, 0); cam.lookAt(l[0], l[1], l[2]);
    cam.rotateZ(roll + Math.sin(t * 0.41) * 0.0025 * hh);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
    if (!r.viewmodel) { g.viewmodel.visible = false; for (const c of cam.children) c.visible = false; }
    tr.lastPose = { p, l, fov, roll };
  };
  tr.setRig = (rig) => {
    if (!rig) { tr.rig = null; w.freeCamera = false; return; }
    const keys = rig.keys.map((k) => ({ ...k,
      p: rig.rel ? [k.p[0], k.p[1] + tr.ground(k.p[0], k.p[2]), k.p[2]] : k.p,
      l: rig.relLook ? [k.l[0], k.l[1] + tr.ground(k.l[0], k.l[2]), k.l[2]] : k.l }));
    tr.rig = { ...rig, keys };
    w.freeCamera = true; // the player's camera lets go; the rig poses it last in every frame
  };
  // tr.hide = ['object name', …]: kept invisible every frame (their owners re-show them in update, this runs after)
  tr.hide = []; let hidden = [], hiddenKey = '';
  g.onLate(() => {
    if (tr.rig) tr.pose(tr.t);
    else tr.lastPose = { p: cam.position.toArray(), l: null, fov: cam.fov, roll: 0 };
    const key = tr.hide.join('|');
    if (key !== hiddenKey) { hiddenKey = key; hidden = tr.hide.flatMap((n) => g.scene.getObjectsByProperty('name', n)); }
    for (const o of hidden) o.visible = false;
    if (w.boundary?.group) w.boundary.group.visible = false; // the cell edge lines are a play-space cue, not scenery
    if (tr.go > 0) tr.go--;
    tr.drawn++; tr.vt += tr.dt; tr.calls = 0;
  }, 'trailer.rig');
  // one frame: open the gate for exactly one draw, then wait for it (and one more animation frame, so it is on screen)
  tr.step = () => new Promise((res) => {
    if (g.frameGate !== tr.gate) { tr.base = g.frameGate; g.frameGate = tr.gate; } // a zone entry swapped the gate in
    const want = tr.drawn + 1, start = realPerf();
    tr.go = 1; g.kickLoop();
    const wait = () => {
      if (tr.drawn >= want) requestAnimationFrame(() => res(true));
      else if (realPerf() - start > 30000) { tr.go = 0; res(false); }
      else requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  });
  // only the world canvas is drawn: every other page element (the HUD, lock-on, chat, toasts, developer chips) is hidden
  for (const el of document.querySelectorAll('canvas')) { const r = el.getBoundingClientRect(); el.dataset.trailer = r.width * r.height >= innerWidth * innerHeight / 2 ? '1' : '0'; }
  const css = document.createElement('style');
  css.textContent = 'body *{visibility:hidden!important}canvas[data-trailer="1"]{visibility:visible!important}';
  document.head.appendChild(css);
  tr.showHud = (on) => { css.disabled = !!on; };
  return 'ok';
})`;

/** Whether frame i (60 fps) of a shot is written: always without an EDL, else inside a clip that uses it plus 0.25 s handles.
 * @param {{ clips: { shot: string, in: number, dur: number }[] } | null} edl @param {string} name @param {number} i */
export function keepFrame(edl, name, i, fps = 60) {
  return !edl || edl.clips.some((c) => c.shot === name && i >= Math.floor((c.in - 0.25) * fps) && i < Math.ceil((c.in + c.dur + 0.25) * fps));
}

/** The CLI. @param {string[]} argv */
export async function main(argv) {
  const opt = (k, d) => {
    const eq = argv.find((a) => a.startsWith(`--${k}=`));
    if (eq) return eq.slice(k.length + 3);
    const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1];
  };
  const flag = (k) => argv.includes(`--${k}`);
  const OUT = argv[0];
  if (!OUT || OUT.startsWith('--') || !opt('shots', '')) {
    console.error(readFileSync(import.meta.filename, 'utf8').split('\n').slice(1, 16).map(l => l.replace(/^\/\/ ?/u, '')).join('\n'));
    return 2;
  }
  if (!flag('no-lock') && process.env.WS_TRAILER_LOCKED !== '1') {
    // every 4K capture holds the Mac's GPU lock (meta MINI-DEVEX MD2): re-run this script under it
    const { underDesktopGpuLock } = await import('../memory/iphone/locks.mjs');
    process.env.WS_TRAILER_LOCKED = '1';
    return underDesktopGpuLock(import.meta.filename, argv);
  }
  const { chromium } = await import('../browser-playwright.mjs');
  const { KEYCHAIN_ARGS } = await import('../chromium-keychain.mjs');
  const { NAME_ASKED, developerSettings, harnessPins, hideDeveloperOverlays, saveFixture } = await import('../debug-settings.mjs');

  const FPS = 60;
  const SUB = Number(opt('sub', '2'));
  const SCALE = Number(opt('scale', '2'));
  const BASE = opt('base', 'http://127.0.0.1:4400/').replace(/\/?$/u, '/');
  const ONLY = opt('only', '') ? opt('only', '').split(',') : [];
  const MAXF = Number(opt('frames', '0'));
  const DRY = flag('dry');
  const WALL = flag('wall');
  const VIEW = { width: 1920, height: 1080 };
  const EDL = opt('edl', '') ? JSON.parse(readFileSync(opt('edl', ''), 'utf8')) : null;
  const keep = (name, i) => keepFrame(EDL, name, i, FPS);
  const shots = await loadShots(opt('shots', '').split(','));
  for (const o of ONLY) if (!shots.some(s => s.name === o)) throw new Error(`--only: no shot ${o}`);



  async function boot(browser, first) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
    await developerSettings(ctx, { tier: 'desktop', volume: 0, time: first.time ?? 'live', weather: first.weather ?? 'live' });
    await saveFixture(ctx, { scope: 'global', key: 'gfx', data: { dpr: 'native', aa: 'on' } });
    await ctx.addInitScript(hideDeveloperOverlays);
    await harnessPins(ctx, { seed: 0x2545f491 });
    await saveFixture(ctx, NAME_ASKED);
    if (first.init) await ctx.addInitScript({ content: first.init });
    await ctx.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message.slice(0, 300)); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    const t0 = Date.now();
    const { grid, url } = bootUrl(BASE, first); // the grid as players see it; the zone alone only for a shot that says singleZone
    if (grid) {
      await enterGrid(page, url);
      await page.waitForFunction(() => Boolean(document.querySelector('#wserr .msg')?.textContent) || (!document.querySelector('.ws-load') && Boolean(window.__wildshard?.world?.game)), null, { timeout: 300000, polling: 500 });
      const failure = await page.evaluate(() => document.querySelector('#wserr .msg')?.textContent ?? null);
      if (failure) throw new Error(failure);
      await page.evaluate(() => window.__wildshard.requireWorld().hud.enterNow());
    } else {
      // CHUNK-PARAM CP21 (J522): the zone alone is a one-cell world of it, entered without naming it in the URL
      await enterZone(page, { zone: first.zone, base: url, flags: new URL(url).searchParams.toString(), alone: true, waitUntil: 'load' });
    }
    await page.waitForFunction(() => Boolean(window.__wildshard?.world?.hud?.entered && !document.querySelector('.ws-load') && window.__wildshard.world.game.frameGate()), undefined, { timeout: 300000, polling: 1000 });
    if (await page.evaluate(() => window.__wildshard.world.hud.paused)) await page.keyboard.press('Escape');
    if (grid) await enterCell(page, first.zone);
    await page.evaluate(`${RUNTIME}(${WALL})`);
    console.log(`[boot ${first.zone}${grid ? ' on the grid' : ' alone'} ${first.time ?? 'live'}/${first.weather ?? 'live'}] ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return { ctx, page, errors };
  }

  const done = (s) => !DRY && existsSync(`${OUT}/${s.name}/meta.json`) && JSON.parse(readFileSync(`${OUT}/${s.name}/meta.json`, 'utf8')).done === true;
  const want = shots.filter((s) => (ONLY.length === 0 || ONLY.includes(s.name)) && (!EDL || EDL.clips.some((c) => c.shot === s.name)));
  // a cut that wants more of a shot than it lasts fails here, not at the conform after an hour of capture (11-25: dn-caravan)
  for (const s of want) for (const c of EDL?.clips.filter((x) => x.shot === s.name) ?? []) {
    if (c.in + c.dur > s.secs + 1e-6) throw new Error(`${s.name}: the cut wants ${String(c.in)}+${String(c.dur)} s of a ${String(s.secs)} s shot`);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const report = [];
  try {
    for (const grp of bootGroups(want)) {
      const todo = grp.shots.filter((s) => { if (done(s)) { console.log(`[${s.name}] have it`); return false; } return true; });
      if (todo.length === 0) continue;
      const { ctx, page, errors } = await boot(browser, todo[0]);
      try {
        for (const s of todo) {
          errors.length = 0;
          const dir = resolve(OUT, s.name);
          mkdirSync(dir, { recursive: true });
          const n = MAXF > 0 ? MAXF : Math.round(s.secs * FPS);
          await page.evaluate(`(() => { const tr = window.__tr; tr.setRig(null); tr.t = 0; tr.setStep(1 / 60); tr.showHud(false); tr.hide = []; window.__wildshard.world.game.viewmodel.visible = true; ${RELEASE_HELD} })()`);
          // a boss or an elite spawns a beat into play: step the world until the shot's subject exists
          if (s.waitFor) for (let k = 0; k < 900 && !(await page.evaluate(s.waitFor)); k++) await page.evaluate('window.__tr.step()');
          if (s.setup) await page.evaluate(`(async () => { ${s.setup} })()`);
          if (s.rig) await page.evaluate((rig) => { window.__tr.setRig(rig); }, s.rig);
          // the world streams in around the first pose at 1/60 steps before the capture clock takes over
          let stalls = 0;
          for (let k = 0; k < (s.warm ?? 240); k++) {
            if (s.warmTick) await page.evaluate(`(async () => { ${s.warmTick(k)} })()`);
            if (!(await page.evaluate('window.__tr.step()'))) { stalls++; console.log(`[${s.name}] warm step ${String(k)} stalled 30 s: ${JSON.stringify(await page.evaluate('(() => { const W = window.__wildshard, g = W.world.game; return { gate: window.__tr.base(), paused: W.world.hud.paused, entered: W.world.hud.entered, load: Boolean(document.querySelector(".ws-load")), err: document.querySelector("#wserr .msg")?.textContent ?? null }; })()'))}`); }
          }
          if (s.afterWarm) await page.evaluate(`(async () => { ${s.afterWarm} })()`);
          const probe = s.probe ? await page.evaluate(s.probe) : null;
          // speed < 1 = slow motion in engine: the sim steps less per frame, every frame is real (no interpolation)
          const SP = s.speed ?? 1;
          await page.evaluate((dt) => { window.__tr.setStep(dt); }, SP / (FPS * SUB));
          const tc = Date.now();
          const picks = DRY ? new Set([0, Math.floor(n / 2), n - 1]) : null;
          let idx = 0;
          const poses = [];
          for (let i = 0; i < n; i++) {
            for (let sb = 0; sb < SUB; sb++) {
              const t = (i * SUB + sb) / (FPS * SUB) * SP;
              const tick = s.tick ? s.tick(t, i, sb, SP / (FPS * SUB)) : '';
              const drew = await page.evaluate(`(async () => { window.__tr.t = ${t}; ${tick}; return window.__tr.step(); })()`);
              if (!drew) stalls++;
              if (picks ? picks.has(i) && sb === 0 : keep(s.name, i)) {
                await page.screenshot({ path: `${dir}/${String(DRY ? i : idx).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 95 });
              }
              idx++;
            }
            if (i % 30 === 0) poses.push(await page.evaluate('window.__tr.lastPose'));
          }
          await page.evaluate('window.__tr.setStep(1 / 60)');
          const secs = (Date.now() - tc) / 1000;
          console.log(`[${s.name}] ${n} frames × ${SUB} in ${secs.toFixed(0)} s (${(secs / n).toFixed(2)} s/frame)${stalls > 0 ? `, ${stalls} stalled steps` : ''}${errors.length > 0 ? `, ${errors.length} page errors` : ''}`);
          writeFileSync(`${dir}/meta.json`, JSON.stringify({ name: s.name, zone: s.zone, time: s.time ?? 'live', weather: s.weather ?? 'live', frames: n, sub: SUB, fps: FPS, scale: SCALE, view: VIEW, base: BASE, dry: DRY, stalls, errors: [...errors], poses, probe, done: !DRY }, null, 1));
          report.push({ name: s.name, frames: n, secs, stalls, errors: errors.length });
        }
      } finally { await ctx.close(); }
    }
  } finally {
    await browser.close();
    writeFileSync(`${OUT}/capture-report-${Date.now()}.json`, JSON.stringify(report, null, 1));
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
