// SERVER-PARITY HS5 (meta docs/plans/SERVER-PARITY-PLAN.md): status effects on the room server. The page's EffectService was
// their only owner, so after the flip the template whip's heavy landed its blow and dropped its poison (engine 59737ce9: "the
// whip heavy's poison still has no server owner"). The room now runs the same service: the poison applies, ticks its row's
// damage on its row's period, expires, and a second player sees the creature's health fall with it.
// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { installStatusEffects } from '../src/server/game/shardfile/statusEffects';
import { statusLine } from '../src/shared/game/systems/effects/starterEffects';
import { directLoopback } from '../src/test/engine/netLoopback';
import STARTER from '../src/shared/game/systems/effects/starterRows.json' with { type: 'json' };
import { builtProduct } from './fixtures/builtProduct';

const POISON = STARTER.find(row => row.id === 'effect.poison');
const BLOB = 'grey-blob:1', HEAVY = 30;

async function templateCell() {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return openCellWorld({ instance: '_template' }, { shard: product.shardfile, product, assets, rapier }, undefined, { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
}

test('in a room the whip heavy poisons a creature: the row\'s damage on the row\'s period, then it expires, and another player sees it', { timeout: 120_000 }, async () => {
  if (POISON?.period === undefined || POISON.tickDamage === undefined) throw new Error('The starter rows declare a periodic poison');
  const cell = await templateCell(), { host } = cell;
  // One tick's command for the attacker, put in place of what its client sent.
  let strike: { player: string; command: NetCommand } | null = null;
  const world = new SimNetWorld(host), lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('Missing the lead player');
  const room = new NetRoom({ world, step: inputs => {
    const struck = strike; strike = null;
    if (struck === null) { cell.step(inputs); return; }
    const rest = inputs.filter(input => input.player !== struck.player);
    cell.step([...rest, { client: 0, player: struck.player, command: struck.command, extra: null, acts: [] } as unknown as NetTickInput]);
  } });
  const one = directLoopback(), two = directLoopback(), attacker = new NetClient(one.client), watcher = new NetClient(two.client);
  try {
    room.join(one.server); attacker.hello(); one.pump(); room.open(); one.pump();
    const second = host.addPlayer('bot:watcher', { x: lead.position.x + 3, y: lead.position.y, z: lead.position.z });
    room.join(two.server, world.playerOf(second.id)); watcher.hello('', { player: 'device:watcher', name: 'Watcher' }); two.pump();
    const pump = (): void => { room.tick(); one.pump(); two.pump(); };
    for (let i = 0; i < 4; i++) pump();
    const id = attacker.welcome?.player, player = id === undefined ? undefined : host.players.get(id), blob = host.entities.get(BLOB);
    if (id === undefined || player === undefined || blob === undefined) throw new Error('Missing the attacker or the blob');
    expect(watcher.welcome?.player).not.toBe(id);
    // The watcher sees the blob's health on its row, as every page draws a creature's.
    const seen = (): unknown => {
      const frame = watcher.latest, handle = [...watcher.entities.values()].find(entity => entity.id === BLOB)?.handle;
      return frame === null || handle === undefined ? undefined : watcher.fields(frame, handle)?.['hp'];
    };
    const actor = blob.combatActor(), full = blob.hp;
    const poisoned = (): boolean => (actor.effectTags ?? []).includes('status.poison');

    // The attacker stands a step and a half short of the blob, holds the whip (slot 0) and presses heavy at its body.
    player.position.set(blob.position.x, blob.position.y, blob.position.z + 1.5); player.motor.resetAt(player.position);
    const at = { x: 0, y: blob.dims.bodyY * blob.scale - 1.68, z: -1.5 }, length = Math.hypot(at.x, at.y, at.z);
    strike = { player: id, command: { seq: 9_000, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.heavy,
      attack: { aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: at.x / length, y: at.y / length, z: at.z / length } } } } };
    pump();
    expect(blob.hp, 'the heavy blow lands').toBe(full - HEAVY);
    expect(poisoned(), 'and its poison takes').toBe(true);

    // Every tick for the poison's duration and two seconds past it: health falls by the row's damage once a period.
    const ticks = Math.round((POISON.duration + 2) / FIXED_STEP), period = Math.round(POISON.period / FIXED_STEP), drops: number[] = [];
    let last = blob.hp, expired = -1;
    for (let tick = 1; tick <= ticks; tick++) {
      pump();
      if (blob.hp !== last) { expect(last - blob.hp).toBe(POISON.tickDamage); drops.push(tick); last = blob.hp; }
      if (expired < 0 && !poisoned()) expired = tick;
    }
    const count = Math.round(POISON.duration / POISON.period);
    expect(drops, 'one tick of damage a period').toEqual(Array.from({ length: count }, (_, n) => (n + 1) * period));
    expect(blob.hp).toBe(full - HEAVY - count * POISON.tickDamage);
    expect(expired, 'the poison expires on its last tick').toBe(Math.round(POISON.duration / FIXED_STEP));
    expect(blob.alive).toBe(true);
    expect(seen(), 'the other player sees the same health').toBe(Math.ceil(blob.hp));

    // A poisoned player: the same ticks off its health, which the other player sees on its row, and its own page hears the status as a line.
    const status = installStatusEffects(host), health = second.health, start = health.attributes.health;
    expect(status.apply(health, 'effect.poison', actor)).toBe(true);
    expect(status.apply(health, 'effect.nothing', actor), 'a status no row declares is refused').toBe(false);
    for (let tick = 0; tick < period; tick++) pump();
    expect(health.attributes.health).toBe(start - POISON.tickDamage);
    expect(watcher.owned.get(statusLine('effect.poison')), 'the poisoned player\'s page hears what is left').toBeCloseTo(POISON.duration - POISON.period, 0);
    const row = (): unknown => {
      const frame = attacker.latest, handle = [...attacker.entities.values()].find(entity => entity.id === second.id)?.handle;
      return frame === null || handle === undefined ? undefined : attacker.fields(frame, handle)?.['hp'];
    };
    pump(); pump(); // the next frame
    expect(row(), 'the attacker sees it').toBe(Math.ceil(health.attributes.health));
    for (let tick = 0; tick < Math.round(POISON.duration / FIXED_STEP) + 2; tick++) pump();
    expect(health.attributes.health).toBe(start - count * POISON.tickDamage);
    expect(watcher.owned.has(statusLine('effect.poison')), 'an expired status leaves the line').toBe(false);
    expect(status.active(health)).toEqual([]);
  } finally { room.dispose(); cell.dispose(); }
});
