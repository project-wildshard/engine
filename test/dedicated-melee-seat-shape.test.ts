import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { directLoopback } from '../src/test/engine/netLoopback';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc } from '../src/server/host/dedicated/playerDoc';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { serverInput } from './fixtures/dedicated/roomBench';

// MMO-PLAN MP1.6's crossing churn found it (opus-mmo1, 2026-11-16): a native melee plugin with a stepped hold saves the lead seat's
// continuation as its own JSON string, and every other seat's as `{melee, hold}`. A seat is the lead by arriving first, so a player who
// left Sunscar Dunes as the second player and came back to it empty (a crossing, or any rejoin) was refused at import, "Invalid native
// melee JSON continuation", and one who left as the lead and came back second the other way round. A save reads back in either seat.
const SHARD = 'sunscar-dunes';
type Room = Awaited<ReturnType<typeof DedicatedRoom.boot>>;

test('a native melee continuation saved in one seat role restores in the other', { timeout: 120_000 }, async () => {
  const input = await serverInput(SHARD), writes: SaveWrite[] = [], refusals: string[] = [];
  const boot = (): Promise<Room> => DedicatedRoom.boot({ slug: SHARD, build: '', bootId: 'melee-seat-shape', input, now: () => 0,
    post: row => { if (row.kind === 'save') writes.push(row.write); if (row.kind === 'refused') refusals.push(`${row.device}: ${row.reason}`); } });
  const enter = (room: Room, device: string, saved?: SaveWrite): ReturnType<typeof directLoopback> => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.seat({ device, name: device, body: `p.${device}`, seq: saved?.seq ?? 0, doc: saved === undefined ? null : parseDoc(saved.doc, saved.saveVersion, SHARD) },
      link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
    link.pump(); return link;
  };
  const leave = (room: Room, link: ReturnType<typeof directLoopback>, device: string): SaveWrite => {
    for (let tick = 0; tick < 3; tick++) room.tick();
    link.server.close('left');
    const saved = [...writes].reverse().find(write => write.player === device);
    if (saved === undefined) throw new Error(`${device} left with no save`);
    return saved;
  };
  const rooms: Room[] = [];
  try {
    const first = await boot(); rooms.push(first);
    const leadLink = enter(first, 'lead'), secondLink = enter(first, 'second');
    expect(first.bodyOf('lead')?.id, 'the first to arrive is the lead seat').not.toBe(first.bodyOf('second')?.id);
    const second = leave(first, secondLink, 'second'), lead = leave(first, leadLink, 'lead');
    // Back to an empty Sunscar: the one who was second is the lead now
    const empty = await boot(); rooms.push(empty);
    enter(empty, 'second', second);
    expect(refusals).toEqual([]);
    expect(empty.bodyOf('second'), 'seated alone from a second seat\'s save').toBeDefined();
    // And the lead's save, back as the second player beside someone
    const busy = await boot(); rooms.push(busy);
    enter(busy, 'other'); enter(busy, 'lead', lead);
    expect(refusals).toEqual([]);
    expect(busy.bodyOf('lead'), 'seated second from the lead seat\'s save').toBeDefined();
  } finally { for (const room of rooms) room.dispose(); }
});
