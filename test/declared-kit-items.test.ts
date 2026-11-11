// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems, type DeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { exportSeats, importSeats } from '../src/server/game/plugin/playerSeats';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

// SR11 (C8, C9): Template's whip and lantern run on the server, fed by a player's wire, as the page's runtime did before the flip.
async function template(): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
const PLAYER = 'actor.player';
let seq = 0;
function command(extra: Partial<NetCommand> = {}): NetCommand {
  return { seq: ++seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0, ...extra };
}
function tick(sim: ShardfileSimulation, kit: DeclaredKitItems, next: NetCommand = command()): void { kit.command(PLAYER, next); sim.host.step(); }
function lines(sim: ShardfileSimulation): Map<string, number> {
  const out = new Map<string, number>();
  for (const read of shardRows(sim.host).owned.values()) read(PLAYER, out);
  return out;
}

test('a whip press strikes with the declared runtime, and the lantern burns and survives a save', async () => {
  const input = await template(), ports = { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } };
  const sim = createShardfileSim(input.shard, input.assets, ports), kit = installDeclaredKitItems(sim.host, input.shard, sim.itemHooks);
  if (kit === null) throw new Error('Template declares kit items');
  const blob = sim.host.entities.get('grey-blob:1'), player = sim.host.players.get(PLAYER);
  if (blob === undefined || player === undefined) throw new Error('Missing template bodies');
  // The player stands a step and a half short of the blob and looks at its body. A press's origin is the server's eye, whatever the page names.
  const close = (): NonNullable<NetCommand['attack']> => {
    player.position.set(blob.position.x, blob.position.y, blob.position.z + 1.5); player.motor.resetAt(player.position);
    const at = { x: 0, y: blob.dims.bodyY * blob.scale - 1.68, z: -1.5 }, length = Math.hypot(at.x, at.y, at.z);
    return { aim: { origin: { x: 500, y: 0, z: 500 }, direction: { x: at.x / length, y: at.y / length, z: at.z / length } } };
  };
  const hp = blob.hp;
  tick(sim, kit, command({ attack: close() }));
  expect(blob.hp).toBe(hp - 18); // the whip's light blow, not the host's zero-damage probe

  // A swap by slot is the sword's, and a heavy press is the sword's heavy.
  expect(kit.equip(PLAYER, 1)).toBe(true);
  expect(player.held).toBe(1);
  expect(kit.equip(PLAYER, 9)).toBe(false);
  for (let i = 0; i < 30; i++) tick(sim, kit);
  tick(sim, kit, command({ buttons: NET_BUTTONS.heavy, attack: close() }));
  expect(blob.alive).toBe(false); // 18 of its 60, then 56 more

  expect(lines(sim).get('template.lantern.lit')).toBe(0);
  expect(kit.scene(PLAYER, 'template.lantern.toggle')).toBe(true);
  expect(kit.scene(PLAYER, 'template.door.toggle')).toBe(false);
  for (let i = 0; i < 120; i++) tick(sim, kit);
  const burning = lines(sim);
  expect(burning.get('template.lantern.lit')).toBe(1);
  expect(burning.get('template.lantern.oil')).toBeLessThan(1);

  const saved = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level;
  let again: { sim?: ShardfileSimulation; kit?: DeclaredKitItems | null } = {};
  const host = restoreSimHost(level, { rapier: input.rapier }, decodeSimSnapshot(saved), restored => {
    const bound = bindShardfileSim(restored, input.shard, input.assets, { ...ports, restoring: true });
    again = { sim: bound, kit: installDeclaredKitItems(restored, input.shard, bound.itemHooks) };
  });
  if (again.sim === undefined) throw new Error('Restore did not install');
  expect(again.sim.host).toBe(host);
  expect(lines(again.sim)).toEqual(burning);

  // A player's document taken into a younger room (E7.4) brings that room's tick along; the items step on from there.
  const younger = createShardfileSim(input.shard, input.assets, ports), there = installDeclaredKitItems(younger.host, input.shard, younger.itemHooks), arrived = younger.host.players.get(PLAYER);
  if (there === null || arrived === undefined) throw new Error('Missing younger room');
  importSeats(younger.host, arrived, exportSeats(sim.host, player));
  expect(() => { tick(younger, there); }).not.toThrow();
  expect(lines(younger).get('template.lantern.lit')).toBe(1);
  sim.dispose(); again.sim.dispose(); younger.dispose();
});
