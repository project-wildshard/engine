// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { DODGE_TIME } from '../src/shared/engine/player/dash';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { ConditionedTransport, directLoopback } from '../src/test/engine/netLoopback';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

// P1-E5.3-E6 (J77): dodges run on the server's clock, so a tell costs a round trip and the interpolation delay before the
// guard is up. This measures that cost on the real wire: from the tick a creature's state changes to the tick its answer
// guards the player, for a thumb that presses on the frame the tell is drawn. Add a human's reaction to read it against a tell.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const TICK_MS = FIXED_STEP * 1000, scenario: MotionScenario = { id: 'net-dodge', start: { x: -10, z: 0, yaw: 0 }, ticks: 0, intent: () => ({}), bodyAt: { x: -5, z: 30 } };
const STATE = ANIMAL_CLASS.row.findIndex(column => column.name === 'state');
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Milliseconds from each tell to its guard, over a link of `rttMs`, ±`jitterMs` a way, 2 % loss. */
function answers(rttMs: number, jitterMs: number): number[] {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), link = directLoopback(), random = seeded(rttMs + 7), conditions = { latencyMs: rttMs / 2, jitterMs, lossPct: rttMs === 0 ? 0 : 2, reorderPct: 0, random };
  const up = new ConditionedTransport(link.client, conditions), down = new ConditionedTransport(link.server, conditions);
  let clock = 0;
  const client = new NetClient(up, () => clock), { player } = page, server = host.player, body = [...host.host.entities.values()][0];
  if (body === undefined) throw new Error('No body');
  body.harnessHold = true;
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.host.step(commands);
  } });
  room.join(down); client.hello();
  const pass = (): void => { clock += TICK_MS; up.advance(TICK_MS); down.advance(TICK_MS); link.pump(); };
  for (let at = 0; at < 60; at++) { pass(); if (at === 20) room.open(); room.tick(); }
  const net = new NetPlayer(client, player, page.physics), out = new Float64Array(32), costs: number[] = [];
  player.link = net; player.locked = true;
  let handle = 0, toldAt = -1, pressed = false, shownState = -1;
  for (const [id, info] of client.entities) if (info.id === body.entityId) handle = id;
  for (let tick = 0; tick < 2400; tick++) {
    pass(); net.reconcile(); page.stepWorld(); player.setBodyEnabled(true);
    if (tick % 120 === 60) { toldAt = tick; pressed = false; body.state = 'attack'; }
    if (tick % 120 === 90) body.state = 'idle';
    const drawn = client.interpolator.sample(handle, client.present(), out) ? out[STATE] ?? -1 : -1;
    if (drawn !== shownState) { if (toldAt >= 0 && !pressed && shownState !== -1) { pressed = true; player.touchDodge = true; } shownState = drawn; }
    player.input(FIXED_STEP);
    player.stepDevice(FIXED_STEP); net.present(FIXED_STEP); room.tick();
    if (toldAt >= 0 && pressed && server.dodge.t > 0) { costs.push((tick - toldAt) * TICK_MS); toldAt = -1; }
  }
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
  return costs;
}
const median = (rows: readonly number[]): number => [...rows].sort((a, b) => a - b)[rows.length >> 1] ?? Infinity;

test('a dodge answers a tell a round trip and a render delay late, and the guard outlasts the worst link', () => {
  const rows = [[0, 0], [100, 30], [150, 30]].map(([rtt = 0, jitter = 0]) => { const costs = answers(rtt, jitter); return { rtt, median: median(costs), worst: Math.max(...costs), count: costs.length }; });
  process.stdout.write(`dodge answers ${JSON.stringify(rows)}\n`);
  for (const row of rows) {
    expect(row.count).toBeGreaterThanOrEqual(16);
    // the budget J77 tunes against: RTT, §6.1's first 100 ms of delay, two frames and the jitter of each way
    expect(row.worst).toBeLessThan(row.rtt + 100 + 67 + (row.rtt === 0 ? 0 : 60));
    expect(row.worst).toBeLessThan(DODGE_TIME * 1000 + row.rtt + 100);
  }
});
