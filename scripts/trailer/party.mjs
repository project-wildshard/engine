// The party for a multiplayer shot (docs/trailer.md): a few other players in the captured client's room, played by headless
// pages of the same build against a LOCAL world (scripts/dev.mjs; never staging or production). Each page enters with its
// own Name, stands at its spot round a point and then walks a slow loop there in real time, jumping now and then, so the
// capture (capture.mjs --wall, against the same world) sees real bodies moving, synced by the real server.
//
//   node scripts/trailer/party.mjs <world url> --zone <slug> --at <x>,<z> [--names Ayla,Bram,Corin] [--radius 4] [--secs 600]
//
// One browser holds every page (headless, muted). It stops after --secs or on SIGINT/SIGTERM, closing its browser.
import { chromium } from '../browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { harnessPins, saveFixture } from '../debug-settings.mjs';
import { intoWorld } from '../online-rig.mjs';

/** each member's spot: evenly round the point, facing its middle @param {number} n @param {{ x: number, z: number }} at
 * @param {number} radius @returns {{ x: number, z: number, yaw: number }[]} */
export function spots(n, at, radius) {
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + 0.4, x = at.x + Math.sin(a) * radius, z = at.z + Math.cos(a) * radius;
    return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), yaw: Number(Math.atan2(-(at.x - x), -(at.z - z)).toFixed(4)) };
  });
}

/** a world URL is loopback only: the party never joins a shared world @param {string} url */
export function loopback(url) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`party: ${url} is not a local world`);
  return url;
}

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
  if (!URL_ || !opt('at', '') || !opt('zone', '')) { console.error('node scripts/trailer/party.mjs <world url> --zone <slug> --at <x>,<z> [--names A,B,C] [--radius 4] [--secs 600]'); return 2; }
  const base = loopback(URL_), [x, z] = opt('at', '').split(',').map(Number), names = opt('names', 'Ayla,Bram,Corin').split(',');
  const where = spots(names.length, { x, z }, Number(opt('radius', '4')));
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
      await page.goto(`${base}?chunk=${opt('zone', '')}&mute=1&skipintro=1&nolock=1&sw=0`, { waitUntil: 'load' });
      await page.locator('#ws-name-box input').fill(name, { timeout: 150_000 });
      await page.locator('#ws-name-box button[type=submit]').click();
      await intoWorld(page);
      await page.evaluate((s) => window.__wildshard.pose({ x: s.x, z: s.z, yaw: s.yaw, pitch: 0 }), where[k]);
      await page.evaluate(`(${WANDER})(${k * 1.7})`);
      console.log(`[party] ${name} in at ${where[k].x}, ${where[k].z}`);
    }
    console.log(`[party] ${names.length} in; holding ${opt('secs', '600')} s`);
    await new Promise((resolve) => { setTimeout(resolve, Number(opt('secs', '600')) * 1000); });
  } finally { await stop(); }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
