#!/usr/bin/env node
// REMOTE-PLAYERS RP7 (Jake, 2026-11-12: "I need to see attack animation"), on the rig of `remote-gait-proof.mjs`: two phones in
// one Driftwood room. Jimmy stands 3.5 m in front of Jake, side-on to Jake, his sword arm toward him, taps once
// (attack) and then holds and lets go a heavy. Jake's page must read Jimmy's `attack` as `tap`, then `heavy`; his sword must be
// in his right hand and out of its rest 150 ms into each, and the heavy's arc (how far the blade turns from the windup to the
// end of the slash, measured from Jimmy's bones on Jake's page) must be wider than the tap's. Captures: Jake's page with
// each strike held at 150 ms, plus Jimmy standing before them.
//   WS_RIG_PORTS=18856 scripts/browser-lane.sh --max 15 node scripts/remote-strike-proof.mjs <app dist stamped with http://127.0.0.1:18859/release.json> <work dir> <key.json> [--shots=<dir>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-strike-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
/** How far in front of Jake Jimmy stands, and how far he turns from facing Jake (radians): side-on, so the arc shows. */
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-strike'), AHEAD = 3.5, TURN = Math.PI / 2, AT = 0.15;
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** Face a spot, turned `turn` radians off it, the eye tipped down onto a body's middle. @param {import('playwright').Page} page @param {{ x: number, z: number }} at @param {number} [turn] */
const face = (page, at, turn = 0) => page.evaluate(([x, z, off]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)) + off; player.pitch = -Math.atan2(0.5, Math.max(1, away)); }, [at.x, at.z, turn]);
/** @param {import('playwright').Page} page @param {number} forward */
const walk = (page, forward) => page.evaluate(y => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = false; }, forward);
/** Walk a page to a spot. @param {import('playwright').Page} page @param {{ x: number, z: number }} spot */
const walkTo = async (page, spot) => {
  for (let i = 0; i < 300; i++) {
    const at = await where(page);
    if (Math.hypot(at.x - spot.x, at.z - spot.z) < 0.3) break;
    await face(page, spot); await walk(page, Math.hypot(at.x - spot.x, at.z - spot.z) < 1.5 ? 0.4 : 1); await page.waitForTimeout(80);
  }
  await walk(page, 0);
};
/** @param {import('playwright').Page} page @param {string} action */
const press = (page, action) => page.evaluate(name => { /** @type {any} */ (window).__wildshard.world.game.app.input.press(name); }, action);
/**
 * On Jake's page, from the frame Jimmy's `attack` turns to `kind` until it ends: each frame's blade (the sword's tip from his
 * right shoulder, in his own space) and how far into the strike it is. In the first frame `at` seconds in, the page's strikes
 * are held still (remoteStrike.ts's pace) and this resolves, for the proof to shoot; `resume` lets them go and samples on to
 * the strike's end. Each look runs after the game's own frame (asked for from a later task).
 * @param {import('playwright').Page} page @param {string} kind
 */
