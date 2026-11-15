// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimCommand, type SimHost, type SimLevel } from '../src/server/engine/sim';
import { SIM_API_VERSION } from '../src/shared/engine/sim/apiVersion';
import { leadCommands, leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { decodeSimSnapshot, serializeSimSnapshot, SIM_SNAPSHOT_VERSION, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { SimNetWorld } from '../src/server/engine/net/simWorld';

// P1-E5.2a: one SimHost, many players. Health, strike runner, motor and every clock of the movement law are per player.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const target = SIM_LEVEL.entities[0]?.id ?? '';
const walk = (moveX: number, moveZ: number, extra: Partial<SimCommand> = {}): SimCommand => ({ moveX, moveZ, yaw: 0, ...extra });
function hostWithPlayers(count: number, level: SimLevel = SIM_LEVEL): SimHost {
  const host = createSimHost(level, { rapier });
  for (let index = 1; index < count; index++) host.addPlayer(`bot:${String(index)}`, { x: index * 2, y: 0, z: 0 });
  return host;
}
const player = (host: SimHost, id: string) => { const found = host.players.get(id); if (found === undefined) throw new Error(`No ${id}`); return found; };

test('a host starts with its lead player, and joining adds one with its own body', () => {
  const host = hostWithPlayers(3);
  expect([...host.players.keys()]).toEqual(['actor.player', 'bot:1', 'bot:2']);
  expect(leadPlayer(host).id).toBe('actor.player');
  const bot = player(host, 'bot:1'), other = player(host, 'bot:2');
  expect(bot.health).not.toBe(other.health); expect(bot.health.id).toBe('bot:1');
  expect(bot.motor).not.toBe(other.motor); expect(bot.strike).not.toBe(other.strike);
  expect(() => host.addPlayer('bot:1')).toThrow(); expect(() => host.addPlayer(target)).toThrow(); expect(() => host.addPlayer('bad id')).toThrow();
  host.dispose();
});

test('the network adapter uses its explicitly selected seat and refuses a missing owner', () => {
  const host = hostWithPlayers(2);
  try {
    expect(new SimNetWorld(host, 0, undefined, 'bot:1').player.id).toBe('bot:1');
    expect(() => new SimNetWorld(host, 0, undefined, 'missing')).toThrow('Unknown net player');
  } finally { host.dispose(); }
});

test('one tick moves each player on its own command and leaves the idle one alone', () => {
  const host = hostWithPlayers(3), bot = player(host, 'bot:1'), idle = player(host, 'bot:2'), lead = leadPlayer(host);
  const start = idle.position.clone(), commands = new Map([[lead.id, walk(0, -1)], [bot.id, walk(1, 0)]]);
  for (let tick = 0; tick < 60; tick++) host.step(commands);
  expect(lead.position.z).toBeCloseTo(-4.06, 1); expect(lead.position.x).toBeCloseTo(0, 2);
  expect(bot.position.x).toBeCloseTo(2 + 4.06, 1); expect(bot.position.z).toBeCloseTo(0, 2);
  expect(idle.position.distanceTo(start)).toBeLessThan(.01); // a resting body steps, so it settles on the ground
  expect(host.state.tick).toBe(60);
  host.dispose();
});

test('a tick refuses a command for a player it does not hold, before anything moves', () => {
  const host = hostWithPlayers(2);
  expect(() => { host.step(new Map([['nobody', walk(1, 0)]])); }).toThrow(RangeError);
  expect(host.state.tick).toBe(0);
  host.dispose();
});

test('a NetCommand drives a player directly, and the world law matches the one tape command it resolves to', () => {
  const host = hostWithPlayers(2), other = createSimHost(SIM_LEVEL, { rapier }), bot = player(host, 'bot:1');
  other.addPlayer('bot:1', { x: 2, y: 0, z: 0 });
  const net = { seq: 1, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0.5, pitch: 0, buttons: NET_BUTTONS.sprint };
  const tape: SimCommand = { moveX: -Math.sin(0.5), moveZ: -Math.cos(0.5), yaw: 0.5, commandVersion: 1, steer: net.steer, sprint: true, crouch: false, dive: false, surface: false };
  for (let tick = 0; tick < 90; tick++) {
    host.step(new Map([[bot.id, { ...net, seq: tick + 1 }]]));
    other.step(new Map([['bot:1', tape]]));
  }
  expect(bot.position.toArray()).toEqual(player(other, 'bot:1').position.toArray());
  expect(bot.position.length()).toBeGreaterThan(4);
  host.dispose(); other.dispose();
});

test('each player owns its strike, and a hit lands from whoever swung', () => {
  const host = hostWithPlayers(2), bot = player(host, 'bot:1'), boar = host.entities.get(target);
  if (boar === undefined) throw new Error('No boar');
  boar.harnessHold = true; bot.position.copy(boar.position); bot.position.x += 1; bot.position.z -= .5; bot.motor.resetAt(bot.position); // inside the arc, not on its edge
  const before = boar.hp, sources: string[] = [];
  host.events.on('damage.dealt', ({ req }) => { if (req.source !== 'env') sources.push(req.source.id); }, host.scope);
  host.step(new Map([[bot.id, walk(0, 0, { attack: { targetId: target } })]]));
  expect(bot.strike.busy).toBe(true); expect(leadPlayer(host).strike.busy).toBe(false);
  for (let tick = 0; tick < 40; tick++) host.step();
  expect(boar.hp).toBeLessThan(before); expect(sources).toEqual(['bot:1']);
  host.dispose();
});

test('a creature deals with the player nearest it, and the dead rank last', () => {
  const host = hostWithPlayers(3), near = player(host, 'bot:2');
  near.position.set(30, 0, 0);
  expect(host.nearestPlayer({ x: 29, y: 0, z: 0 })).toBe(near);
  near.health.attributes.health = 0;
  expect(host.nearestPlayer({ x: 29, y: 0, z: 0 })).toBe(player(host, 'bot:1'));
  near.health.attributes.health = 100;
  const boar = host.entities.get(target);
  if (boar === undefined) throw new Error('No boar');
  boar.position.set(29, 0, 0); host.bodyDt(target); host.brainDt(target);
  expect(host.focusedPlayer).toBe(near); expect(host.playerFocus.x).toBe(30);
  near.position.x = 31; expect(host.playerFocus.x).toBe(31);
  host.dispose();
});

test('with one player the focus is that player, always', () => {
  const host = hostWithPlayers(1), lead = leadPlayer(host);
  lead.position.set(1, 2, 3);
  expect(host.playerFocus.toArray()).toEqual([1, 2, 3]);
  host.dispose();
});

test('a room of players saves and restores exactly', () => {
  const host = hostWithPlayers(4), commands = new Map([...host.players.keys()].map((id, index) => [id, walk(Math.cos(index), Math.sin(index), { commandVersion: 1, sprint: index % 2 === 0 })]));
  for (let tick = 0; tick < 45; tick++) host.step(commands);
  const saved = snapshotSimHost(host), wire = serializeSimSnapshot(saved), decoded = decodeSimSnapshot(wire);
  expect(saved.version).toBe(SIM_SNAPSHOT_VERSION); expect(saved.apiVersion).toBe(SIM_API_VERSION);
  expect(decoded.players.map(entry => entry.id)).toEqual(['actor.player', 'bot:1', 'bot:2', 'bot:3']);
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, decoded);
  expect(canonicalSimDigest(snapshotSimHostBytes(restored))).toBe(canonicalSimDigest(snapshotSimHostBytes(host)));
  for (let tick = 0; tick < 45; tick++) { host.step(commands); restored.step(commands); }
  expect(canonicalSimDigest(snapshotSimHostBytes(restored))).toBe(canonicalSimDigest(snapshotSimHostBytes(host)));
  host.dispose(); restored.dispose();
});

test('queued player references name both seats and still restore legacy default references', () => {
  const host = hostWithPlayers(2);
  let restored: SimHost | undefined, legacy: SimHost | undefined;
  try {
    const owner = player(host, 'actor.player'), other = player(host, 'bot:1');
    host.events.restore({ version: 1, frameCount: 0, frameBound: false, queue: [{ name: 'fault', payload: [owner, other] }] }, value => value);
    const saved = snapshotSimHost(host);
    expect(saved.events.queue[0]?.payload).toEqual({ kind: 'array', items: [{ kind: 'player', id: owner.id }, { kind: 'player', id: other.id }] });
    restored = restoreSimHost(SIM_LEVEL, { rapier }, saved);
    const read = restored.events.snapshot(value => value).queue[0]?.payload;
    if (!Array.isArray(read)) throw new Error('Missing restored player references');
    expect(read[0]).toBe(player(restored, owner.id)); expect(read[1]).toBe(player(restored, other.id));
    const old = structuredClone(saved), event = old.events.queue[0];
    if (event === undefined) throw new Error('Missing saved event');
    event.payload = { kind: 'array', items: [{ kind: 'player' }, { kind: 'player', id: other.id }] };
    legacy = restoreSimHost(SIM_LEVEL, { rapier }, old);
    const prior = legacy.events.snapshot(value => value).queue[0]?.payload;
    if (!Array.isArray(prior)) throw new Error('Missing legacy player references');
    expect(prior[0]).toBe(player(legacy, owner.id)); expect(prior[1]).toBe(player(legacy, other.id));
  } finally { restored?.dispose(); legacy?.dispose(); host.dispose(); }
});

test('legacy references keep their owned identity when an installer reorders the player registry', () => {
  const host = hostWithPlayers(2);
  let restored: SimHost | undefined;
  try {
    const saved = snapshotSimHost(host);
    saved.events.queue.push({ name: 'fault', payload: { kind: 'record', entries: [['owner', { kind: 'player' }], ['other', { kind: 'player', id: 'bot:1' }]] } });
    restored = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => {
      fresh.addPlayer('bot:1');
      const owner = player(fresh, 'actor.player');
      fresh.players.delete(owner.id); fresh.players.set(owner.id, owner);
    });
    const payload = restored.events.snapshot(value => value).queue[0]?.payload;
    expect(payload).toEqual({ owner: player(restored, 'actor.player'), other: player(restored, 'bot:1') });
    const wrong = structuredClone(saved);
    wrong.players.reverse();
    expect(() => restoreSimHost(SIM_LEVEL, { rapier }, wrong)).toThrow('Snapshot instance registrations do not match');
  } finally { restored?.dispose(); host.dispose(); }
});

