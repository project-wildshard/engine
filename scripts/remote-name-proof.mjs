#!/usr/bin/env node
// REMOTE-PLAYERS RP12 (Jake, 2026-11-12: Jimmy had "a blurred name"), on the rig of `remote-board-proof.mjs`: two phones
// (402×874, 3 device px a CSS px) in one Driftwood room. Both walk off the pier onto the sand; Jimmy walks on from Jake, who keeps
// him in frame, and stops at 3 m, 15 m and 40 m. At each, Jake's page captures him, the tag's bounds are projected onto the
// screen, and a crop of them must hold white text on its dark plate (a pixel check) and OCR to "Jimmy" (tesseract, when it is on
// the machine). Its height on screen must sit between the clamps and its foot over Jimmy's crown. Then Jimmy walks on to 70 m
// and Jake's `__onlinePlayers()` must report the tag hidden.
//   scripts/browser-lane.sh --max 15 node scripts/remote-name-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-name-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
/** Both walk OFF metres off the pier; Jimmy stops at each of STOPS metres from Jake, then walks on to GONE. The clamps are nameTag.ts's. */
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-name'), OFF = 30, STOPS = [3, 15, 40], GONE = 70, MIN_PX = 16, MAX_PX = 28;
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
const ocr = spawnSync('tesseract', ['--version'], { encoding: 'utf8' }).status === 0;

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874 at 3×, the iPhone 17 Pro's points and density
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z }; });
/** @param {import('playwright').Page} page @param {number} forward @param {boolean} [sprint] */
const walk = (page, forward, sprint = false) => page.evaluate(([y, run]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = run; }, /** @type {const} */ ([forward, sprint]));
/** Jake's page: Jimmy as drawn (his row's report with the tag's), the tag's bounds on screen in CSS px, and the drawn gap in metres.
 *  @param {import('playwright').Page} page @returns {Promise<any>} */
const tagOf = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), { player, game } = w.__wildshard.world;
  const shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy') ?? null, group = game.rootScene.getObjectByName('Player · Jimmy');
  const tag = group?.getObjectByName('Name');
  if (group === undefined || tag === undefined || shown === null) return { shown, box: null };
  const { camera } = game, width = innerWidth, height = innerHeight, foot = tag.getWorldPosition(tag.position.clone());
  // A sprite faces the camera: its quad spans the camera's right and up axes, from its foot (its anchor) up.
  const across = foot.clone().setFromMatrixColumn(camera.matrixWorld, 0).normalize(), up = foot.clone().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  /** @param {number} dx @param {number} dy */
  const corner = (dx, dy) => { const at = foot.clone().addScaledVector(across, dx * tag.scale.x).addScaledVector(up, dy * tag.scale.y).project(camera); return { x: ((at.x + 1) / 2) * width, y: ((1 - at.y) / 2) * height }; };
  const left = corner(-0.5, 0), right = corner(0.5, 1);
  return {
    shown, gap: Math.hypot(player.position.x - group.position.x, player.position.z - group.position.z), visible: tag.visible,
    box: { x: Math.min(left.x, right.x), y: Math.min(left.y, right.y), width: Math.abs(right.x - left.x), height: Math.abs(left.y - right.y) },
  };
});

/** A crop of the tag's bounds from a capture: its plate's share of light (letters) and dark pixels, and what tesseract reads in it.
 *  @param {string} file @param {{ x: number, y: number, width: number, height: number }} box @param {string} out */
async function read(file, box, out) {
  const scale = 3, pad = 2, left = Math.max(0, Math.floor((box.x - pad) * scale)), top = Math.max(0, Math.floor((box.y - pad) * scale));
  const { width: wide, height: tall } = await sharp(file).metadata();
  const width = Math.min((wide ?? 0) - left, Math.ceil((box.width + pad * 2) * scale)), height = Math.min((tall ?? 0) - top, Math.ceil((box.height + pad * 2) * scale));
  const crop = sharp(file).extract({ left, top, width, height });
  await crop.clone().png().toFile(out);
  // Inside the plate (its rounded ends and rim trimmed): light letters on a dark plate, by luminance.
  const inner = sharp(file).extract({ left: left + Math.round(height * 0.35), top: top + Math.round(height * 0.2), width: Math.max(1, width - Math.round(height * 0.7)), height: Math.max(1, Math.round(height * 0.6)) });
  const { data, info } = await inner.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  let light = 0, dark = 0;
  for (const value of data) { if (value > 180) light++; else if (value < 80) dark++; }
  let text = '';
  if (ocr) {
    const big = `${out}.ocr.png`;
    await inner.clone().greyscale().resize({ height: 160, kernel: 'lanczos3' }).threshold(150).negate().extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#fff' }).png().toFile(big);
    text = spawnSync('tesseract', [big, '-', '--psm', '7'], { encoding: 'utf8' }).stdout.trim();
  }
  const pixels = info.width * info.height;
  return { device: { width, height }, light: light / pixels, dark: dark / pixels, text };
}

