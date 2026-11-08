import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

interface Phone { readonly client: NetClient; readonly link: DirectLoopback; closed: string | null }
function enter(room: DedicatedRoom, device: string, helloDevice = device): Phone {
  const link = directLoopback(), client = new NetClient(link.client), phone: Phone = { client, link, closed: null };
  link.client.onClose(reason => { phone.closed = reason; });
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => {
    client.hello('', { player: helloDevice, name: device }); link.pump();
  });
  link.pump(); return phone;
}
function tick(room: DedicatedRoom, phones: readonly Phone[], count = 4): void {
  for (let index = 0; index < count; index++) {
    room.tick(); for (const phone of phones) phone.link.pump();
  }
}

test('a mismatched seat hello is refused without retaining a seat or replacing another identity', async () => {
  const news: RoomNews[] = [];
  const room = await DedicatedRoom.boot({ slug: 'pine-hollow', build: '', bootId: 'identity-refusal', input: await serverInput('pine-hollow'), now: () => 0, post: row => { news.push(row); } });
  try {
    const good = enter(room, 'device:good'); tick(room, [good]);
    const body = room.bodyOf('device:good'); if (body === undefined) throw new Error('No survivor');
    const wrong = enter(room, 'device:wrong', 'device:good');
    expect(wrong.closed).toBe('refused');
    expect(room.holds('device:wrong')).toBe(false);
    expect(room.taken).toBe(1);
    expect(news.some(row => row.kind === 'seated' && row.device === 'device:wrong')).toBe(false);
    expect(news).toContainEqual({ kind: 'left', device: 'device:wrong', seats: 1 });
    expect(actRoutes(room.host).identities.get(body.id)).toBe('device:good');
    const before = good.client.latest?.tick ?? -1; tick(room, [good]);
    expect(good.client.latest?.tick).toBeGreaterThan(before);
    expect(good.closed).toBeNull();
    const replacement = enter(room, 'device:replacement'); tick(room, [good, replacement]);
    expect(replacement.client.latest).not.toBeNull(); expect(room.taken).toBe(2);
  } finally { room.dispose(); }
});

test('a real profile write refusal removes only the seated owner and the cell keeps sending frames', async () => {
  const news: RoomNews[] = [];
  const room = await DedicatedRoom.boot({ slug: 'pine-hollow', build: '', bootId: 'store-refusal', input: await serverInput('pine-hollow'), now: () => 0, post: row => { news.push(row); } });
  try {
    const bad = enter(room, 'device:bad'), good = enter(room, 'device:good'); tick(room, [bad, good]);
    const offender = room.bodyOf('device:bad'), survivor = room.bodyOf('device:good');
    if (offender === undefined || survivor === undefined) throw new Error('Missing seated players');
    // A live seat whose reward route has lost its durable owner reaches the real E7 profile adapter's false result.
    actRoutes(room.host).identities.set(offender.id, 'device:no-store');
    expect(() => tick(room, [bad, good])).not.toThrow();
    expect(bad.closed).toBe('refused'); expect(good.closed).toBeNull();
    expect(room.holds('device:bad')).toBe(false); expect(room.holds('device:good')).toBe(true);
    expect(actRoutes(room.host).identities.has(offender.id)).toBe(false);
    expect(actRoutes(room.host).identities.get(survivor.id)).toBe('device:good');
    expect(news.some(row => row.kind === 'refused' && row.device === 'device:bad')).toBe(true);
    expect(news.some(row => row.kind === 'save' && row.write.player === 'device:bad')).toBe(false);
    const before = good.client.latest?.tick ?? -1; tick(room, [good]);
    expect(good.client.latest?.tick).toBeGreaterThan(before);
    const back = enter(room, 'device:bad'); tick(room, [good, back]);
    expect(back.client.latest).not.toBeNull(); expect(room.taken).toBe(2);
  } finally { room.dispose(); }
});
