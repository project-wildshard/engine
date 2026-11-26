// The party for a multiplayer shot (docs/trailer.md): a few other players in the captured client's room, played by headless
// pages of the same build against a LOCAL world (src/scripts/dev.mjs --staging: the staging grid on a local server) or staging
// itself (at most 4 clients there with the camera), never production. Each page comes in through the title's MMO card as a
// player does (grid.mjs; never a zone in the URL), enters with its own Name, stands in the zone's cell at its spot round a point and then walks a slow loop there in real time, jumping now and then, so the
// capture (capture.mjs --wall, against the same world) sees real bodies moving, synced by the real server.
//
//   node src/scripts/trailer/party.mjs <world url> --zone <slug> --at <x>,<z> [--names Ayla,Bram,Corin] [--radius 4] [--secs 600]
//        [--go <port>] [--spread <m>]
//
// --go <port>: the party marches on cue instead of wandering. A GET of http://127.0.0.1:<port>/go?x=&z=&yaw=&speed= (a shot's
// afterWarm fetches it) poses every member in a loose wedge round (x, z) facing yaw, and they walk that way together at
// `speed` (0..1 of a walk) until the next cue, so a shot frames the party moving as one; --spread is the wedge's half
// width (1 m keeps three on Driftwood's pier).
//
// One browser holds every page (headless, muted). It stops after --secs or on SIGINT/SIGTERM, closing its browser.
import { createServer } from 'node:http';
import { chromium } from '../browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../.kit/chromium-keychain.mjs';
import { harnessPins, saveFixture } from '../debug-settings.mjs';
import { intoWorld } from '../online-rig.mjs';
import { enterCell, enterGrid } from './grid.mjs';
import { bootUrl } from './shots/lib.mjs';

/** each member's spot: evenly round the point, facing its middle @param {number} n @param {{ x: number, z: number }} at
 * @param {number} radius @returns {{ x: number, z: number, yaw: number }[]} */
export function spots(n, at, radius) {
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + 0.4, x = at.x + Math.sin(a) * radius, z = at.z + Math.cos(a) * radius;
    return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), yaw: Number(Math.atan2(-(at.x - x), -(at.z - z)).toFixed(4)) };
  });
}

/** a world URL is a local world or staging, never production (J205) @param {string} url */
export function loopback(url) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== 'staging.wildshard.io') throw new Error(`party: ${url} is not a local world or staging`);
  return url;
}

/** a member's place in the marching wedge round (x, z) facing yaw: k = 0 leads, the rest fall in behind on alternate sides
 * @param {number} k @param {{ x: number, z: number, yaw: number }} at @param {number} [spread] metres either side */
export function wedge(k, at, spread = 2) {
  const side = k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * (spread + Math.floor((k - 1) / 2) * 1.4), back = k === 0 ? 0 : 1.3 + Math.floor((k - 1) / 2) * 1.5;
  const fx = -Math.sin(at.yaw), fz = -Math.cos(at.yaw), rx = -fz, rz = fx; // forward, right (Player.ts: yaw 0 faces -z)
  return { x: Number((at.x + rx * side - fx * back).toFixed(2)), z: Number((at.z + rz * side - fz * back).toFixed(2)), yaw: at.yaw };
}

/** in-page: walk straight at `speed` from now on (the march), a small sway so three bodies never move in lockstep */
const MARCH = `(seed, speed) => { const w = window.__wildshard.world, p = w.player; window.__march = (window.__march ?? 0) + 1; const me = window.__march;
  let t = 0, last = performance.now(); const yaw0 = p.yaw;
  const tick = () => { if (window.__march !== me) return; const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    p.yaw = yaw0 + Math.sin(t * 0.7 + seed) * 0.05; p.touchMove.y = speed; p.touchMove.x = 0; p.touchSprint = false;
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick); }`;

/** in-page: walk a slow loop from the spot (turning a little every frame), a jump every few seconds */
const WANDER = `(seed) => { const w = window.__wildshard.world, p = w.player; let t = 0, last = performance.now();
  const tick = () => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    p.yaw += dt * (0.35 + 0.1 * Math.sin(t * 0.3 + seed));
    p.touchMove.y = t % 9 < 6.5 ? 0.45 : 0; p.touchMove.x = 0; p.touchSprint = false;
    if (Math.floor((t + seed) / 4.1) !== Math.floor((t + seed - dt) / 4.1)) p.touchJump = true;
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick); }`;

/** @param {string[]} argv */
export async function main(argv) {
  const [URL_] = argv;
  const opt = (/** @type {string} */ k, /** @type {string} */ d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
  if (!URL_ || !opt('at', '') || !opt('zone', '')) { console.error('node src/scripts/trailer/party.mjs <world url> --zone <slug> --at <x>,<z> [--names A,B,C] [--radius 4] [--secs 600]'); return 2; }
  const base = loopback(URL_), [x, z] = opt('at', '').split(',').map(Number), names = opt('names', 'Ayla,Bram,Corin').split(',');
  const where = spots(names.length, { x, z }, Number(opt('radius', '4')));
  /** @type {import('playwright').Page[]} */
  const pages = [];
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const stop = async () => { try { await browser.close(); } catch { /* already closed */ } };
  process.once('SIGINT', () => { void stop().then(() => process.exit(130)); });
  process.once('SIGTERM', () => { void stop().then(() => process.exit(143)); });
  try {
    for (const [k, name] of names.entries()) {
      // online-rig's enterPage, plus the harness pins the pose probe asks for
      const context = await browser.newContext({ viewport: { width: 640, height: 360 } }), page = await context.newPage();
      await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
      await harnessPins(context, { seed: 0x51 + k });
      await enterGrid(page, bootUrl(base, { zone: opt('zone', '') }).url);
      await page.locator('#ws-name-box input').fill(name, { timeout: 150_000 });
      await page.locator('#ws-name-box button[type=submit]').click();
      await intoWorld(page);
      await enterCell(page, opt('zone', ''));
      await page.evaluate((s) => window.__wildshard.pose({ x: s.x, z: s.z, yaw: s.yaw, pitch: 0 }), where[k]);
      if (!opt('go', '')) await page.evaluate(`(${WANDER})(${k * 1.7})`);
      pages.push(page);
      console.log(`[party] ${name} in at ${where[k].x}, ${where[k].z}`);
    }
    if (opt('go', '')) {
      const server = createServer((req, res) => {
        const q = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams, at = { x: Number(q.get('x')), z: Number(q.get('z')), yaw: Number(q.get('yaw')) };
        res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end();
        if (![at.x, at.z, at.yaw].every(Number.isFinite)) return;
        const speed = Number(q.get('speed') ?? '0.5');
        void Promise.all(pages.map(async (page, k) => {
          const s = wedge(k, at, Number(opt('spread', '2')));
          await page.evaluate((v) => window.__wildshard.pose({ x: v.x, z: v.z, yaw: v.yaw, pitch: 0 }), s);
          await page.evaluate(`(${MARCH})(${k * 1.7}, ${speed})`);
        })).then(() => console.log(`[party] march from ${at.x}, ${at.z} yaw ${at.yaw}`));
      });
      server.listen(Number(opt('go', '')), '127.0.0.1');
      process.once('exit', () => { server.close(); });
    }
    console.log(`[party] ${names.length} in; holding ${opt('secs', '600')} s`);
    await new Promise((resolve) => { setTimeout(resolve, Number(opt('secs', '600')) * 1000); });
  } finally { await stop(); }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
