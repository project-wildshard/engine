// oxlint-disable-next-line import/no-nodejs-modules -- the matrix's rows go to a file when asked (GC2_MATRIX).
import { writeFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// GRID-CROSSING GC2 (Jake 11-12: "i think i jumped over the invisible wall and fucked it up"): the breach matrix at the online
// server's wall, the one the page can't overrule. The browser half (`grid-crossing-walk-proof.mjs --breach`) jumps into it, along
// it and boost-jumps into it from the road; a page can't reach a ledge or a height there, so these cases set the road body there
// directly: a fall along the wall from a ledge's height and from its top (60 m: `roadWorld.ts` addCellWalls), and a run along it
// at sprint both ways. A case holds when the body is never handed into the walled cell
// and ends on the road, on the walker's side of the wall.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', CELLS = [HOME, SOUTH, 'sunscar-dunes', 'nalati-grasslands'];
/** Far Reach's north edge, south of Driftwood's origin on staging's pitch; its road wall stands 2 m further north. */
const FAR_EDGE = -(562.5 - CHUNK_HALF), WALL_FACE = FAR_EDGE + 2;
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; });
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });

test('the road wall in front of a walled cell holds a fall along it, a fall from its top and a run along it', { timeout: 180_000 }, async () => {
  bench = await roomBench({ cells: CELLS, workers: 2, crossing: true });
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A'); bots.push(a);
  expect(await a.arrived()).toBe(true);
  const home = bench.room(HOME), south = bench.room(SOUTH), road = bench.road(roadName(HOME)), body = home?.bodyOf('device:a');
  if (home === undefined || south === undefined || road === undefined || body === undefined) throw new Error('Driftwood, Far Reach and their road boot on one worker');
  body.resetPose({ x: 0, y: 1, z: -(CHUNK_HALF - 5) }, 0);
  /** @param keyX strafe @param buttons sprint, jump */
  const steer = (keyX: number, keyY: number, buttons: number): void => { a.thumb = () => ({ viewTick: 0, steer: { keyX, keyY, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons }); };
  steer(0, 1, NET_BUTTONS.sprint);
  await vi.waitFor(() => { expect(road.holds('device:a'), 'onto the road').toBe(true); }, { timeout: 20_000, interval: 100 });
  await vi.waitFor(() => { expect(road.bodyOf('device:a')?.position.z ?? 0, 'held at the wall').toBeLessThan(WALL_FACE + 4); }, { timeout: 20_000, interval: 100 });
  const rows: Record<string, unknown>[] = [];
  /** Run one case for `ms`: the walked cell never takes the seat, and the body never passes the wall's face. */
  const run = async (name: string, pose: { x: number; y: number; z: number } | null, keyX: number, keyY: number, buttons: number, ms: number) => {
    const at = road.bodyOf('device:a');
    if (at === undefined) throw new Error(`${name}: the seat left the road before the case`);
    if (pose !== null) at.resetPose(pose, 0);
    steer(keyX, keyY, buttons);
    let deepest = Infinity, lowest = Infinity, handed = false;
    for (const ends = Date.now() + ms; Date.now() < ends;) {
      await sleep(50);
      handed ||= south.holds('device:a');
      const now = road.bodyOf('device:a')?.position;
      if (now !== undefined) { deepest = Math.min(deepest, now.z); lowest = Math.min(lowest, now.y); }
    }
    steer(0, 0, 0); await sleep(300);
    const end = road.bodyOf('device:a')?.position;
    rows.push({ name, handed, deepest: Number(deepest.toFixed(2)), lowest: Number(lowest.toFixed(2)), end: end === undefined ? null : { x: Number(end.x.toFixed(2)), y: Number(end.y.toFixed(2)), z: Number(end.z.toFixed(2)) } });
    expect(handed, `${name}: never handed into Far Reach`).toBe(false);
    expect(road.holds('device:a'), `${name}: still on the road`).toBe(true);
    expect(deepest, `${name}: never past the wall's face`).toBeGreaterThan(FAR_EDGE);
    return end;
  };
  // A fall along it: from 12 m up (a ledge's height; the road has none here), sprinting into the wall and jumping on landing.
  await run('fall into it from 12 m', { x: 0, y: 12, z: WALL_FACE + 1 }, 0, 1, NET_BUTTONS.sprint | NET_BUTTONS.jump, 4000);
  await run('fall along it from 12 m', { x: -20, y: 12, z: WALL_FACE + 1 }, 1, 1, NET_BUTTONS.sprint | NET_BUTTONS.jump, 4000);
  // A run along it at sprint, pressed into it, both ways.
  await run('run along it, east', null, 1, 1, NET_BUTTONS.sprint, 5000);
  await run('run along it, west', null, -1, 1, NET_BUTTONS.sprint, 5000);
  // The highest a page can stand a player on the road: 60 m (the wall's top). A body set above it is the only way over.
  await run('fall into it from the wall top', { x: 0, y: 58, z: WALL_FACE + 1 }, 0, 1, NET_BUTTONS.sprint, 6000);
  if (process.env['GC2_MATRIX'] !== undefined) writeFileSync(process.env['GC2_MATRIX'], `${JSON.stringify(rows, null, 2)}\n`);
});