test('a player leaves: body, health and strike go, the lead cannot, and a save no longer holds them', () => {
  const host = hostWithPlayers(2), bot = player(host, 'bot:1'), colliders = host.physics.world.colliders.len();
  expect(host.removePlayer(leadPlayer(host).id)).toBe(false);
  expect(host.removePlayer('nobody')).toBe(false);
  expect(host.removePlayer(bot.id)).toBe(true);
  expect(host.physics.world.colliders.len()).toBe(colliders - 1);
  expect(host.players.has('bot:1')).toBe(false); expect(host.strikes.has('bot:1')).toBe(false);
  expect(snapshotSimHost(host).players).toHaveLength(1);
  host.step(leadCommands(host, walk(1, 0)));
  host.dispose();
});

test('board-only colliders stand for whoever rides', () => {
  const host = hostWithPlayers(2), bot = player(host, 'bot:1');
  const collider = host.physics.world.createCollider(rapier.ColliderDesc.cuboid(1, 0.1, 1));
  host.boardColliders([collider]);
  expect(collider.isEnabled()).toBe(false);
  bot.setBoard(true); host.step();
  expect(collider.isEnabled()).toBe(true);
  bot.setBoard(false); host.step();
  expect(collider.isEnabled()).toBe(false);
  host.dispose();
});

test('a traversal answers only for the player that declared it', () => {
  const host = hostWithPlayers(2), bot = player(host, 'bot:1'); let asked = 0;
  leadPlayer(host).modes.register({ id: 'climb', hud: 'none', traverse: () => { asked++; return true; } }, host.scope, { events: host.events });
  const start = bot.fall.grounded; bot.fall.grounded = false; bot.velocity.y = -1;
  for (let tick = 0; tick < 5; tick++) host.step();
  expect(asked).toBe(5); expect(leadPlayer(host).mode).toBe('climb'); expect(bot.mode).toBe('foot');
  expect(start).toBe(true); expect(bot.velocity.y).not.toBe(-1);
  host.dispose();
});
