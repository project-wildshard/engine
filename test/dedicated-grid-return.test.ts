import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { CROSS_MARGIN } from '../src/server/host/dedicated/crossing';
import { gridAssembly, roadName } from '../src/server/host/dedicated/gridCells';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { parseDoc } from '../src/server/host/dedicated/playerDoc';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { ARRIVAL_DEPTH } from '../src/shared/game/grid/zoneWalls';
import { directLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

test('a Far Reach save at the grid exit can enter from the opposite gate with its progress', async () => {
  const slug = 'far-reach', input = await serverInput(slug);
  const news: RoomNews[] = [];
  const room = await DedicatedRoom.boot({ slug, build: 'bench', bootId: 'bench', input,
    road: { name: roadName(slug), assembly: gridAssembly(), seams: [] }, now: () => 0, post: row => { news.push(row); } });
  const source = directLoopback(), target = directLoopback(), client = new NetClient(source.client);
  try {
    const identity = { device: 'returning', name: 'Returning', body: 'returning' };
    room.seat({ ...identity, doc: null, seq: 0 }, source.server,
      () => { client.hello('bench', { player: identity.device, name: identity.name }); source.pump(); });
    const body = room.bodyOf(identity.device);
    if (body === undefined) throw new Error('The source seat did not open');
    body.resetPose({ x: 0, y: 1, z: CHUNK_HALF + CROSS_MARGIN + 0.1 }, 0);
    room.cell.owned.of(body.id).purse.add(37);
    room.drain(true);
    const saved = news.find(row => row.kind === 'save');
    if (saved === undefined) throw new Error('The room did not save the player');
    const { seq } = saved.write, doc = parseDoc(saved.write.doc, saved.write.saveVersion, slug);
    if (doc === null) throw new Error('The saved document did not parse');
    expect(room.holds(identity.device)).toBe(false);
    const at = { x: 0, y: 1, z: -(CHUNK_HALF - ARRIVAL_DEPTH), yaw: Math.PI };
    const arrived = room.admit({ ...identity, doc, seq }, target.server, at);
    if (typeof arrived === 'string') throw new Error(arrived);
    expect(arrived.land(null)).toBe(true);
    expect(room.bodyOf(identity.device)?.position.z).toBe(at.z);
    expect(room.cell.owned.of(arrived.body).purse.coins).toBe(37);
    const outlier = { ...doc, at: { ...doc.at, z: 10_000 } };
    expect(room.admit({ ...identity, device: 'outlier', body: 'outlier', doc: outlier, seq }, target.server, at)).toMatch(/outside the world/u);
  } finally {
    client.dispose();
    room.dispose();
  }
});
