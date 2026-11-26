#!/usr/bin/env node
// ZONE-ENTRY ZE16's staging form (ZE22, J352): two more clients watch one zone entry between workers on staging (J205: guest seats,
// every socket guarded to the staging door; never production). Three guest pages enter Driftwood from Shard select and walk from the
// spawn to its east entryway by real input (grid-road-lag.mjs's approach). C goes first: through Nalati's gate (Nalati is alone on
// the other worker) and stands just inside, facing the gate. B stands on the road 25 m short of Nalati's buffer. A walks into the
// buffer and stands to the gate's 0. Passes when A's entry keeps its one game socket and its page (no reload), B sees A stand frozen
// after A's 0 and then loses A, and C sees A arrive past the gate (A's body shown within 20 m of C, then A in control there).
//   src/scripts/browser-lane.sh node src/scripts/zone-pair-proof.mjs --base=https://staging.wildshard.io --out=<dir> [--engine=chromium|webkit]
// --with-d adds D, seated in Nalati by its own card (the door allows 4 sockets an IP: only when nothing else on this machine is on
// staging); --probe stops after C's entry and logs C's worker report beside a card-seated D for 20 s. Several WebGL pages in one
// headless browser can starve one page's game loop (its socket still receives at 60/s): a FAIL on C's sighting alone is read with the
// logged reports (`ws` counts what the socket received) before it is called the wire's (ZE16, opus-gcm18).
import { agentFetch as fetch } from './agent-requests.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { watchFaults } from './proof-faults.mjs';
import { guardStagingSockets, playerNameSource } from './staging-proof-lines.mjs';

const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium');
if (base !== 'https://staging.wildshard.io' || out === absolute('')) throw new Error('usage: zone-pair-proof.mjs --base=https://staging.wildshard.io --out=<dir> (staging only, J205)');
const DOOR = 'wss://rooms-staging.wildshard.io', HALF = 250, PITCH = 562.5, APPROACH = /** @type {[number, number][]} */ ([[235, -194], [235, 0]]);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });
const tag = Date.now().toString(36).slice(-4), names = { A: `ZE A ${tag}`, B: `ZE B ${tag}`, C: `ZE C ${tag}`, D: `ZE D ${tag}` };
const result = { base, engine: engineName, at: new Date().toISOString(), build: '', names, steps: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]), a: /** @type {any} */ (null), b: /** @type {any} */ (null), c: /** @type {any} */ (null), d: /** @type {any} */ (null), note: '' };
const log = (/** @type {string} */ line) => { const row = `${new Date().toISOString().slice(11, 19)} ${line}`; result.steps.push(row); console.log(row); };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;

/** A guest page seated in Driftwood and walked to its east entryway, or (D) seated in Nalati by its own card and walked to 10 m
 *  inside its west entryway. @param {'A' | 'B' | 'C' | 'D'} who @param {{ width: number, height: number }} viewport */
