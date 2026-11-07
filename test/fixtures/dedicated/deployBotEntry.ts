import { RoomBot } from './roomBot';

// E7.2c, E7.4b: two phones through restarts and a deploy. Each walks, and when the link ends it waits for `/health`, dials the build that names, and says how long it took
// to move again and how far the stand it was sent back to is from where it last stood. `scripts/room-deploy.mjs` runs it.
const [base = 'ws://127.0.0.1:8790', secondsArg = '60'] = process.argv.slice(2), ends = performance.now() + Number(secondsArg) * 1000, http = base.replace(/^ws/u, 'http'), POLL_MS = 20;
const rest = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
interface Stand { readonly x: number; readonly z: number }

async function serverBuild(): Promise<string | null> {
  try {
    const response = await fetch(`${http}/health`);
    return response.ok ? (await response.json() as { build: string }).build : null;
  } catch { return null; }
}
async function phone(device: string): Promise<void> {
  let lost: { readonly at: number; readonly reason: string | null; readonly stood: Stand | null } | null = null;
  while (performance.now() < ends) {
    const build = await serverBuild();
    if (build === null) { await rest(POLL_MS); continue; }
    const bot = new RoomBot(`${base}/`, build, device, device);
    bot.thumb = tick => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: tick / 90, pitch: 0, buttons: 0 });
    if (!await bot.arrived(30_000)) { bot.drop(); await rest(POLL_MS); continue; }
    const stand = (): Stand | null => { const { latest } = bot.client; if (latest === null) return null; const owner = bot.client.owner(latest); return { x: Number(owner['px']), z: Number(owner['pz']) }; };
    const first = stand();
    while (bot.closed === null && performance.now() < ends) {
      const now = stand();
      if (first !== null && now !== null && Math.hypot(now.x - first.x, now.z - first.z) > 0.05) break;
      await rest(POLL_MS);
    }
    if (lost !== null) {
      const { at, stood, reason } = lost, resumed = JSON.parse(bot.resume ?? '{}') as { at?: Stand }, ms = Math.round(performance.now() - at);
      console.info(JSON.stringify({ at: 'back', device, build, reason, ms, off: stood === null || resumed.at === undefined ? null : Number(Math.hypot(stood.x - resumed.at.x, stood.z - resumed.at.z).toFixed(2)) }));
    }
    let stood = stand();
    while (bot.closed === null && performance.now() < ends) { stood = stand() ?? stood; await rest(POLL_MS); }
    if (first !== null && stood !== null) console.info(JSON.stringify({ at: 'walked', device, metres: Number(Math.hypot(stood.x - first.x, stood.z - first.z).toFixed(2)), from: first, to: stood }));
    lost = { at: performance.now(), reason: bot.closed, stood };
    bot.drop();
  }
}
await Promise.all([phone('device:deploy-0'), phone('device:deploy-1')]);
process.exit(0);
