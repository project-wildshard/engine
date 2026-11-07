// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { netLootFeed, type LootPayout } from '../src/client/game/loot/feed';
import { installPersonalLoot } from '../src/server/game/loot/personal';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E6 COMBAT, J105: the loot's views read one feed. The same payouts reach them whichever feeds them, and a page reads one.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

function room(): { host: ReturnType<typeof createSimHost>; heard: (name: string) => LootPayout[]; kill: () => void; run: (ticks: number) => void; done: () => void } {
  const host = createSimHost(SIM_LEVEL, { rapier });
  const [first] = host.players.values(); if (first === undefined) throw new Error('No player');
  host.addPlayer('bot:1', { x: 1, y: 0, z: 0 });
  installPersonalLoot(host, { coins: () => 5, grant: () => undefined });
  const world = new SimNetWorld(host), net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  const seats = [first.id, 'bot:1'].map(id => { const link = directLoopback(), client = new NetClient(link.client), paid: LootPayout[] = []; net.join(link.server, world.playerOf(id)); client.hello(); link.pump(); netLootFeed(client).onPayout(payout => { paid.push(payout); }); return { id, client, link, paid }; });
  net.open(); for (const seat of seats) seat.link.pump();
  const run = (ticks: number): void => { for (let at = 0; at < ticks; at++) { for (const seat of seats) { seat.client.flush(); seat.link.pump(); } net.tick(); for (const seat of seats) { seat.link.pump(); seat.client.present(); } } };
  const kill = (): void => {
    const body = [...host.entities.values()][0]; if (body === undefined) throw new Error('No body');
    for (const player of host.players.values()) host.damage.record({ source: player.health, sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() }, 10, host.players);
    host.events.emit('actor.died', { actor: body.combatActor(), req: { source: 'env', sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() } });
  };
  return { host, kill, run, heard: id => seats.find(seat => seat.id === id)?.paid ?? [], done: () => { net.dispose(); host.dispose(); } };
}

test('a server\'s reward reaches the player it was rolled for, once, through the same feed the page has', () => {
  const live = room(), [lead] = live.host.players.keys();
  try {
    live.run(4); live.kill(); live.run(4);
    expect(live.heard(lead ?? '').map(row => row.coins)).toEqual([5]);
    expect(live.heard('bot:1').map(row => row.coins)).toEqual([5]);
  } finally { live.done(); }
});

test('a room pays a lone player, who has no page feed once the flip takes it, and off a room the page still does', () => {
  for (const alone of [true, false]) {
    const host = createSimHost(SIM_LEVEL, { rapier }), granted: number[] = [], [lead] = host.players.values(), body = [...host.entities.values()][0];
    if (lead === undefined || body === undefined) throw new Error('No room');
    try {
      installPersonalLoot(host, { coins: () => 5, grant: (_player, coins) => { granted.push(coins); }, alone });
      host.damage.record({ source: lead.health, sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() }, 10, host.players);
      host.events.emit('actor.died', { actor: body.combatActor(), req: { source: 'env', sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() } });
      host.step(new Map()); // the tick's flush hears the death
      expect(granted).toEqual(alone ? [5] : []);
    } finally { host.dispose(); }
  }
});
