#!/usr/bin/env node
// REMOTE-PLAYERS RP11 (Jake, 2026-11-12 17:43: "it's an MMO ... everything, right?"), on the rig of `remote-strike-proof.mjs`:
// two phones in one Driftwood room. Jimmy walks to the nearest creature that bites and lets it kill him; Jake follows and
// watches. The server respawns Jimmy in the tick he dies (hp back up, his row at his checkpoint), so Jake's page must hold his
// body where it fell: `__onlinePlayers()` reads `death` 'fall', 'lie' (2 s), 'fade', 'gone', then 'rise' at the checkpoint and
// '' again. Each frame of Jake's page is recorded across it: the drawn body is only ever where Jimmy fell or where he came
// back, and its speed never passes 20 m/s. Captures from Jake's page: the fallen body, then nothing, then Jimmy at the
// checkpoint (from where Jake stood, and up close).
//   WS_RIG_PORTS=18880 scripts/browser-lane.sh --max 15 node scripts/remote-death-proof.mjs <app dist stamped with http://127.0.0.1:18883/release.json> <work dir> <key.json> [--shots=<dir>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-death-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
/** How far behind Jimmy Jake keeps, metres; the fastest the drawn body may move, m/s. */
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-death'), BEHIND = 7, FASTEST = 20;
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 500)}`}`); };

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z }; });
/** Face a spot, the eye tipped down onto a body's middle (or onto the ground, for one lying). @param {import('playwright').Page} page @param {{ x: number, z: number }} at @param {number} [lift] */
const face = (page, at, lift = 0.5) => page.evaluate(([x, z, up]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -Math.atan2(1.5 - up, Math.max(1, away)); }, [at.x, at.z, lift]);
/** @param {import('playwright').Page} page @param {number} forward @param {boolean} [sprint] */
const walk = (page, forward, sprint = false) => page.evaluate(([y, run]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = run; }, /** @type {const} */ ([forward, sprint]));
/** @param {import('playwright').Page} page @returns {Promise<{ hp: number, falls: number }>} */
const report = page => page.evaluate(() => { const r = /** @type {any} */ (window).__workerClient(); return { hp: r.hp, falls: r.falls }; });
/** Jimmy as Jake's page shows him. @param {import('playwright').Page} page */
const jimmyOn = page => page.evaluate(() => (/** @type {any} */ (window).__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy') ?? null);
/** The live creatures that bite on this page, nearest first. @param {import('playwright').Page} page */
const biters = page => page.evaluate(() => {
  const { world } = /** @type {any} */ (window).__wildshard, { player } = world;
  const live = /** @type {any[]} */ (world.animals?.animals ?? []).filter(body => body.alive && body.rowDriven && !body.hidden);
  return live.map(body => ({ kind: String(body.kind), hp: Number(body.hp), maxHp: Number(body.maxHp), x: body.position.x, z: body.position.z, away: Math.hypot(body.position.x - player.position.x, body.position.z - player.position.z) })).sort((a, b) => a.away - b.away);
});

/**
 * On Jake's page, every frame from now: Jimmy's death phase, where his body is drawn and its speed, as `__onlinePlayers()`
 * says; read back with `__rp11.frames`. Each look runs after the game's own frame.
 * @param {import('playwright').Page} page
 */
const record = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), frames = /** @type {{ t: number, death: string, x: number, z: number, speed: number }[]} */ ([]);
  w.__rp11 = { frames, on: true };
  const tick = (/** @type {number} */ now) => {
    const jimmy = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy');
    if (jimmy !== undefined) frames.push({ t: now, death: jimmy.death, x: jimmy.x, z: jimmy.z, speed: jimmy.speed });
    if (frames.length > 20000) frames.splice(0, 5000);
    if (w.__rp11.on) setTimeout(() => { requestAnimationFrame(tick); }, 0);
  };
  requestAnimationFrame(tick);
});
/** Wait on Jake's page for Jimmy's death phase to be `phase`. @param {import('playwright').Page} page @param {string} phase @param {number} ms */
const phaseIs = (page, phase, ms) => page.waitForFunction(want => (/** @type {any} */ (window).__onlinePlayers?.() ?? []).some((/** @type {any} */ other) => other.name === 'Jimmy' && other.death === want), phase, { timeout: ms, polling: 16 }).then(() => true, () => false);