const record = (page, kind) => page.evaluate(([want, at]) => new Promise(resolve => {
  const w = /** @type {any} */ (window), scene = w.__wildshard.world.game.rootScene;
  // Strikes held still while the proof shoots (remoteStrike.ts's pace, 0 holds every strike where it is).
  const PACE = Symbol.for('wildshard.remoteStrike.pace');
  /** @param {boolean} on */
  const pause = on => { /** @type {any} */ (globalThis)[PACE] = on ? 0 : 1; }, clock = { pause };
  const state = { samples: /** @type {{ t: number, blade: number[], attack: string, held: boolean }[]} */ ([]), seen: /** @type {string[]} */ ([]), t: -1, last: 0, shot: false, timedOut: false };
  // Each look is asked for from a task after the frame's own callbacks, so in the next frame it runs after the game's.
  const later = (/** @type {FrameRequestCallback} */ run) => { setTimeout(() => { requestAnimationFrame(run); }, 0); };
  const blade = () => {
    const group = scene.getObjectByName('Player · Jimmy'), figure = group?.getObjectByName('Castaway'), mount = group?.getObjectByName('RightHandMount'), shoulder = group?.getObjectByName('RightUpperArm');
    if (figure === undefined || mount === undefined || shoulder === undefined) return null;
    group.updateMatrixWorld(true);
    const V = mount.position.constructor, tip = figure.worldToLocal(mount.localToWorld(new V(0, 0.8, 0))), from = figure.worldToLocal(shoulder.getWorldPosition(new V()));
    const d = tip.sub(from).normalize();
    return { d: [d.x, d.y, d.z], held: mount.getObjectByName('HeldItem') !== undefined };
  };
  let waited = 0;
  /** One frame's look: false once the recording is over. @param {number} now */
  const look = now => {
    const shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy'), attack = shown?.attack ?? '';
    if (attack !== '' && !state.seen.includes(attack)) state.seen.push(attack);
    if (state.t < 0 && attack !== want) { waited += 1; state.timedOut = waited > 600; return !state.timedOut; }
    state.t = state.t < 0 ? 0 : state.t + Math.min(0.1, (now - state.last) / 1000); state.last = now;
    const b = blade();
    if (b !== null) state.samples.push({ t: state.t, blade: b.d, attack, held: b.held });
    return attack === want || state.t <= 0.1;
  };
  w.__rp7 = { state, look, later, clock, blade };
  const tick = (/** @type {number} */ now) => {
    if (!look(now)) { resolve(state); return; }
    if (!state.shot && state.t >= at - 0.008) { state.shot = true; clock.pause(true); resolve(state); return; }
    later(tick);
  };
  later(tick);
}), /** @type {const} */ ([kind, AT]));
/** Let Jake's strikes go and sample on to the strike's end. @param {import('playwright').Page} page */
const resume = page => page.evaluate(() => new Promise(resolve => {
  const { state, look, later, clock } = /** @type {any} */ (window).__rp7;
  clock.pause(false);
  let first = true;
  const tick = (/** @type {number} */ now) => {
    if (first) { first = false; state.last = now; later(tick); return; } // the paused stretch is no strike time
    if (look(now)) later(tick); else resolve(state);
  };
  later(tick);
}));
/** @param {number[]} a @param {number[]} b */
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0))));
/** How far the blade turns between two times. @param {{ t: number, blade: number[] }[]} samples @param {number} from @param {number} to */
const arc = (samples, from, to) => { const span = samples.filter(sample => sample.t >= from && sample.t <= to); return span.reduce((sum, sample, at) => at === 0 ? 0 : sum + angle(sample.blade, span[at - 1]?.blade ?? sample.blade), 0); };
/**
 * A strike recorded on Jake's page: shot while his page holds it `AT` in, then sampled to its end; the sample at the shot.
 * @param {import('playwright').Page} page @param {any} paused @param {string} file
 */
const shoot = async (page, paused, file) => {
  const at = paused.shot ? paused.samples.at(-1) : undefined;
  if (paused.shot) { await page.waitForTimeout(150); await page.screenshot({ path: join(shots, file) }); }
  const still = paused.shot ? await page.evaluate(() => /** @type {any} */ (window).__rp7.blade()?.d ?? null) : null;
  const done = paused.shot ? await resume(page) : paused;
  return { ...done, at, held: at !== undefined && still !== null && angle(at.blade, still) < 0.01 };
};

