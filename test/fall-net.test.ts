import { afterEach, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import type { SimHost } from '../src/server/engine/sim';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';
import { floorBelow } from '../src/shared/engine/physics/query';
import { playBounds } from '../src/client/engine/world/bounds';
import { directLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

// ENG-18: nobody falls for ever. Off the world, a player goes back to the last ground they stood on (or the spawn), on the
// bare trusted resident a headless tape or shard CI drives, and in a net room. The two falls found on 11-12: walking south
// off Dunes' basin (shard-dunes 9b67f3f), and an idle player at Sky Reach's winch drum shoved off the step (shard-sky-reach a8369a9).
const DUNES = 'sunscar-dunes', SKY = 'far-reach';
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0).reverse()) close(); });

/** Stand `player` on the ground under (x, z). */
function standAt(player: PlayerSim, host: SimHost, x: number, z: number): void {
  const y = floorBelow(host.physics, x, z, 200, 400, player.motor.collider) ?? host.heightAt(x, z);
  if (y === undefined) throw new Error(`No ground at ${String(x)}, ${String(z)}`);
  player.resetPose({ x, y, z }, 0);
}
type Move = { readonly moveX: number; readonly moveZ: number };
/** The repros: Dunes walks due south from the basin for 3 000 ticks; Sky Reach stands idle at the drum for 900. */
const REPROS: readonly { readonly slug: string; readonly at: readonly [number, number]; readonly move: Move; readonly ticks: number }[] = [
  { slug: DUNES, at: [-14, -140], move: { moveX: 0, moveZ: -1 }, ticks: 3000 },
  { slug: SKY, at: [-60.8, -135.3], move: { moveX: 0, moveZ: 0 }, ticks: 900 },
];
/** The lowest a player may be after a fall net: the shard's declared floor, less one tick of a terminal fall. */
const floorOf = async (slug: string): Promise<number> => (await serverInput(slug)).shard.manifest?.bounds?.floor ?? -Infinity;

/** Step `ticks` times; the lowest the player got and how many times it was put back. */
function run(step: () => void, player: PlayerSim, ticks: number): { lowest: number; resets: number } {
  const resets = player.resets;
  let lowest = Infinity;
  for (let tick = 0; tick < ticks; tick++) { step(); lowest = Math.min(lowest, player.position.y); }
  return { lowest, resets: player.resets - resets };
}
/** The repro's input, then the hard case: the player is dropped under the ground at the repro's spot, with nothing below. */
async function fallsAndRecovers(slug: string, host: SimHost, player: PlayerSim, step: (move: Move) => void): Promise<void> {
  const repro = REPROS.find(row => row.slug === slug), floor = await floorOf(slug);
  if (repro === undefined) throw new Error(`No repro for ${slug}`);
  standAt(player, host, repro.at[0], repro.at[1]);
  const walked = run(() => { step(repro.move); }, player, repro.ticks);
  expect(walked.lowest, `${slug}: the repro never falls far under the floor`).toBeGreaterThan(floor - 10);
  standAt(player, host, repro.at[0], repro.at[1]);
  run(() => { step({ moveX: 0, moveZ: 0 }); }, player, 30); // a firm spot to come back to
  const { x, y, z } = player.position;
  player.resetPose({ x, y: y - 6, z }, 0);
  const dropped = run(() => { step({ moveX: 0, moveZ: 0 }); }, player, 900);
  expect(dropped.resets, `${slug}: the drop is caught`).toBeGreaterThan(0);
  expect(dropped.lowest, `${slug}: caught at the floor`).toBeGreaterThan(floor - 10);
  expect(player.position.y, `${slug}: back above the floor`).toBeGreaterThan(floor);
  // Sky Reach's step wisp nudges an idle player, so the last firm ground may be a few metres off the drop.
  expect(Math.hypot(player.position.x - x, player.position.z - z), `${slug}: back near where it last stood`).toBeLessThan(6);
}

for (const { slug } of REPROS) {
  test(`ENG-18 offline: the bare resident catches a fall off ${slug}`, { timeout: 120_000 }, async () => {
    const resident: TrustedHeadlessResident = await createTrustedHeadlessResident(await serverInput(slug));
    closers.push(() => { resident.dispose(); });
    const { host } = resident, player = [...host.players.values()][0];
    if (player === undefined) throw new Error('No player');
    await fallsAndRecovers(slug, host, player, move => { resident.step([{ kind: 'player', ...move, yaw: 0 }]); });
  });

  test(`ENG-18 online: a net room catches a fall off ${slug}`, { timeout: 120_000 }, async () => {
    let clock = 0;
    const room = await DedicatedRoom.boot({ slug, build: '', bootId: 'eng18', input: await serverInput(slug), now: () => clock, post: row => { if (row.kind === 'refused') throw new Error(row.reason); } });
    closers.push(() => { room.dispose(); });
    const link = directLoopback(), client = new NetClient(link.client), device = 'faller';
    room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }, 0); link.pump(); });
    link.pump();
    const tick = (move: Move): void => {
      client.command({ viewTick: 0, steer: { keyX: move.moveX, keyY: -move.moveZ, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); link.pump();
      clock += 1000 / 60; room.tick(); link.pump();
    };
    tick({ moveX: 0, moveZ: 0 });
    const player = room.bodyOf(device);
    if (player === undefined) throw new Error('No body');
    await fallsAndRecovers(slug, room.host, player, tick);
  });
}

test('ENG-18 page: a level with no authored bounds still has a fall floor', () => {
  const authored = { x0: -10, x1: 10, z0: -10, z1: 10, floor: 3 };
  expect(playBounds(authored, false)).toBe(authored);
  expect(playBounds(undefined, false).floor).toBe(-250);
  expect(playBounds(undefined, true).floor).toBe(-60);
  expect(playBounds(undefined, false).x0).toBe(-Infinity);
});
