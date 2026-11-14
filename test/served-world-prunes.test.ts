import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { directLoopback } from '../src/test/engine/netLoopback';
import { DedicatedRoom, FORGET_PAID_MS } from '../src/server/host/dedicated/dedicatedRoom';
import { serverInput } from './fixtures/dedicated/roomBench';

// SERVER-CELLS SC10 item 6 (J328): a grid cell's world is never rebuilt, so what it keeps per player must not outgrow its live
// players. A thousand visitors pass through Nalati's room (the King's door, the steppe's trample) while one player stays.
const VISITS = 1000;

test('a thousand visits leave each per-player map at its live players\' size', { timeout: 300_000 }, async () => {
  let clock = 0;
  const room = await DedicatedRoom.boot({ slug: 'nalati-grasslands', build: '', bootId: 'prune', input: await serverInput('nalati-grasslands'), now: () => clock, post: row => { if (row.kind === 'refused') throw new Error(row.reason); } });
  try {
    const { host } = room, enter = (device: string): ReturnType<typeof directLoopback> => {
      const link = directLoopback(), client = new NetClient(link.client);
      room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
      link.pump(); return link;
    };
    const tick = (): void => { clock += 1000 / 60; room.tick(); };
    enter('stay'); tick();
    const adapter = (part: string): string => { const found = [...host.adapters].filter(([id]) => id.includes(part) && !id.startsWith('runtime.actor.')); if (found.length === 0) throw new Error(`No ${part} adapter`); return JSON.stringify(found.map(([, row]) => row.snapshot())); };
    for (let visit = 0; visit < VISITS; visit++) {
      const device = `v${String(visit)}`, link = enter(device), body = `p.${device}`;
      host.slots.ledgerDedupe.push(`loot:${body}:boar`); // what a kill would pay them here
      room.book.file({ player: body, grant: 'coins', id: `kill:${String(visit)}`, name: 'coins', amount: 1, pending: false, tick: 0 });
      tick();
      if (visit === 0) for (const part of ['trample', 'king']) expect(adapter(part), `${part} keeps a visitor while they are here`).toContain(body);
      link.server.close('left');
    }
    tick();
    expect(host.players.size, 'the one who stayed').toBe(1);
    expect(Object.keys(room.book.snapshot()), 'receipts go with their saves').toEqual(['actor.player']);
    expect(adapter('trample'), 'no trail kept for anyone gone').not.toMatch(/p\.v\d/u);
    expect(adapter('king'), 'no door kept for anyone gone').not.toMatch(/p\.v\d/u);
    const returner = enter('v7'); host.slots.ledgerDedupe.push('loot:p.v7:boar'); tick(); returner.server.close('left');
    expect(host.slots.ledgerDedupe.filter(row => row.startsWith('loot:p.v')).length, 'a bounce away and back keeps what was paid').toBeGreaterThan(VISITS - 1);
    const until = clock + FORGET_PAID_MS + 20_000; while (clock < until) { clock += 500; room.tick(); }
    expect(host.slots.ledgerDedupe.filter(row => row.startsWith('loot:p.v')), 'five minutes away: forgotten, as a start-over forgot it').toEqual([]);
  } finally { room.dispose(); }
});
