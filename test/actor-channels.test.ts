import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO } from '@wildshard/format/scriptAbiV1';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { directLoopback } from '../src/test/engine/netLoopback';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS, type DecisionWorld } from './fixtures/decisionHarness';

// ONE-FORMAT CC28: a creature's actor channels and its lock answer are the server's, and every page reads them off
// the animal row (wire 1.1 fields 25 to 29).
const every = { on: ['start', 'tick'] as ('start' | 'tick')[], tick: 10 as const };

/** The harness boar with two declared channels, `jaw` (0) and `fade` (1, starting at 1). */
function channelled(world: DecisionWorld): DecisionWorld {
  const [boar] = world.source.rows.species; if (boar === undefined) throw new Error('Missing boar');
  boar.body = { size: 'medium', scale: 1, look: 'boar.look', channels: [{ name: 'jaw' }, { name: 'fade', initial: 1 }], bind: { opacity: 'fade' } };
  boar.temperament = { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
    tuning: { speed: 1.2, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } };
  boar.senses = { notice: 4 };
  world.source.rows.looks = [...world.source.rows.looks, { id: 'boar.look', species: 'boar' } as (typeof world.source.rows.looks)[number]];
  return world;
}

test('a script sets jaw to 0.5 and two pages read 0.5', async () => {
  const guest = await decisionGuest(`emit(${DO.actorChannel},${HARNESS_IDS.a},0,0.5,0);emit(${DO.lockable},${HARNESS_IDS.a},0,0,0);`);
  const run = await runDecisionWorld(channelled(decisionWorld(guest, { ...every, commands: ['actorChannel', 'lockable'] })));
  const { host } = run.live, room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  const pages = [directLoopback(), directLoopback()].map(link => ({ link, client: new NetClient(link.client) }));
  try {
    const body = host.entities.get('actor.a'); if (body === undefined) throw new Error('Missing boar');
    expect([...body.channels]).toEqual([0, 1, 0, 0]);
    run.decide();
    expect(body.channels[0]).toBe(0.5); expect(body.lockable).toBe(false);
    for (const { link, client } of pages) { room.join(link.server); client.hello(); link.pump(); }
    room.open(); for (const { link } of pages) link.pump();
    room.tick(); room.tick(); for (const { link } of pages) link.pump();
    for (const { client } of pages) {
      const [handle] = [...client.entities].find(([, info]) => info.cls.cls === ANIMAL_CLASS.cls && info.id === 'actor.a') ?? [];
      if (handle === undefined) throw new Error('The page has no actor.a');
      const row = client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER);
      expect(row?.['channel1']).toBeCloseTo(0.5, 2);
      expect(row?.['channel2']).toBe(1);
      expect(row?.['lockable']).toBe('off');
    }
    expect(run.decisions.host.metrics()[0]).toMatchObject({ refusals: 0 });
  } finally { room.dispose(); run.dispose(); }
});

test('channel values ride the decision continuation, and an undeclared channel refuses', async () => {
  const guest = await decisionGuest(`emit(${DO.actorChannel},${HARNESS_IDS.a},state(0)>0?2:0,0.25,0);setState(0,state(0)+1);`);
  const run = await runDecisionWorld(channelled(decisionWorld(guest, { ...every, commands: ['actorChannel'] })));
  try {
    const body = run.live.host.entities.get('actor.a'); if (body === undefined) throw new Error('Missing boar');
    run.decide(); expect(body.channels[0]).toBe(0.25);
    const saved = run.decisions.snapshot();
    body.resetChannels(); expect(body.channels[0]).toBe(0);
    run.decisions.restore(saved); expect(body.channels[0]).toBe(0.25);
    // index 2: the boar declares two channels
    run.decide(); expect(run.decisions.host.metrics()[0]?.refusals).toBeGreaterThan(0);
    expect(body.channels[2]).toBe(0);
  } finally { run.dispose(); }
});

test('a page shows the row: channels onto the body, the lock answer over its row', async () => {
  const guest = await decisionGuest('');
  const run = await runDecisionWorld(channelled(decisionWorld(guest, every)));
  try {
    const body = run.live.host.entities.get('actor.a'); if (body === undefined) throw new Error('Missing boar');
    const row = { x: 0, y: 0, z: 0, yaw: 0, state: 'idle' as const, attack: 0, flinch: 0, strafe: 0, brace: 0, hp: 100, alive: true, rise: 0, act: 0 };
    body.showRow({ ...row, channels: [0.5, 0.1, 0, 0], lock: 'off' }, 0);
    expect([...body.channels]).toEqual([0.5, 0.1, 0, 0]); expect(body.lockable).toBe(false);
    body.showRow({ ...row, channels: [0, 0, 0, 0], lock: 'row' }, 0);
    expect(body.lockable).toBe(true);
  } finally { run.dispose(); }
});
