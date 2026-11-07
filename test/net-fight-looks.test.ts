// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { publishWorldState, sayFightView } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { ArenaRoomGround, sandWireName } from '../src/shared/game/boss/arenaGround';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// A fight room through a real room: its drifts as rows a page mirrors, and its looks as calls in order.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const ROOM = { origin: { x: 0, y: 0, z: 0 }, halfWidth: 10, corridorHalfWidth: 2, corridorEnd: 20, cover: { x: 0, z: 0, wid: 1, len: 1, plinthH: 0.2, h: 1 }, pedestal: { x: 5, z: 5 }, beams: [], sandCells: 40 };

test('a page stands on the server\'s sand and draws the fight\'s looks in order', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), [lead] = host.players.values(); if (lead === undefined) throw new Error('No lead');
  const server = new ArenaRoomGround(ROOM), page = new ArenaRoomGround(ROOM), name = sandWireName('room');
  publishWorldState(host, 'room.sand', () => server.sandRows(name));
  const world = new SimNetWorld(host), net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  const link = directLoopback(), client = new NetClient(link.client), heard: string[] = [];
  client.onView(view => { heard.push([view.name, ...view.args].join(' ')); });
  net.join(link.server, world.playerOf(lead.id)); client.hello(); link.pump(); net.open(); link.pump();
  const run = (ticks: number): void => { for (let at = 0; at < ticks; at++) { client.flush(); link.pump(); net.tick(); link.pump(); client.present(); } };
  const mirror = (): void => { const frame = client.latest; if (frame === null) throw new Error('No frame'); page.mirrorSand(strip => client.stateField(frame, `${name}.${String(strip)}`)); };
  try {
    run(20);
    server.addSand(1, 2, 3, 0.7); run(20); mirror();
    expect(page.sandPeak).toBeCloseTo(server.sandPeak, 2);
    expect(page.floorAt(1, 2)).toBeCloseTo(server.floorAt(1, 2) ?? 0, 2);
    server.clearSand(); run(20); mirror();
    expect(page.sandPeak).toBe(0);
    // a frame's repeats of one look go as the last, and two slots of a look are two looks
    sayFightView(host, 'hazard.ring', [0, 1, 2, 3]); sayFightView(host, 'hazard.ring', [0, 1, 2, 4]); sayFightView(host, 'hazard.ring', [1, 5, 6, 7]); sayFightView(host, 'strike.arc.off', []);
    run(10);
    expect(heard).toEqual(['hazard.ring 0 1 2 4', 'hazard.ring 1 5 6 7', 'strike.arc.off']);
  } finally { net.dispose(); host.dispose(); }
});
