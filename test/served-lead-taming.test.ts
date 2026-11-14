import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { directLoopback } from '../src/test/engine/netLoopback';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { nativeTamingControls } from '../src/server/game/riding/nativeTaming';
import { serverInput } from './fixtures/dedicated/roomBench';

// SERVER-CELLS SC10 review: a served world's lead seat is one body for whoever holds it, and its taming session outlived its player:
// the next player in the seat rode the last one's horse, and the horse was never retired (a grid cell that never starts over gathers
// them toward the roster's 64). A leaving lead's horses now go, as any leaver's do (SC5), and the seat's session starts wild again.
// It also covers SC5's release itself: a retired horse stayed a mountable, so the next mounted step failed the worker ("Missing mounted
// pose actor"); this test failed so before the release left the mounted owner's rows first.
test('a leaving lead\'s bonded horse goes with them, and the next lead starts wild', { timeout: 300_000 }, async () => {
  let clock = 0;
  const room = await DedicatedRoom.boot({ slug: 'nalati-grasslands', build: '', bootId: 'tame', input: await serverInput('nalati-grasslands'), now: () => clock, post: row => { if (row.kind === 'refused') throw new Error(row.reason); } });
  try {
    const { host } = room, enter = (device: string): ReturnType<typeof directLoopback> => {
      const link = directLoopback(), client = new NetClient(link.client);
      room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
      link.pump(); return link;
    };
    const tick = (): void => { clock += 1000 / 60; room.tick(); };
    const a = enter('a'); tick();
    const lead = host.players.get('actor.player'), session = (): ReturnType<NonNullable<ReturnType<typeof nativeTamingControls>>['sessionOf']> => nativeTamingControls(host)?.sessionOf('actor.player');
    if (lead === undefined || session() === undefined) throw new Error('Nalati seats a lead with a taming session');
    // stand beside a wild stallion, and bond it outright
    const stallion = [...host.entities.values()].find(body => body.kind === 'horse' && session()?.promptHorse !== undefined);
    if (stallion === undefined) throw new Error('Nalati has a wild horse');
    let previous = 0;
    for (let i = 0; i < 4000 && session()?.phase !== 'bonded'; i++) {
      const horse = session()?.promptHorse ?? stallion;
      if (session()?.phase === 'wild') lead.resetPose({ x: horse.position.x + 1.5, y: horse.position.y, z: horse.position.z }, lead.yaw);
      if (session()?.phase === 'wild' && session()?.promptHorse !== null) session()?.forceBreak();
      // ride the breaking out as the rig does (nalati-riding-rules): lean into the balance
      const balance = session()?.view.balance ?? 0;
      nativeTamingControls(host)?.press('actor.player', { lean: Math.max(-1, Math.min(1, balance * 8 + (balance - previous) * 20)) }); previous = balance;
      tick();
    }
    expect(session()?.phase, 'the lead bonded a horse').toBe('bonded');
    const bonded = session()?.companion?.entityId;
    expect(bonded).toBeDefined();
    a.server.close('left'); tick(); tick();
    expect(session()?.phase, 'the empty seat keeps no one\'s taming').toBe('wild');
    expect(session()?.companion ?? null).toBeNull();
    expect(host.entities.has(bonded ?? ''), 'the leaver\'s horse went with them').toBe(false);
    const b = enter('b'); tick();
    expect(session()?.phase, 'the next lead starts wild').toBe('wild');
    b.server.close('left'); tick();
  } finally { room.dispose(); }
});
