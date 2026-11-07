// The law `pageLootFeed` held, on the server (J105): a slot pays what the shard started with, a kind worth nothing pays nothing, and a
// reload resets none of it. The page's feed goes at the flip; this is what stays.
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { directLoopback } from '../src/test/engine/netLoopback';
import { netLootFeed, type LootPayout } from '../src/client/game/loot/feed';
import { installPersonalLoot, type PersonalLootPorts } from '../src/server/game/loot/personal';
import { SIM_CREATURE_RECIPE } from '../src/test/game/creatureRecipe';
import { SIM_LEVEL } from './fixtures/sim-level/level';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const LEVEL = { ...SIM_LEVEL, entities: ['boar:1', 'boar:2'].map(id => Object.assign(structuredClone(SIM_CREATURE_RECIPE), { id })) };
const kill = (host: SimHost, id: string): void => {
  const body = host.entities.get(id), [lead] = host.players.values();
  if (body === undefined || lead === undefined) throw new Error('Missing fixture');
  const hit = { source: lead.health, sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() };
  host.damage.record(hit, 10, host.players);
  host.events.emit('actor.died', { actor: body.combatActor(), req: hit });
  host.step(new Map()); // the tick's flush hears the death
};
const lone = (coins: PersonalLootPorts['coins'], paid: number[], host = createSimHost(LEVEL, { rapier })): SimHost => {
  installPersonalLoot(host, { coins, grant: (_player, amount) => { paid.push(amount); }, alone: true });
  return host;
};

test('a slot pays as many deaths as the shard started with, and a respawn\'s none', () => {
  const paid: number[] = [], host = lone(() => 5, paid), [one] = host.entities.values();
  if (one === undefined) throw new Error('Missing body');
  const slot = one.herd < 0 ? one.kind : `${one.kind}:${String(one.herd)}`, shared = [...host.entities.values()].filter(body => (body.herd < 0 ? body.kind : `${body.kind}:${String(body.herd)}`) === slot);
  try {
    expect(shared.length, 'both bodies stand in one slot').toBe(2);
    kill(host, one.entityId); kill(host, one.entityId); kill(host, one.entityId);
    expect(paid).toEqual([5, 5]);
  } finally { host.dispose(); }
});

test('a save keeps what a slot has paid', () => {
  const paid: number[] = [], host = lone(() => 5, paid), [one] = host.entities.values();
  if (one === undefined) throw new Error('Missing body');
  try {
    kill(host, one.entityId); kill(host, one.entityId);
    const after: number[] = [], back = restoreSimHost(LEVEL, { rapier }, snapshotSimHost(host), restored => { installPersonalLoot(restored, { coins: () => 5, grant: (_player, amount) => { after.push(amount); }, alone: true }); });
    try { kill(back, one.entityId); expect(after, 'a reload does not refill the bounty').toEqual([]); } finally { back.dispose(); }
  } finally { host.dispose(); }
});

test('a kind worth nothing pays nothing, and spends none of its slot', () => {
  const paid: number[] = [];
  let worth = 0;
  const host = lone(() => worth, paid), [one] = host.entities.values();
  if (one === undefined) throw new Error('Missing body');
  try {
    kill(host, one.entityId); expect(paid).toEqual([]); expect(host.slots.ledgerDedupe).toEqual([]);
    worth = 5; kill(host, one.entityId); expect(paid).toEqual([5]);
  } finally { host.dispose(); }
});

test('a page\'s listener stops when it says so, on the wire as it did on the page', () => {
  const host = createSimHost(LEVEL, { rapier }), [lead] = host.players.values();
  if (lead === undefined) throw new Error('No player');
  installPersonalLoot(host, { coins: () => 5, grant: () => undefined, alone: true });
  const world = new SimNetWorld(host), net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => { host.step(new Map(inputs.flatMap(row => row.command === null ? [] : [[row.player, row.command]]))); } });
  const link = directLoopback(), client = new NetClient(link.client), paid: LootPayout[] = [];
  net.join(link.server, world.playerOf(lead.id)); client.hello(); link.pump();
  const stop = netLootFeed(client).onPayout(payout => { paid.push(payout); });
  net.open(); link.pump();
  const run = (ticks: number): void => { for (let at = 0; at < ticks; at++) { client.flush(); link.pump(); net.tick(); link.pump(); client.present(); } };
  const die = (id: string): void => {
    const body = host.entities.get(id); if (body === undefined) throw new Error('No body');
    const hit = { source: lead.health, sourceTags: [], target: body.combatActor(), amount: 10, point: new Vector3(), dir: new Vector3() };
    host.damage.record(hit, 10, host.players); host.events.emit('actor.died', { actor: body.combatActor(), req: hit });
  };
  try {
    const [one, two] = [...host.entities.keys()];
    run(4); die(one ?? ''); run(4);
    expect(paid.map(row => row.coins)).toEqual([5]);
    stop(); die(two ?? ''); run(4);
    expect(paid, 'a stopped listener hears nothing').toHaveLength(1);
  } finally { net.dispose(); host.dispose(); }
});
