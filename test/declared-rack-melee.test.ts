// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { declaredKitSlots, rackMeleeRows, takenLine } from '../src/shared/game/shardfile/items';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems, type DeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// TEMPLATE-E2E TC-E4 (J361, Jake 2026-11-15: "Mossgate's sword is found on a rack"): Template's sword leaves the loadout's
// hand for a rack. It starts on that rack for each player; the rack's take (an item scene, action 3) puts it in that player's
// hand, the owned `.taken` line tells the page, and a save keeps it taken.
const PLAYER = 'actor.player', SCENE = 'fixture.sword-rack.take', AT: [number, number, number] = [20, 0, 20];
async function withRack(): Promise<{ readonly shard: Shardfile; readonly sim: ShardfileSimulation; readonly ports: Parameters<typeof createShardfileSim>[2]; readonly assets: Map<string, Uint8Array>; readonly sword: string }> {
  const directory = GAMEPLAY_SLICE, product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing gameplay slice output');
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile, primary = base.items.loadout.primary;
  const sword = base.items.rows.find(row => row.kind === 'weapon' && row.family === 'kit.melee' && row.id !== primary)?.id;
  if (sword === undefined) throw new Error('Template has a second melee weapon');
  const shard: Shardfile = { ...base, targets: { ...base.targets,
    interactions: [...base.targets.interactions, { id: 'fixture.sword-rack.use', at: AT, radius: 2, label: 'Take the sword', scene: SCENE }],
    itemActions: [...(base.targets.itemActions ?? []), { scene: SCENE, item: sword, action: 3 }] } };
  const ports = { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), quest: { fact: () => undefined, coins: () => undefined } };
  return { shard, sim: createShardfileSim(shard, assets, ports), ports, assets, sword };
}
let seq = 0;
const command = (): NetCommand => ({ seq: ++seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
function tick(sim: ShardfileSimulation, kit: DeclaredKitItems): void { kit.command(PLAYER, command()); sim.host.step(); }
function line(sim: ShardfileSimulation, name: string): number {
  const out = new Map<string, number>();
  for (const read of shardRows(sim.host).owned.values()) read(PLAYER, out);
  return out.get(name) ?? 0;
}

test('a melee weapon on a rack: no swap to it, taken near its rack into the hand, kept by a save', async () => {
  const { shard, sim, ports, assets, sword } = await withRack();
  expect([...rackMeleeRows(shard)]).toEqual([sword]);
  const kit = installDeclaredKitItems(sim.host, shard, sim.itemHooks), player = sim.host.players.get(PLAYER), slot = declaredKitSlots(shard.items.rows).get(sword);
  if (kit === null || player === undefined || slot === undefined) throw new Error('Missing fixture bodies');
  const TAKEN = takenLine(sword);

  // On its rack: a swap to it is spent and the hand stays where it is.
  expect(kit.equip(PLAYER, slot)).toBe(true);
  tick(sim, kit);
  expect(player.held).not.toBe(slot);
  expect(line(sim, TAKEN)).toBe(0);
  // Far from the rack's prompt the take does nothing.
  player.position.set(60, player.position.y, 60); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, SCENE)).toBe(true);
  tick(sim, kit);
  expect(line(sim, TAKEN)).toBe(0);
  // At the rack it comes to hand.
  player.position.set(AT[0] + 1, player.position.y, AT[2]); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, 'fixture.sword-rack.use')).toBe(true); // the rack's prompt, by its own id, as the page sends it
  tick(sim, kit);
  expect(player.held).toBe(slot);
  expect(line(sim, TAKEN)).toBe(1);
  // Taken, it swaps like any weapon.
  expect(kit.equip(PLAYER, 0)).toBe(true); tick(sim, kit);
  expect(player.held).toBe(0);
  expect(kit.equip(PLAYER, slot)).toBe(true); tick(sim, kit);
  expect(player.held).toBe(slot);

  // A save keeps the take.
  const saved = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level;
  let again: ShardfileSimulation | undefined;
  restoreSimHost(level, { rapier: ports.rapier }, decodeSimSnapshot(saved), restored => {
    again = bindShardfileSim(restored, shard, assets, { ...ports, restoring: true });
    installDeclaredKitItems(restored, shard, again.itemHooks);
  });
  if (again === undefined) throw new Error('Restore did not install');
  expect(line(again, TAKEN)).toBe(1);
  sim.dispose(); again.dispose();
});

test('a melee weapon with no rack take, or the loadout primary, is never racked', async () => {
  const { shard, sim, sword } = await withRack();
  // Template rev 7 racks the sword itself (`template.rack.take`, TC-M5b), so "no rack take" drops that take too.
  const bare = { ...shard, targets: { ...shard.targets, itemActions: (shard.targets.itemActions ?? []).filter(row => row.action !== 3 || row.item !== sword) } };
  expect(rackMeleeRows(bare).size).toBe(0);
  const primary = shard.items.loadout.primary;
  if (primary === null) throw new Error('Template has a primary');
  const onPrimary = { ...shard, targets: { ...shard.targets, itemActions: [{ scene: SCENE, item: primary, action: 3 }] } };
  expect(rackMeleeRows(onPrimary).size).toBe(0);
  sim.dispose();
});
