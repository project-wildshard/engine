// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { declareStandingLooks, publishWorldState, sayFightView } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { ArenaRoomGround, sandWireName } from '../src/shared/game/boss/arenaGround';
import { ARENA_STANDING, ROAMING_STANDING, ROAMING_VIEW } from '../src/shared/game/shardfile/wirePrompts';
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

test('a newcomer is told the looks standing now, and never a cue or a look that has ended (FLIP-6)', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), [lead] = host.players.values(); if (lead === undefined) throw new Error('No lead');
  declareStandingLooks(host, [...ARENA_STANDING, ...ROAMING_STANDING]);
  const world = new SimNetWorld(host), net = new NetRoom({ world, step: (inputs: readonly NetTickInput[]) => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  net.open();
  const join = (id: string): { link: ReturnType<typeof directLoopback>; heard: string[] } => {
    const link = directLoopback(), client = new NetClient(link.client), heard: string[] = [];
    client.onView(view => { heard.push([view.name, ...view.args].join(' ')); });
    net.join(link.server, world.playerOf(id)); client.hello(); link.pump();
    return { link, heard };
  };
  const first = join(lead.id), tick = (ticks: number, seats: readonly { link: ReturnType<typeof directLoopback> }[]): void => { for (let at = 0; at < ticks; at++) { net.tick(); for (const seat of seats) seat.link.pump(); } };
  try {
    sayFightView(host, 'arena.lid.open', [0.2]); sayFightView(host, 'arena.lid.open', [1]);
    sayFightView(host, 'adds.spot', [0, 1]); sayFightView(host, 'adds.spot', [1, 1]); sayFightView(host, 'adds.spot', [1, 0]);
    sayFightView(host, 'strike.arc', [1, 2, 3, 4]); sayFightView(host, 'boss.glow', [0.7]); sayFightView(host, ROAMING_VIEW.room, [1, 0.5]);
    sayFightView(host, ROAMING_VIEW.roar, [1, 2, 3]); sayFightView(host, 'hazard.ring', [0, 1, 2, 3]); sayFightView(host, 'elite.cue', [1]);
    tick(4, [first]);
    const heardFirst = first.heard.length, second = join(host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }).id);
    tick(4, [first, second]);
    expect(second.heard).toEqual(['arena.lid.open 1', 'adds.spot 0 1', 'adds.spot 1 0', 'strike.arc 1 2 3 4', 'boss.glow 0.699999988079071', `${ROAMING_VIEW.room} 1 0.5`]);
    expect(first.heard, 'said to the newcomer alone').toHaveLength(heardFirst);
    sayFightView(host, 'strike.arc.off', []); sayFightView(host, 'arena.shield', [1]); sayFightView(host, 'arena.shield.at', [4, 5, 6]);
    tick(4, [first, second]);
    sayFightView(host, 'arena.fx.hide', []);
    tick(4, [first, second]);
    const third = join(host.addPlayer('bot:2', { x: 4, y: 0, z: 0 }).id);
    tick(4, [first, second, third]);
    expect(third.heard, 'what ended stays down').toEqual(['arena.lid.open 1', 'adds.spot 0 1', 'adds.spot 1 0', 'boss.glow 0.699999988079071', `${ROAMING_VIEW.room} 1 0.5`]);
    tick(4, [first, second, third]);
    expect(third.heard).toHaveLength(5);
  } finally { net.dispose(); host.dispose(); }
});
