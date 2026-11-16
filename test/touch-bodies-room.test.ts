// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual shipped native physics over a real room and two clients.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { installTouchBodies, type TouchBodyRow } from '../src/server/game/shardfile/touchBodies';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { installKitWorldFixture } from './fixtures/kit-world';

await installKitWorldFixture();

// meta SHARD-SOURCE SS9e's engine half: two players in one room; one walks into the touchable crate, and both clients'
// frames carry the crate's body at the same place, where the server's body is (SS9c draws the page's crate off this row).
const LEVEL = { ...SIM_LEVEL, entities: [], quests: [] }, BOT = 'bot:1';
const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

test('one player pushes the crate and both clients see it at the server\'s pose', () => {
  const host = createSimHost(LEVEL, { rapier });
  try {
    const lead = leadPlayer(host);
    // which way the lead walks: a few ticks from the origin, as touch-bodies.test.ts finds it
    for (let i = 0; i < 10; i++) host.step(new Map([[lead.id, { moveX: 0, moveZ: 1, yaw: 0 }]]));
    const length = Math.hypot(lead.position.x, lead.position.z), ahead = { x: lead.position.x / length, z: lead.position.z / length };
    const row: TouchBodyRow = { id: 'yard.crate', panel: 'crate', at: { x: lead.position.x + ahead.x * 2.5, y: 0.4, z: lead.position.z + ahead.z * 2.5 }, yaw: 0,
      shape: { cuboid: { x: 0.4, y: 0.4, z: 0.4 } }, material: 'wood', density: 150 };
    const touch = installTouchBodies(host, [row]); if (touch === null) throw new Error('no bodies');
    host.addPlayer(BOT, new Vector3(lead.position.x - ahead.z * 4, 1, lead.position.z + ahead.x * 4));
    let moveZ = 0;
    const world = new SimNetWorld(host), room = new NetRoom({ world, step: () => { host.step(new Map([[lead.id, { moveX: 0, moveZ, yaw: 0 }], [BOT, { moveX: 0, moveZ: 0, yaw: 0 }]])); } });
    const links = [directLoopback(), directLoopback()], clients = links.map(link => new NetClient(link.client));
    room.join(links[0]!.server, world.playerOf(lead.id)); room.join(links[1]!.server, world.playerOf(BOT));
    const pump = (): void => { for (const link of links) link.pump(); };
    for (const client of clients) client.hello();
    pump(); room.open(); pump();
    const seen = (client: NetClient): { x: number; z: number } | null => {
      const frame = client.latest; if (frame === null) return null;
      for (const [handle, info] of client.entities) if (info.id === 'script:yard.crate') {
        const fields = client.fields(frame, handle); if (fields === null) return null;
        return { x: Number(fields['x']), z: Number(fields['z']) };
      }
      return null;
    };
    for (let i = 0; i < 30; i++) { room.tick(); pump(); } // the crate settles
    const rest = touch.body('yard.crate')?.rb.translation(); if (rest === undefined) throw new Error('no crate');
    moveZ = 1;
    for (let i = 0; i < 120; i++) { room.tick(); pump(); }
    moveZ = 0;
    for (let i = 0; i < 30; i++) { room.tick(); pump(); }
    const server = touch.body('yard.crate')?.rb.translation(); if (server === undefined) throw new Error('no crate');
    expect((server.x - rest.x) * ahead.x + (server.z - rest.z) * ahead.z).toBeGreaterThan(0.5);
    const [pusher, watcher] = clients.map(seen);
    expect(pusher).not.toBeNull(); expect(watcher).not.toBeNull();
    expect(watcher?.x).toBeCloseTo(pusher?.x ?? NaN, 5); expect(watcher?.z).toBeCloseTo(pusher?.z ?? NaN, 5);
    expect(Math.abs((watcher?.x ?? NaN) - server.x)).toBeLessThan(0.05); expect(Math.abs((watcher?.z ?? NaN) - server.z)).toBeLessThan(0.05);
    for (const client of clients) expect(client.dropped).toBe(0);
  } finally { host.dispose(); }
});