let code = 1;
try {
  const jake = await enter('Jake'), jimmy = await enter('Jimmy');
  const start = await report(jimmy.page), seen = await biters(jimmy.page);
  note('Jimmy has creatures near', seen.length > 0, seen.slice(0, 6));
  await record(jake.page);

  // Jimmy goes to the nearest bear (else boar, else anything) and lets it fight him: he swings whenever it has not bitten him
  // for 2 s, so it keeps on him, but never into its last third, so it does not die first. Jake follows BEHIND metres back, on Jimmy's side away from it, and watches him.
  const order = ['bear', 'boar', 'wolf'], pick = (/** @type {typeof seen} */ list) => order.map(kind => list.find(body => body.kind === kind)).find(body => body !== undefined) ?? list[0];
  let died = false, bitten = Date.now(), lastHp = start.hp, stuck = 0, from = /** @type {{ x: number, z: number } | null} */ (null), target = pick(seen), fellAt = /** @type {{ x: number, z: number } | null} */ (null);
  const hp = /** @type {number[]} */ ([]);
  for (let i = 0; i < 600 && !died; i++) {
    const near = await biters(jimmy.page), body = target === undefined ? near[0] : near.find(other => other.kind === target?.kind) ?? near[0];
    if (body === undefined) { await jimmy.page.waitForTimeout(300); continue; }
    target = body;
    const at = await jimmy.page.evaluate(([x, z, away, side, swing]) => {
      const { player, game } = /** @type {any} */ (window).__wildshard.world;
      player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)) + side; player.pitch = -0.15;
      player.touchMove.y = away > 1.6 ? 1 : 0; player.touchSprint = away > 10;
      if (swing && away < 2.6) game.app.input.press('attack');
      return { x: player.position.x, z: player.position.z };
    }, /** @type {const} */ ([body.x, body.z, body.away, stuck >= 3 ? (stuck % 12 < 6 ? 1.3 : -1.3) : 0, Date.now() - bitten > 2000 && body.hp > body.maxHp / 3]));
    stuck = from !== null && body.away > 2.6 && Math.hypot(at.x - from.x, at.z - from.z) < 0.4 ? stuck + 1 : Math.max(0, stuck - 1); from = at;
    if (stuck === 4) await jimmy.page.keyboard.press('Space');
    // Jake: BEHIND metres from Jimmy on the far side from the creature, looking at him.
    const me = await where(jake.page), away = Math.hypot(body.x - at.x, body.z - at.z) || 1;
    const spot = { x: at.x - ((body.x - at.x) / away) * BEHIND, z: at.z - ((body.z - at.z) / away) * BEHIND }, gap = Math.hypot(spot.x - me.x, spot.z - me.z);
    if (gap > 2) { await face(jake.page, spot); await walk(jake.page, 1, gap > 10); } else { await walk(jake.page, 0); await face(jake.page, at); }
    const now = await report(jimmy.page); hp.push(now.hp);
    if (now.hp < lastHp) bitten = Date.now();
    lastHp = now.hp;
    fellAt = at;
    died = now.falls > start.falls;
    if (!died) await jimmy.page.waitForTimeout(250);
  }
  await Promise.all([walk(jimmy.page, 0), walk(jake.page, 0)]);
  note('a creature kills Jimmy on the server', died, { creature: target?.kind, its: target === undefined ? null : `${String(Math.round(target.hp))}/${String(target.maxHp)}`, falls: (await report(jimmy.page)).falls, hp: [...new Set(hp)].slice(-12) });
  if (!died) throw new Error('Jimmy never died');

  // Jake looks where Jimmy fell, down at the ground, and shoots each phase as it comes.
  const fallen = (await jimmyOn(jake.page)) ?? fellAt;
  if (fallen !== null) await face(jake.page, fallen, 0.1);
  const lies = await phaseIs(jake.page, 'lie', 4000);
  const lying = await jimmyOn(jake.page);
  await jake.page.screenshot({ path: join(shots, '1-fallen.png') });
  note('Jake sees Jimmy\'s body lying where he fell', lies && lying?.death === 'lie', lying);
  const gone = await phaseIs(jake.page, 'gone', 5000);
  await jake.page.screenshot({ path: join(shots, '2-gone.png') });
  note('then nothing there', gone, await jimmyOn(jake.page));
  const rises = await phaseIs(jake.page, 'rise', 8000), rising = await jimmyOn(jake.page), back = await where(jimmy.page);
  if (rising !== null) await face(jake.page, rising);
  await jake.page.screenshot({ path: join(shots, '3-rise.png') });
  note('Jimmy fades in at his checkpoint', rises && rising !== null && Math.hypot(rising.x - back.x, rising.z - back.z) < 1.5, { rising, jimmysOwn: back });
  const whole = await phaseIs(jake.page, '', 3000);
  // Jake walks over, onto the beach before the pier, to see him nearer.
  for (let i = 0; i < 500; i++) {
    const me = await where(jake.page), gap = Math.hypot(back.x - me.x, back.z - me.z);
    if (gap < 40) break; // closer is out along the pier, over water
    await face(jake.page, back); await walk(jake.page, 1, gap > 10); await jake.page.waitForTimeout(100);
  }
  await walk(jake.page, 0); await face(jake.page, back); await jake.page.waitForTimeout(600);
  const standing = await jimmyOn(jake.page);
  await jake.page.screenshot({ path: join(shots, '4-at-checkpoint.png') });
  note('Jimmy stands at his checkpoint, whole, as Jake reads him', whole && standing?.death === '' && Math.hypot(standing.x - back.x, standing.z - back.z) < 1.5, standing);

  // Across it all: only ever where he fell or at the checkpoint, never faster than FASTEST.
  const frames = /** @type {{ t: number, death: string, x: number, z: number, speed: number }[]} */ (await jake.page.evaluate(() => { const w = /** @type {any} */ (window); w.__rp11.on = false; return w.__rp11.frames; }));
  const deathFrom = frames.findIndex(frame => frame.death === 'fall'), across = frames.slice(Math.max(0, deathFrom - 30));
  const restIdx = across.findIndex((frame, i) => i > 30 && frame.death === '' && across[i - 1]?.death === 'rise');
  const span = restIdx === -1 ? across : across.slice(0, restIdx + 1), fell = frames[deathFrom], fastest = Math.max(...frames.map(frame => frame.speed));
  const between = fell === undefined ? span.length : span.slice(30).filter(frame => Math.hypot(frame.x - fell.x, frame.z - fell.z) > 0.5 && Math.hypot(frame.x - back.x, frame.z - back.z) > 1.5).length;
  const phases = span.map(frame => frame.death).filter((phase, i, all) => phase !== all[i - 1]);
  const lieMs = (() => { const lie = span.filter(frame => frame.death === 'lie'); return lie.length < 2 ? 0 : (lie.at(-1)?.t ?? 0) - (lie[0]?.t ?? 0); })();
  note('Jake\'s page reads fall, lie, fade, gone, rise, then alive', phases.join(',') === ',fall,lie,fade,gone,rise,' || phases.join(',') === 'fall,lie,fade,gone,rise,', phases);
  note('he lies about 2 s', lieMs > 1800 && lieMs < 2300, { lieMs });
  note('no frame draws him between where he fell and the checkpoint', fell !== undefined && between === 0, { between, frames: span.length, fell, back });
  note(`__onlinePlayers() never reads a speed over ${String(FASTEST)} m/s`, fastest < FASTEST, { fastest, frames: frames.length });

  if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const shot of ['1-fallen.png', '2-gone.png', '3-rise.png', '4-at-checkpoint.png']) copyFileSync(join(shots, shot), join(keep, `rp11-${shot}`)); }
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