let code = 1;
try {
  const jake = await enter('Jake'), jimmy = await enter('Jimmy');
  // Down the pier (spawn faces down it, +z): Jake a few steps on, Jimmy AHEAD further, turned so his right side faces Jake.
  const start = await where(jake.page), jakeSpot = { x: start.x, z: start.z + 3 }, jimmySpot = { x: start.x, z: start.z + 3 + AHEAD };
  await Promise.all([walkTo(jake.page, jakeSpot), walkTo(jimmy.page, jimmySpot)]);
  const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
  await face(jimmy.page, me, TURN); await face(jake.page, him); await jake.page.waitForTimeout(1500);
  note(`Jimmy ${String(AHEAD)} m in front of Jake`, Math.abs(Math.hypot(him.x - me.x, him.z - me.z) - AHEAD) < 0.8, { me, him });
  const before = (await jake.page.evaluate(() => /** @type {any} */ (window).__onlinePlayers?.() ?? [])).find((/** @type {any} */ other) => other.name === 'Jimmy');
  note('Jake reads Jimmy standing, a sword in hand, no attack playing (his first swing count is a baseline)', before?.attack === '' && typeof before?.item === 'string' && before.item !== '', before);
  await jake.page.screenshot({ path: join(shots, '0-before.png') });

  // 1. a tap
  const tapping = record(jake.page, 'tap');
  await press(jimmy.page, 'attack');
  const tap = await shoot(jake.page, await tapping, '1-tap-150ms.png');
  const tapRest = tap.samples[0]?.blade ?? [0, 0, 0];
  note('Jake reads Jimmy\'s tap', !tap.timedOut && tap.samples.some((/** @type {any} */ sample) => sample.attack === 'tap'), { frames: tap.samples.length });
  note('150 ms into the tap his sword is in his hand and mid-arc, held there for the shot', tap.held && tap.at !== undefined && tap.at.held && tap.at.t < AT + 0.03 && angle(tap.at.blade, tapRest) > 0.5, { t: tap.at?.t, out: tap.at === undefined ? null : angle(tap.at.blade, tapRest) });
  await jimmy.page.waitForTimeout(1200);

  // 2. a heavy: held on the ATTACK disc, charged, let go
  const heaving = record(jake.page, 'heavy');
  // the phone's way: a thumb held still on the ATTACK disc past HOLD_MS charges the heavy, lifting it lets the chop go
  // (TouchControls.ts; the touch-down itself is a light press first)
  const disc = await jimmy.page.evaluate(() => { const box = document.querySelector('.ws-touch-attack')?.getBoundingClientRect(); return box === undefined || box.width === 0 ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  note('Jimmy\'s phone shows its ATTACK disc', disc !== null, disc);
  if (disc !== null) {
    const touch = await jimmy.page.context().newCDPSession(jimmy.page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: disc.x, y: disc.y }] });
    await jimmy.page.waitForTimeout(1300);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
  }
  const heavy = await shoot(jake.page, await heaving, '2-heavy-150ms.png');
  const heavyRest = heavy.samples[0]?.blade ?? [0, 0, 0];
  note('Jake reads Jimmy\'s heavy', !heavy.timedOut && heavy.samples.some((/** @type {any} */ sample) => sample.attack === 'heavy'), { frames: heavy.samples.length, seen: heavy.seen });
  note('150 ms into the heavy his sword is in his hand and mid-arc, held there for the shot', heavy.held && heavy.at !== undefined && heavy.at.held && heavy.at.t < AT + 0.03 && angle(heavy.at.blade, heavyRest) > 0.5, { t: heavy.at?.t, out: heavy.at === undefined ? null : angle(heavy.at.blade, heavyRest) });
  // SweptMelee's clock: the tap's slash from 0.07 to 0.235 s, the heavy's chop from 0.06 to 0.30 s
  const tapArc = arc(tap.samples, 0.07, 0.235), heavyArc = arc(heavy.samples, 0.06, 0.3);
  note('the heavy\'s arc is wider than the tap\'s', tapArc > 0.8 && heavyArc > tapArc * 1.2, { tapArc, heavyArc });

  if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const shot of ['0-before.png', '1-tap-150ms.png', '2-heavy-150ms.png']) copyFileSync(join(shots, shot), join(keep, `rp7-${shot}`)); }
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