let code = 1;
try {
  const jake = await enter('Jake'), jimmy = await enter('Jimmy');
  const start = await where(jake.page);
  for (let i = 0; i < 200; i++) {
    const at = await where(jake.page);
    if (Math.hypot(at.x - start.x, at.z - start.z) >= OFF) break;
    await Promise.all([walk(jake.page, 1), walk(jimmy.page, 1)]); await jake.page.waitForTimeout(100);
  }
  await Promise.all([walk(jake.page, 0), walk(jimmy.page, 0)]);
  // Jake keeps Jimmy in frame every frame, his eye on Jimmy's middle, so the tag sits over the crosshair, clear of it.
  await jake.page.evaluate(() => {
    const w = /** @type {any} */ (window), { player, game } = w.__wildshard.world;
    const aim = () => { const group = game.rootScene.getObjectByName('Player · Jimmy'); if (group !== undefined) { const dx = group.position.x - player.position.x, dz = group.position.z - player.position.z, away = Math.hypot(dx, dz); player.yaw = Math.atan2(-dx, -dz); const eye = game.camera.getWorldPosition(group.position.clone()); player.pitch = Math.atan2(group.position.y + 0.9 - eye.y, Math.max(1, away)); } w.__rp12Aim = requestAnimationFrame(aim); };
    aim();
  });
  for (const metres of STOPS) {
    for (let i = 0; i < 400; i++) {
      const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]), gap = Math.hypot(me.x - him.x, me.z - him.z);
      if (gap >= metres - 0.15) break;
      await walk(jimmy.page, metres - gap > 4 ? 1 : 0.5); await jimmy.page.waitForTimeout(metres - gap > 4 ? 100 : 40);
    }
    await walk(jimmy.page, 0); await jake.page.waitForTimeout(1200);
    const seen = await tagOf(jake.page), shot = join(shots, `${String(metres)}m.png`);
    if (metres === STOPS[0]) console.log(`Jake's page draws at ${String(await jake.page.evaluate(() => /** @type {any} */ (window).__wildshard.world.game.renderer.getPixelRatio()))} device px a CSS px`);
    await jake.page.screenshot({ path: shot });
    const tag = seen.shown?.tag;
    note(`at ${String(metres)} m Jake's page shows Jimmy's Name`, tag?.shown === true && seen.box !== null && seen.box.width > 0, { gap: seen.gap, tag });
    note(`at ${String(metres)} m its height on screen is within ${String(MIN_PX)}–${String(MAX_PX)} CSS px`, seen.box !== null && seen.box.height >= MIN_PX - 1 && seen.box.height <= MAX_PX + 1, seen.box);
    note(`at ${String(metres)} m its foot stands clear of his crown`, tag !== undefined && tag.bottom - tag.crown >= 0.15 - 1e-3, tag === undefined ? null : { crown: tag.crown, bottom: tag.bottom });
    if (seen.box !== null) {
      const crop = join(shots, `${String(metres)}m-tag.png`), got = await read(shot, seen.box, crop);
      note(`at ${String(metres)} m the tag's bounds hold white text on its dark plate`, got.light > 0.08 && got.dark > 0.3, got);
      if (ocr) note(`at ${String(metres)} m it reads "Jimmy"`, /jimmy/iu.test(got.text), got.text);
    }
  }
  for (let i = 0; i < 400; i++) {
    const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
    if (Math.hypot(me.x - him.x, me.z - him.z) >= GONE + 0.5) break;
    // Jimmy sprints on and Jake backs away down the open path they came by, so the gap opens past any slope that stops Jimmy.
    await Promise.all([walk(jimmy.page, 1, true), walk(jake.page, -1)]); await jimmy.page.waitForTimeout(100);
  }
  await Promise.all([walk(jimmy.page, 0), walk(jake.page, 0)]); await jake.page.waitForTimeout(1200);
  const gone = await tagOf(jake.page);
  note(`at ${String(GONE)} m Jake's __onlinePlayers() reports Jimmy's Name hidden`, gone.shown !== null && gone.shown.tag?.shown === false && gone.gap > 60, { gap: gone.gap, tag: gone.shown?.tag });
  await jake.page.screenshot({ path: join(shots, `${String(GONE)}m.png`) });
  await jake.page.evaluate(() => { cancelAnimationFrame(/** @type {any} */ (window).__rp12Aim); });

  if (keep !== '') {
    mkdirSync(keep, { recursive: true });
    for (const shot of [...STOPS.flatMap(metres => [`${String(metres)}m.png`, `${String(metres)}m-tag.png`]), `${String(GONE)}m.png`]) { try { copyFileSync(join(shots, shot), join(keep, `rp12-${shot}`)); } catch { note(`capture ${shot} kept`, false); } }
  }
  /** @param {string} line */
  const quiet = line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line), faults = [...jake.errors, ...jimmy.errors].filter(quiet);
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  await launched.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
