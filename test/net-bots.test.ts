import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { directLoopback } from '../src/test/engine/netLoopback';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { rapier, roomTickCases } from './fixtures/netBots';

// TEST-SPEED TS5 (J255): net-bots was 20-33 s hosted. Some cases moved to net-bots-driftwood.test.ts; the helpers are in test/fixtures/netBots.ts.
roomTickCases(['sunscar-dunes']);

test('two clients each own their player: their own block, and a hit confirms only for who landed it', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), world = new SimNetWorld(host), lead = leadPlayer(host);
  const [id, target] = [...host.entities][0] ?? [];
  if (id === undefined || target === undefined) throw new Error('No creature');
  target.harnessHold = true;
  const bot = host.addPlayer('bot:1', { x: target.position.x, y: 0, z: target.position.z - 1 }), room = new NetRoom({ world, step: inputs => {
    host.step(new Map(inputs.flatMap(row => row.command === null ? [] : [[row.player, row.command]])));
  } });
  const ours = directLoopback(), theirs = directLoopback(), own = new NetClient(ours.client), other = new NetClient(theirs.client);
  room.join(ours.server, world.playerOf(bot.id)); room.join(theirs.server, world.playerOf(lead.id));
  own.hello(); ours.pump(); other.hello(); theirs.pump();
  room.open(); ours.pump(); theirs.pump();
  expect(own.welcome?.handle).not.toBe(other.welcome?.handle);
  const seen: { client: string; confirmFor: number }[] = [];
  own.onCombat(event => { if (event.kind === 'hit') seen.push({ client: 'own', confirmFor: event.confirmFor }); });
  other.onCombat(event => { if (event.kind === 'hit') seen.push({ client: 'other', confirmFor: event.confirmFor }); });
  const idle = { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
  const swing = own.command({ ...idle, attack: { targetId: id, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } });
  for (let tick = 0; tick < 60; tick++) {
    if (tick > 0) own.command(idle);
    other.command(idle); own.flush(); other.flush(); ours.pump(); theirs.pump(); room.tick(); ours.pump(); theirs.pump();
  }
  expect(seen).toEqual([{ client: 'own', confirmFor: swing }, { client: 'other', confirmFor: 0 }]);
  for (const [client, player] of [[own, bot], [other, lead]] as const) {
    const frame = client.latest;
    if (frame === null) throw new Error('No frame');
    expect(client.owner(frame)['px']).toBe(player.position.x);
  }
  room.dispose(); host.dispose();
});
