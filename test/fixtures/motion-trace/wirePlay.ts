import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../../../src/client/engine/net/client';
import { NetPlayer } from '../../../src/client/engine/net/netPlayer';
import { NetRoom } from '../../../src/server/engine/net/room';
import { SimNetWorld } from '../../../src/server/engine/net/simWorld';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../../../src/shared/engine/core/fixedStep';
import type { Rapier } from '../../../src/shared/engine/physics/rapier';
import { ConditionedTransport, directLoopback, type LinkConditions } from '../../../src/test/engine/netLoopback';
import { HostSide, PageSide, type MotionScenario } from './parity';

// P1-E5.3-I2, I3: a real Player, through a real NetClient and NetRoom, played frame by frame against a real server tick.

/** What a played run measured. */
export interface WirePlay {
  readonly commands: readonly NetCommand[]; readonly sent: number; readonly steps: number; readonly corrections: number; readonly replays: number; readonly offset: number;
  readonly feet: readonly [number, number, number]; readonly feetGap: number; readonly seen: ReadonlySet<'air' | 'swim' | 'board' | 'dodge'>;
  /** Render frames that ended with a correction still gliding, and the longest such run in ticks. */
  readonly glideTicks: number;
}
/** How a run is played. */
export interface WirePlayOptions {
  readonly seconds: number;
  readonly frameMs: (frame: number) => number;
  readonly press?: (frame: number, page: PageSide, host: HostSide) => void;
  /** One way, on each end. Absent: the wire is direct. */
  readonly link?: LinkConditions;
}

export function wirePlay(R: Rapier, scenario: MotionScenario, options: WirePlayOptions): WirePlay {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario), wire = directLoopback(), { link, frameMs, press, seconds } = options;
  const up = link === undefined ? null : new ConditionedTransport(wire.client, link), down = link === undefined ? null : new ConditionedTransport(wire.server, link);
  let clock = 0;
  const pump = (ms: number): void => { up?.advance(ms); down?.advance(ms); wire.pump(); };
  const client = new NetClient(up ?? wire.client, () => clock), { player } = page, commands: NetCommand[] = [];
  const room = new NetRoom({ world: new SimNetWorld(host.host), step: inputs => {
    const step = new Map<string, NetCommand>();
    for (const row of inputs) {
      if (row.command !== null) step.set(row.player, row.command);
      if (row.command !== null && !row.still) commands.push(row.command);
      if (row.extra !== null) commands.push(row.extra);
    }
    host.host.step(step);
  } });
  const seat = room.join(down ?? wire.server); client.hello(); pump(200); room.open(); pump(200);
  const net = new NetPlayer(client, player, page.physics), seen = new Set<'air' | 'swim' | 'board' | 'dodge'>();
  player.link = net; player.locked = true;
  let due = 0, acc = 0, sent = 0, nextTick = 0, last = 0, frame = 0, glide = 0, glideTicks = 0;
  const batch = 2 * FIXED_STEP * 1000 * 60 / 59.9;
  while (clock < seconds * 1000) {
    if (nextTick <= due) { room.tick(); room.tick(); nextTick += batch; pump(batch); clock = Math.max(clock, nextTick - batch); continue; }
    clock = due;
    const dt = (clock - last) / 1000;
    last = clock;
    press?.(frame, page, host);
    net.reconcile(); player.input(dt);
    acc += dt;
    let ran = 0;
    while (acc >= FIXED_STEP && ran < MAX_FIXED_STEPS) {
      page.stepWorld(); player.setBodyEnabled(true);
      const before = net.predictor.pending; player.stepDevice(FIXED_STEP); if (net.predictor.pending > before) sent++;
      if (!player.onGround) seen.add('air');
      if (player.swimming) seen.add('swim');
      if (player.hover) seen.add('board');
      if (player.dodging) seen.add('dodge');
      acc -= FIXED_STEP; ran++;
    }
    if (ran === MAX_FIXED_STEPS && acc >= FIXED_STEP) acc %= FIXED_STEP;
    player.update(dt, acc / FIXED_STEP);
    net.present(dt); pump(0);
    glide = player.renderOffset.lengthSq() > 0 ? glide + ran : 0; glideTicks = Math.max(glideTicks, glide);
    frame++; due += frameMs(frame);
  }
  for (let settle = 0; settle < 7; settle++) { room.tick(); room.tick(); pump(batch); } // inside STALL_TICKS: past it the server takes a step no client took
  net.reconcile();
  const { x, y, z } = player.position;
  const report: WirePlay = { commands, sent, steps: room.lastSeq(seat), corrections: net.predictor.corrections, replays: net.predictor.replays, offset: net.worstOffset, feet: [x, y, z], feetGap: player.position.distanceTo(host.player.position), seen, glideTicks };
  net.dispose(); room.dispose(); page.dispose(); host.dispose();
  return report;
}