async function seat(who, viewport) {
  const card = who === 'D' ? 'Nalati Grasslands' : 'Driftwood Isle';
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(guardStagingSockets, DOOR);
  await context.addInitScript(() => {
    const W = /** @type {any} */ (window), Real = W.WebSocket;
    W.__zeSockets = [];
    W.WebSocket = class extends Real { constructor(/** @type {any[]} */ ...args) { super(...args); const row = { url: String(args[0]), at: Date.now(), socket: this, n: 0, b: 0, last: 0, sent: 0 }; W.__zeSockets.push(row); this.addEventListener('message', (/** @type {any} */ e) => { row.n++; row.b += e.data?.byteLength ?? e.data?.size ?? String(e.data).length; row.last = Date.now(); }); const send = super.send.bind(this); this.send = (/** @type {any} */ d) => { row.sent++; send(d); }; } };
  });
  for (const row of [{ key: 'firstPlayDone', data: true }, { key: 'devMode', data: true }]) await saveFixture(context, { scope: 'device', ...row });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  const page = await context.newPage();
  // ZE23: a page error, a faulted system, the error card or the glitch chip each fail the run (proof-faults.mjs)
  const faults = await watchFaults(page, result.errors, who);
  page.on('console', message => { if (/\[grid\]|zone|hold|welcome|redial|refus/iu.test(message.text())) log(`${who} console ${message.type()}: ${message.text().slice(0, 300)}`); });
  await page.goto(`${base}/?mute=1&nolock=1&fps=60`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  await page.locator('#ws-name-box input').waitFor({ timeout: 60_000 });
  await page.locator('#ws-name-box input').fill(names[who]); await page.locator('#ws-name-box button[type=submit]').click();
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(name => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(name)), card);
  if (index < 0) throw new Error(`${who}: no ${card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 250 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  await page.evaluate(() => { /** @type {any} */ (window).__zeMark = 1; });
  const state = () => page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live?.live?.worldFeet ?? W.__wildshard.world.player.position; return { x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), gate: st.gate ?? null, inside: st.inside ?? null, home: st.live?.live?.home ?? st.home ?? null }; });
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  // the walked approach (W and sprint held, a hop when a post or rail holds it)
  await page.keyboard.down('ShiftLeft');
  const local = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: Number(p.x), z: Number(p.z) }; });
  for (const [x, z] of who === 'D' ? /** @type {[number, number][]} */ (process.argv.includes('--probe') ? [] : [[-224, 3]]) : APPROACH) {
    await page.keyboard.down('KeyW');
    for (let ends = Date.now() + 120_000, near = Infinity, last = { x: Infinity, z: Infinity, t: Date.now() }; Date.now() < ends && near > 3; await sleep(250)) {
      const at = await state(), own = who === 'D' ? await local() : null, lx = own?.x ?? at.x - origin.x, lz = own?.z ?? at.z - origin.z;
      near = Math.hypot(lx - x, lz - z); await face(Math.atan2(lx - x, lz - z));
      if (Math.hypot(at.x - last.x, at.z - last.z) >= 0.5) last = { x: at.x, z: at.z, t: Date.now() };
      else if (Date.now() - last.t > 1000) { await page.keyboard.press('Space'); last.t = Date.now(); }
    }
    await page.keyboard.up('KeyW');
  }
  await page.keyboard.up('ShiftLeft');
  await sleep(1500);
  /** Walk with W toward world-feet x on z = origin.z until within 0.4 m. */
  const walkTo = async (/** @type {number} */ x) => {
    for (const ends = Date.now() + 60_000; Date.now() < ends;) {
      const at = await state(); if (Math.abs(at.x - x) < 0.4) return true;
      await face(Math.atan2(at.x - x, at.z - origin.z)); await page.keyboard.down('KeyW'); await sleep(Math.min(400, Math.abs(at.x - x) * 200)); await page.keyboard.up('KeyW');
    }
    return false;
  };
  const sockets = () => page.evaluate(() => /** @type {any[]} */ (/** @type {any} */ (window).__zeSockets ?? []).map(row => ({ url: String(row.url).replace(/[?#].*$/u, ''), at: row.at, open: row.socket.readyState === 1 })));
  const others = () => page.evaluate(() => /** @type {any} */ (window).__onlinePlayers?.()?.map((/** @type {any} */ r) => ({ name: r.name, x: Number(r.x.toFixed(2)), z: Number(r.z.toFixed(2)), speed: Number(Number(r.speed).toFixed(2)) })) ?? null);
  const me = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: Number(p.x.toFixed(2)), z: Number(p.z.toFixed(2)) }; });
  log(`${who} seated as ${names[who]} in ${card} and walked: ${JSON.stringify(await state())} local ${JSON.stringify(await me())}`);
  return { who, context, page, faults, state, origin, face, walkTo, sockets, others, me, nalatiEdge: origin.x + PITCH - HALF };
}

/** Stand in Nalati's buffer to the gate's 0 and wait for control in Nalati on the same page. @param {Awaited<ReturnType<typeof seat>>} s */
async function enter(s) {
  await s.walkTo(s.nalatiEdge + 2);
  const zeroAt = await s.page.waitForFunction(() => document.querySelector('.ws-load[data-navigation]') !== null, undefined, { timeout: 20_000, polling: 20 }).then(() => Date.now()).catch(() => null);
  const ready = await s.page.waitForFunction(() => { const W = /** @type {any} */ (window), st = W.__wildshard?.shard?.grid?.state?.(); return st?.live?.live?.gameplayReady === true && (st.live.live.home ?? st.home) === 'nalati-grasslands' && document.querySelector('.ws-load[data-navigation]') === null; }, undefined, { timeout: 180_000, polling: 250 }).then(() => Date.now()).catch(() => null);
  const samePage = await s.page.evaluate(() => /** @type {any} */ (window).__zeMark === 1).catch(() => false);
  return { zeroAt, ready, samePage, state: await s.state().catch(() => null), at: await s.me().catch(() => null) };
}

try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  log(`staging build ${result.build}`);
  const report = (/** @type {Awaited<ReturnType<typeof seat>>} */ x) => x.page.evaluate(() => { const r = /** @type {any} */ (window).__workerClient?.(); const ws = /** @type {any[]} */ (/** @type {any} */ (window).__zeSockets ?? []).filter(row => row.socket.readyState === 1).map(row => ({ n: row.n, kb: Math.round(row.b / 1024), sent: row.sent, ago: Date.now() - row.last })); return r === undefined ? { ws } : { ws, frames: r.frames, cell: r.cell, server: [Number(Number(r.serverX).toFixed(1)), Number(Number(r.serverZ).toFixed(1))], others: /** @type {any} */ (window).__onlinePlayers?.()?.map((/** @type {any} */ o) => `${o.name}@${o.x.toFixed(1)},${o.z.toFixed(1)}`) ?? null }; });
  // C: through the gate first, then a step in and turned to face the gate
  const c = await seat('C', { width: 960, height: 600 });
  const cIn = await enter(c);
  log(`C entered Nalati ${JSON.stringify(cIn)}`);
  if (cIn.ready === null) throw new Error('C did not reach control in Nalati');
  for (let i = 0; i < 3; i++) { await sleep(2500); log(`after C's control +${String((i + 1) * 2.5)} s: C ${JSON.stringify(await report(c))}`); }
  if (process.argv.includes('--probe')) {
    const d = await seat('D', { width: 960, height: 600 });
    // after the entry: what C's net client holds, hears and sends, every second for 20 s, while C walks 1 s in each 5
    const probe = () => c.page.evaluate(() => {
      const W = /** @type {any} */ (window), r = W.__workerClient?.();
      return r === undefined ? null : { frames: r.frames, fps: Number(Number(r.framesPerSecond).toFixed(1)), tps: Number(Number(r.ticksPerSecond).toFixed(1)), dropped: r.dropped, closed: r.closed, cell: r.cell, own: r.own,
        server: { x: Number(Number(r.serverX).toFixed(2)), z: Number(Number(r.serverZ).toFixed(2)) }, me: { x: Number(Number(r.x).toFixed(2)), z: Number(Number(r.z).toFixed(2)) }, others: W.__onlinePlayers?.()?.length ?? null };
    });
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) { await c.face(-Math.PI / 2); await c.page.keyboard.down('KeyW'); await sleep(1000); await c.page.keyboard.up('KeyW'); } else await sleep(1000);
      log(`C probe ${String(i)} ${JSON.stringify(await probe())} | C sees ${JSON.stringify(await c.others())} | D sees ${JSON.stringify(await d.others())} D at ${JSON.stringify(await d.me())}`);
    }
    const consoleTail = await c.page.evaluate(() => /** @type {any} */ (window).__zeConsole ?? null);
    log(`C console ${JSON.stringify(consoleTail)}`);
    throw new Error('probe done');
  }
  await c.face(-Math.PI / 2); await c.page.keyboard.down('KeyW'); await sleep(1200); await c.page.keyboard.up('KeyW'); await c.face(Math.PI / 2);
  // D: seated in Nalati by its own card (no gate), 12 m inside its west entryway, facing the gate
  // the door allows 4 sockets an IP (world.ts SOCKETS_PER_IP): D only with --with-d, when no other run shares this machine's IP
  const d = process.argv.includes('--with-d') ? await seat('D', { width: 960, height: 600 }) : null;
  if (d !== null) await d.face(Math.PI / 2);
  log(`C's view: ${JSON.stringify(await c.others())}; D's view: ${JSON.stringify(await d?.others() ?? null)}`);
  // B: on the road, 25 m short of Nalati's buffer
  const b = await seat('B', { width: 960, height: 600 });
  await b.walkTo(b.nalatiEdge - 25); await b.face(-Math.PI / 2);
  log(`B on the road ${JSON.stringify(await b.state())}`);
  // A
  const a = await seat('A', { width: 1280, height: 720 });
  const aName = new RegExp(playerNameSource(names.A), 'u');
  const seenBy = async (/** @type {Awaited<ReturnType<typeof seat>>} */ s) => (await s.others() ?? []).find((/** @type {any} */ row) => aName.test(row.name)) ?? null;
  // B sees A before the entry
  for (const ends = Date.now() + 30_000; Date.now() < ends && await seenBy(b) === null;) await sleep(250);
  const bBefore = await seenBy(b), socketsBefore = await a.sockets();
  log(`B sees A before: ${JSON.stringify(bBefore)}; A's sockets ${JSON.stringify(socketsBefore)}`);
  // watch B's and C's views of A every 100 ms from A's step into the buffer until 60 s after A's control
  const watching = { on: true, b: /** @type {any[]} */ ([]), c: /** @type {any[]} */ ([]), d: /** @type {any[]} */ ([]) };
  const watch = (async () => { while (watching.on) { const t = Date.now(); const [vb, vc, cm, vd, dm] = await Promise.all([seenBy(b), seenBy(c), c.me(), d === null ? null : seenBy(d), d === null ? null : d.me()]); watching.b.push({ t, a: vb }); watching.c.push({ t, a: vc, c: cm }); watching.d.push({ t, a: vd, c: dm }); await sleep(100); } })();
  const aIn = await enter(a);
  log(`A entered Nalati ${JSON.stringify(aIn)}`);
  for (let i = 0; i < 12; i++) { await sleep(2500); log(`after A's control +${String((i + 1) * 2.5)} s: A ${JSON.stringify(await report(a))} C ${JSON.stringify(await report(c))} B ${JSON.stringify(await report(b))}`); }
  for (const ends = Date.now() + 20_000; Date.now() < ends;) { await sleep(500); const last = watching.c.at(-1); if (last?.a !== null && last?.a !== undefined && watching.b.at(-1)?.a === null) break; }
  await sleep(3000); watching.on = false; await watch;
  const socketsAfter = await a.sockets(), game = (/** @type {any} */ row) => row.url.startsWith(DOOR);
  const oneSocket = socketsBefore.some(game) && socketsAfter.filter(game).length === socketsBefore.filter(game).length && [...socketsAfter].reverse().find(game)?.open === true;
  await a.page.screenshot({ path: join(out, 'a-entered.png') }); await b.page.screenshot({ path: join(out, 'b-road.png') }); await c.page.screenshot({ path: join(out, 'c-nalati.png') }); if (d !== null) await d.page.screenshot({ path: join(out, 'd-nalati.png') });
  // B: A frozen after A's 0 (every shown position within 0.3 m of the first after the 0, for at least 1 s), then gone
  const zero = aIn.zeroAt ?? Number.POSITIVE_INFINITY, afterZero = watching.b.filter(row => row.t >= zero);
  const goneAt = afterZero.find(row => row.a === null)?.t ?? null, frozenRows = afterZero.filter(row => row.a !== null && (goneAt === null || row.t < goneAt));
  const first = frozenRows[0]?.a, drift = first === undefined ? null : Math.max(0, ...frozenRows.map(row => Math.hypot(row.a.x - first.x, row.a.z - first.z)));
  const frozenMs = frozenRows.length === 0 ? 0 : frozenRows.at(-1).t - frozenRows[0].t;
  // C: A shown within 20 m of C after A's 0, and A in control in Nalati
  const cSees = watching.c.filter(row => row.t >= zero && row.a !== null).map(row => ({ t: row.t, d: Math.hypot(row.a.x - row.c.x, row.a.z - row.c.z), a: row.a }));
  const arrivedNear = cSees.find(row => row.d <= 20) ?? null;
  const dSees = watching.d.filter(row => row.t >= zero && row.a !== null).map(row => ({ t: row.t, d: Math.hypot(row.a.x - row.c.x, row.a.z - row.c.z), a: row.a }));
  const dNear = dSees.find(row => row.d <= 20) ?? null;
  result.d = { firstSeenAfterZeroMs: dSees[0] === undefined ? null : dSees[0].t - zero, arrivedNear: dNear, cView: await c.others(), dView: d === null ? null : await d.others(), samples: watching.d.filter(row => row.t >= zero - 2000).slice(0, 400) };
  result.a = { ...aIn, oneSocket, socketsBefore, socketsAfter };
  result.b = { before: bBefore, frozenMs, drift, goneAfterZeroMs: goneAt === null ? null : goneAt - zero, samples: watching.b.filter(row => row.t >= zero - 2000).slice(0, 400) };
  result.c = { entered: cIn, firstSeenAfterZeroMs: cSees[0] === undefined ? null : cSees[0].t - zero, arrivedNear, samples: watching.c.filter(row => row.t >= zero - 2000).slice(0, 400) };
  const pass = { aSamePage: aIn.samePage && aIn.ready !== null, aOneSocket: oneSocket, bSawA: watching.b.some(row => row.t < zero && row.a !== null), bFrozenThenGone: frozenMs >= 1000 && drift !== null && drift <= 0.3 && goneAt !== null, cSawArrive: arrivedNear !== null, ...(d === null ? {} : { dSawArrive: dNear !== null }) };
  log(`PASS? ${JSON.stringify(pass)} frozenMs=${String(frozenMs)} drift=${String(drift)} goneAfterZeroMs=${String(result.b.goneAfterZeroMs)} cFirstSeen=${String(result.c.firstSeenAfterZeroMs)} cNear=${JSON.stringify(arrivedNear)} dFirstSeen=${String(result.d.firstSeenAfterZeroMs)} dNear=${JSON.stringify(dNear)} cView=${JSON.stringify(result.d.cView)} dView=${JSON.stringify(result.d.dView)}`);
  /** @type {any} */ (result).pass = pass;
  for (const s of [a, b, c, d]) if (s !== null) await s.faults.settle();
  code = Object.values(pass).every(Boolean) && result.errors.length === 0 ? 0 : 1;
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'} zone pair ${JSON.stringify(pass)} errors=${String(result.errors.length)}`);
  for (const s of [a, b, c, d]) if (s !== null) await s.context.close();
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${engineName}-zone-pair.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
