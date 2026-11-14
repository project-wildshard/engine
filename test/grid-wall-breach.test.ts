// oxlint-disable-next-line import/no-nodejs-modules -- the matrix's rows go to a file when asked (GC2_MATRIX).
import { writeFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC2 (Jake 11-12: "i think i jumped over the invisible wall and fucked it up"): the breach matrix at the online
// server's wall, the one the page can't overrule. The browser half (`grid-crossing-walk-proof.mjs --breach`) jumps into it, along
// it and boost-jumps into it from the road; a page can't reach a ledge or a height there, so these cases set the road body there
// directly: a fall along the wall from a ledge's height and from its top (60 m: `roadWorld.ts` addCellWalls), and a run along it
// at sprint both ways. A case holds when the body is never handed into the walled cell
// and ends on the road, on the walker's side of the wall.
// Since GC30b (Sky Reach rev 3) Far Reach's docks stand at its entryways, so its road wall is gone; the bench walls it as a bare cell
// would be (its entryway probe answers no), and the wall it stands up is the one every walled cell gets.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', CELLS = [HOME, SOUTH, 'sunscar-dunes', 'nalati-grasslands'];
/** Far Reach's north edge, south of Driftwood's origin on staging's pitch; its road wall stands 2 m further north. */
const FAR_EDGE = -(562.5 - CHUNK_HALF), WALL_FACE = FAR_EDGE + 2;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; vi.restoreAllMocks(); });
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });

test('the road wall in front of a walled cell holds a fall along it, a fall from its top and a run along it', { timeout: 180_000 }, async () => {
  const stands = DedicatedRoom.prototype.entrywaysStand;
  vi.spyOn(DedicatedRoom.prototype, 'entrywaysStand').mockImplementation(function (this: DedicatedRoom) { return !this.name.includes(SOUTH) && stands.call(this); });
  // five bots from one address: the door's per-address limits are lifted, as test/dedicated-refusals.test.ts does for its many
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true, socketsPerIp: 8, connectsPerMinute: 16 });
  const home = bench.room(HOME), south = bench.room(SOUTH), road = bench.road(roadName(HOME));
  if (home === undefined || south === undefined || road === undefined) throw new Error('Driftwood, Far Reach and their road boot on one worker');
  /** @param keyX strafe @param buttons sprint, jump */
  const steer = (bot: RoomBot, keyX: number, keyY: number, buttons: number): void => { bot.thumb = () => ({ viewTick: 0, steer: { keyX, keyY, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons }); };
  /** One case: its own bot, at its own stretch of the wall (100 m apart, so the runs along it never meet), pressed into it
   *  for `ms`. The walked cell never takes the seat, and the body never passes the wall's face. The cases are independent,
   *  so they run at once (J295: the file went over its 60 s budget running them one after another). */
  const run = async (index: number, name: string, x: number, y: number, keyX: number, keyY: number, buttons: number, ms: number) => {
    const device = `device:${String(index)}`, bot = new RoomBot(bench?.url ?? '', 'bench', device, `Case ${String(index)}`); bots.push(bot);
    expect(await bot.arrived(), `${name}: arrived`).toBe(true);
    const body = home.bodyOf(device);
    if (body === undefined) throw new Error(`${name}: no body in ${HOME}`);
    body.resetPose({ x, y: 1, z: -(CHUNK_HALF - 5) }, 0);
    steer(bot, 0, 1, NET_BUTTONS.sprint);
    await vi.waitFor(() => { expect(road.holds(device), `${name}: onto the road`).toBe(true); }, { timeout: 20_000, interval: 100 });
    // the road has the seat: the run-up to the wall starts 8 m short of it, and a sprint into it still has to stop there
    road.bodyOf(device)?.resetPose({ x, y: 1, z: WALL_FACE + 8 }, 0);
    await vi.waitFor(() => { expect(road.bodyOf(device)?.position.z ?? 0, `${name}: held at the wall`).toBeLessThan(WALL_FACE + 4); }, { timeout: 20_000, interval: 100 });
    const at = road.bodyOf(device);
    if (at === undefined) throw new Error(`${name}: the seat left the road before the case`);
    // a fall starts at its height by the wall; a run starts pressed against it on the ground
    at.resetPose({ x, y, z: WALL_FACE + 1 }, 0);
    steer(bot, keyX, keyY, buttons);
    let deepest = Infinity, lowest = Infinity, handed = false;
    for (const ends = Date.now() + ms; Date.now() < ends;) {
      await sleep(50);
      handed ||= south.holds(device);
      const now = road.bodyOf(device)?.position;
      if (now !== undefined) { deepest = Math.min(deepest, now.z); lowest = Math.min(lowest, now.y); }
    }
    steer(bot, 0, 0, 0); await sleep(300);
    const end = road.bodyOf(device)?.position;
    expect(handed, `${name}: never handed into Far Reach`).toBe(false);
    expect(road.holds(device), `${name}: still on the road`).toBe(true);
    expect(deepest, `${name}: never past the wall's face`).toBeGreaterThan(FAR_EDGE);
    return { name, handed, deepest: Number(deepest.toFixed(2)), lowest: Number(lowest.toFixed(2)), end: end === undefined ? null : { x: Number(end.x.toFixed(2)), y: Number(end.y.toFixed(2)), z: Number(end.z.toFixed(2)) } };
  };
  const rows = await Promise.all([
    // A fall along it: from 12 m up (a ledge's height; the road has none here), sprinting into the wall and jumping on landing.
    run(0, 'fall into it from 12 m', -200, 12, 0, 1, NET_BUTTONS.sprint | NET_BUTTONS.jump, 4000),
    run(1, 'fall along it from 12 m', -100, 12, 1, 1, NET_BUTTONS.sprint | NET_BUTTONS.jump, 4000),
    // A run along it at sprint, pressed into it, both ways.
    run(2, 'run along it, east', 0, 1, 1, 1, NET_BUTTONS.sprint, 5000),
    run(3, 'run along it, west', 100, 1, -1, 1, NET_BUTTONS.sprint, 5000),
    // The highest a page can stand a player on the road: 60 m (the wall's top). A body set above it is the only way over.
    run(4, 'fall into it from the wall top', 200, 58, 0, 1, NET_BUTTONS.sprint, 6000),
  ]);
  if (process.env['GC2_MATRIX'] !== undefined) writeFileSync(process.env['GC2_MATRIX'], `${JSON.stringify(rows, null, 2)}\n`);
});
