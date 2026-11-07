// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/format/netCommand';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
import { installPlayerDeath } from '../src/client/engine/ui/playerDeath';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { Scope } from '../src/shared/engine/app/scope';
import { PlayerHealth } from '../src/shared/engine/combat/health';
import type { DeathCause } from '../src/shared/engine/combat/pipeline';
import { Events } from '../src/shared/engine/events/events';
import { decodeEvents, messageId, MSG_EVENTS, type NetPlayerDied } from '../src/shared/engine/net/messages';
import { NET_CLASSES } from '../src/shared/engine/net/netSchemas';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { installRoomRespawn } from '../src/server/game/roomRespawn';
import { HostSide, loadCourseRapier, PageSide, type MotionScenario } from './fixtures/motion-trace/parity';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadCourseRapier(); });
const scenario: MotionScenario = { id: 'death-wire', start: { x: -10, z: 0, yaw: 0 }, ticks: 0, intent: () => ({}) };

test.each([false, true, undefined])('the server death reaches only its owner once, with checkpoint %s and the exact cause', checkpoint => {
  const page = new PageSide(rapier, scenario), side = new HostSide(rapier, scenario), { host, player } = side;
  const scope = new Scope('death-proof'), events = new Events(), health = new PlayerHealth(events, { now: () => 0, position: () => page.player.position, dodging: () => false, dodgeGuard: () => false });
  installRoomRespawn(host, []); host.respawn.served = true;
  if (checkpoint === true) player.health.checkpoint(scope, () => { player.resetPose({ x: 8, y: 0, z: 8 }, 0); return true; });
  const peer = host.addPlayer('peer', { x: 30, y: 0, z: 30 }), world = new SimNetWorld(host);
  const room = new NetRoom({ world, step: inputs => {
    const commands = new Map<string, NetCommand>();
    for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command);
    host.step(commands);
  } });
  const link = directLoopback(), otherLink = directLoopback(), client = new NetClient(link.client), other = new NetClient(otherLink.client);
  room.join(link.server); room.join(otherLink.server, world.playerOf(peer.id)); client.hello(); other.hello(); link.pump(); otherLink.pump(); room.open(); link.pump(); otherLink.pump();
  const net = new NetPlayer(client, page.player, page.physics), received: NetPlayerDied[] = [], shown: { cause: DeathCause | undefined; checkpoint: boolean }[] = [], packets: ArrayBuffer[] = [], foreign: NetPlayerDied[] = [], foreignWire: NetPlayerDied[] = [];
  page.player.link = net;
  scope.onDispose(link.client.onMessage((_channel, bytes) => { if (messageId(new Uint8Array(bytes)) === MSG_EVENTS) packets.push(bytes.slice(0)); }));
  scope.onDispose(client.onPlayerDied(event => { received.push(event); net.holdRespawn(); events.emit('player.died', { actor: health, checkpoint: event.checkpoint, ...(event.cause === undefined ? {} : { cause: event.cause }) }); }));
  scope.onDispose(other.onPlayerDied(event => { foreign.push(event); }));
  scope.onDispose(otherLink.client.onMessage((_channel, bytes) => {
    if (messageId(new Uint8Array(bytes)) !== MSG_EVENTS) return;
    const decoded = decodeEvents(new Uint8Array(bytes), cls => { const table = NET_CLASSES[cls]; return table === undefined ? undefined : { bits: table.initial.map(column => column.bits), text: table.text.length }; });
    for (const event of decoded?.events ?? []) if (event.kind === 'player-died') foreignWire.push(event);
  }));
  installPlayerDeath(events, scope, health, { position: () => page.player.position, died: (cause, taken) => { shown.push({ cause, checkpoint: taken }); } });
  const tick = (): void => { room.tick(); link.pump(); otherLink.pump(); };
  try {
    player.resetPose({ x: 20, y: 0, z: 10 }, 0); tick(); tick(); net.reconcile();
    const before = page.player.position.clone(), cause = checkpoint === undefined ? undefined : { kind: 'bear', label: 'a brown bear', text: 'Mauled by a brown bear' };
    const kill = (): void => { host.combat.hit({ source: 'env', sourceTags: [], target: player.health, amount: 1000, point: player.position.clone(), dir: player.position.clone().set(0, 0, 1), ...(cause === undefined ? {} : { cause }) }); tick(); tick(); };
    kill(); events.flush('update');
    expect(received).toHaveLength(1); expect(shown).toEqual([{ cause, checkpoint: checkpoint === true }]); expect(foreign).toEqual([]); expect(foreignWire).toEqual([]);
    expect(player.position.distanceTo(before)).toBeGreaterThan(5); // the worker already reset its authoritative pose
    for (let frame = 0; frame < 8; frame++) { tick(); tick(); net.reconcile(); }
    expect(page.player.position.distanceTo(before)).toBe(0); // the page keeps the death point until dark
    const replay = packets.slice(); for (const bytes of replay) link.server.send('reliable', bytes); link.pump(); events.flush('update');
    expect(received).toHaveLength(1); expect(shown).toHaveLength(1);
    net.resumeRespawn(); net.reconcile();
    expect(page.player.position.distanceTo(player.position)).toBeLessThan(0.02);
    for (let frame = 0; frame < 120; frame++) tick();
    kill(); events.flush('update'); expect(received).toHaveLength(2); expect(shown).toHaveLength(2); expect(foreign).toEqual([]); expect(foreignWire).toEqual([]);
    host.combat.hit({ source: 'env', sourceTags: [], target: peer.health, amount: 1000, point: peer.position.clone(), dir: peer.position.clone().set(0, 0, 1) }); tick(); tick(); events.flush('update');
    expect(received).toHaveLength(2); expect(shown).toHaveLength(2); expect(foreign).toHaveLength(1); expect(foreignWire).toHaveLength(1);
  } finally { scope.dispose(); net.dispose(); client.dispose(); other.dispose(); room.dispose(); page.dispose(); side.dispose(); }
});
