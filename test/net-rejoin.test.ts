// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { Redial, type LinkState } from '../src/client/engine/net/redial';
import { WebSocketTransport } from '../src/client/engine/net/webSocketTransport';
import type { LedgerFiling } from '../src/server/engine/net/ledgerBook';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import type { Transport } from '../src/shared/engine/net/transport';
import { directLoopback } from '../src/test/engine/netLoopback';
import { socketBench } from './fixtures/socketBench';
import { tcpPuller } from './fixtures/tcpPuller';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E7.1b: a real walking client, on real sockets through a TCP proxy a test can cut, with both ends left to find out for themselves.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const walk = { steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
async function until(what: string, ready: () => boolean, ms = 8000): Promise<void> {
  const started = performance.now();
  while (!ready()) { if (performance.now() - started > ms) throw new Error(`Timed out: ${what}`); await wait(5); }
}

test('a pulled socket mid-walk: it redials, gets welcome and a full frame, walks on, and hears no receipt twice', async () => {
  const bench = await socketBench(), puller = await tcpPuller(bench.url), host = createSimHost(SIM_LEVEL, { rapier }), bot = host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }), grants: LedgerFiling[] = [];
  const steps: NetCommand[] = [];
  const world = new SimNetWorld(host, 0, () => grants.splice(0)), room = new NetRoom({ world, step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) { commands.set(row.player, row.command); steps.push(row.command); }
    host.step(commands);
  } });
  room.open();
  const grant = (id: string): void => { grants.push({ player: bot.id, id, tick: host.state.tick, grant: 'coins', name: 'coins', amount: 1, pending: false }); };
  let accepting = true, seats = 0, held: Transport | null = null;
  const seat = async (): Promise<void> => {
    while (accepting) {
      const end = await bench.accepted();
      if (!accepting) { end.close('restart'); return; }
      held?.close('replaced'); held = end; seats++;
      room.join(end, world.playerOf(bot.id));
    }
  };
  void seat();
  const first = new WebSocketTransport(puller.url), client = new NetClient(first), states: LinkState[] = [], rows = new Map<string, number>(), welcomes: number[] = [], fullFrames: number[] = [];
  client.onLedger(row => { rows.set(row.id, (rows.get(row.id) ?? 0) + 1); });
  client.onFrame(frame => { if (welcomes.length > fullFrames.length) fullFrames.push(frame.rows.size); });
  client.onRejoin(() => { welcomes.push(host.state.tick); });
  const redial = new Redial({ client, transport: first, dial: () => new WebSocketTransport(puller.url), onState: state => { states.push(state); } });
  client.hello();
  const clock = setInterval(() => {
    for (let tick = 0; tick < 2; tick++) room.tick();
    if (client.welcome !== null && client.latest !== null) { client.command(walk); client.command(walk); }
    client.flush();
  }, 33);
  try {
    await until('first frame', () => client.latest !== null);
    grant('before');
    await until('first receipt', () => rows.has('before'));
    await wait(300);
    const at = bot.position.clone();
    expect(at.distanceTo({ x: 3, y: 0, z: 0 } as never)).toBeGreaterThan(0.1);
    const seqBefore = client.latest?.lastSeq ?? 0, entities = client.entities.size;
    const pulled = performance.now();
    puller.pull();
    await until('strip shows', () => states.includes('reconnecting'), 2000);
    const stripMs = performance.now() - pulled;
    grant('during');
    await until('body keeps none of the pull', () => { const frameAge = performance.now() - pulled; return frameAge > 2600; });
    puller.restore();
    await until('strip clears', () => states.at(-1) === 'live', 10_000);
    const backMs = performance.now() - pulled;
    await until('full frame after rejoin', () => fullFrames.length > 0);
    await until('missed receipt', () => rows.has('during'));
    grant('after');
    await until('later receipt', () => rows.has('after'));
    const moved = bot.position.clone();
    await wait(300);
    console.info(`pulled: strip ${stripMs.toFixed(0)} ms, moving ${backMs.toFixed(0)} ms, ${String(redial.attempts)} dials this outage reset, ${String(seats)} seats, states ${states.join(' ')}, seq ${String(seqBefore)} then ${String(client.latest?.lastSeq)}, first full frame rows ${String(fullFrames[0])} of ${String(entities)} entities`);
    expect(states).toEqual(['reconnecting', 'live']);
    expect(seats).toBe(2);
    expect(client.welcome?.player).toBe(bot.id);
    expect(fullFrames[0]).toBeGreaterThan(0);
    expect(client.entities.size).toBe(entities);
    expect(bot.position.distanceTo(moved), 'walks on').toBeGreaterThan(0.1);
    expect(client.latest?.lastSeq, 'seq starts over on the new queue').toBeLessThan(seqBefore + 1000);
    expect([...rows]).toEqual([['before', 1], ['during', 1], ['after', 1]]);
    expect(client.dropped).toBe(0);
  } finally { accepting = false; clearInterval(clock); redial.dispose(); client.dispose(); room.dispose(); host.dispose(); await puller.close(); await bench.close(); }
}, 40_000);

test('a socket reset is redialled from the close, with no wait for silence', async () => {
  const bench = await socketBench(), link = directLoopback();
  const dialled: string[] = [], client = new NetClient(link.client), states: LinkState[] = [];
  try {
    const redial = new Redial({ client, transport: link.client, dial: () => { dialled.push('dial'); return new WebSocketTransport(bench.url); }, onState: state => { states.push(state); } });
    link.server.close('lost');
    await until('a dial', () => dialled.length === 1, 1000);
    redial.dispose();
  } finally { client.dispose(); await bench.close(); }
});

test('rejoin starts `seq` over and clears the old stream, whatever the old `seq` was', () => {
  const one = directLoopback(), two = directLoopback(), client = new NetClient(one.client), host = createSimHost(SIM_LEVEL, { rapier }), world = new SimNetWorld(host), lead = leadPlayer(host);
  const room = new NetRoom({ world, step: inputs => { const commands = new Map<string, NetCommand>(); for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command); host.step(commands); } });
  room.join(one.server, world.playerOf(lead.id)); client.hello('', { player: 'device:a', name: 'A' }, 7); one.pump(); room.open(); one.pump();
  for (let index = 0; index < 40_000; index++) client.command(walk);
  client.flush(); one.pump();
  room.tick(); one.pump();
  expect(client.ledgerSerial).toBe(7);
  one.client.close('lost');
  let told = 0;
  client.onRejoin(() => { told++; });
  room.join(two.server, world.playerOf(lead.id));
  client.rejoin(two.client); two.pump();
  expect(told).toBe(1);
  expect(client.closed).toBeNull();
  expect(client.ledgerSerial, 'a rejoin keeps what it has heard').toBe(7);
  expect(room.identityOf(2)).toEqual({ player: 'device:a', name: 'A' });
  expect(client.welcome?.player).toBe(lead.id);
  // A queue that is new, a `seq` past half the wrap: had it carried on, `flush` would read every command as acked and send none.
  expect(client.command(walk)).toBe(1);
  client.flush(); two.pump();
  for (let tick = 0; tick < 4; tick++) { client.command(walk); client.flush(); two.pump(); room.tick(); two.pump(); }
  expect(client.latest?.lastSeq).toBeGreaterThan(0);
  room.dispose(); host.dispose();
});
