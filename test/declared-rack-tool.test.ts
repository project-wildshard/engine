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
import { rackToolRows, takenLine } from '../src/shared/game/shardfile/items';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems, type DeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// SHARD-SOURCE SS-GF1a1a: a lantern found on a stand (Glowfen's spirit lanterns). A tool an item scene takes (action 3) that
// the loadout does not carry starts on its rack for each player; the take puts it in that player's kit lit and full, the
// owned `.taken` line tells the page, a later take refills it without putting it out, and a save keeps it taken.
const PLAYER = 'actor.player', SCENE = 'fixture.lantern-rack.take', USE = 'fixture.lantern-rack.use', AT: [number, number, number] = [20, 0, 20];
const LANTERN = 'tool.template-lantern';
async function withRack(): Promise<{ readonly shard: Shardfile; readonly base: Shardfile; readonly sim: ShardfileSimulation; readonly ports: Parameters<typeof createShardfileSim>[2]; readonly assets: Map<string, Uint8Array> }> {
  const directory = builtFolder('_template'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile;
  // the lantern leaves the loadout for a stand; its toggle key (`template.lantern.toggle`, action 3 with no prompt) stays
  const shard: Shardfile = { ...base, items: { ...base.items, loadout: { ...base.items.loadout, tools: base.items.loadout.tools.filter(id => id !== LANTERN) } },
    targets: { ...base.targets,
      interactions: [...base.targets.interactions, { id: USE, at: AT, radius: 2, label: 'Take the lantern', scene: SCENE }],
      itemActions: [...base.targets.itemActions ?? [], { scene: SCENE, item: LANTERN, action: 3 }] } };
  const ports = { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), quest: { fact: () => undefined, coins: () => undefined } };
  return { shard, base, sim: createShardfileSim(shard, assets, ports), ports, assets };
}
let seq = 0;
const command = (): NetCommand => ({ seq: ++seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
function tick(sim: ShardfileSimulation, kit: DeclaredKitItems, n = 1): void { for (let i = 0; i < n; i++) { kit.command(PLAYER, command()); sim.host.step(); } }
function lines(sim: ShardfileSimulation): Map<string, number> {
  const out = new Map<string, number>();
  for (const read of shardRows(sim.host).owned.values()) read(PLAYER, out);
  return out;
}

test('a lantern on a stand: taken near it into the kit lit and full, refilled by a later take, kept by a save', async () => {
  const { shard, sim, ports, assets } = await withRack();
  expect([...rackToolRows(shard)]).toEqual([LANTERN]);
  const kit = installDeclaredKitItems(sim.host, shard, sim.itemHooks), player = sim.host.players.get(PLAYER);
  if (kit === null || player === undefined) throw new Error('Missing fixture bodies');
  const TAKEN = takenLine(LANTERN);
  tick(sim, kit);
  expect(lines(sim).get(TAKEN)).toBe(0);
  expect(lines(sim).get('template.lantern.lit')).toBe(0);
  // Its toggle key is no take: it does nothing while the lantern hangs on its stand (review MUST-FIX, plan/ss10d).
  expect(kit.scene(PLAYER, 'template.lantern.toggle')).toBe(true);
  tick(sim, kit, 3);
  expect(lines(sim).get(TAKEN)).toBe(0);
  expect(lines(sim).get('template.lantern.lit')).toBe(0);
  // Far from the stand the take does nothing.
  player.position.set(60, player.position.y, 60); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, SCENE)).toBe(true);
  tick(sim, kit, 3);
  expect(lines(sim).get(TAKEN)).toBe(0);
  expect(lines(sim).get('template.lantern.lit')).toBe(0);
  // At the stand it comes into the kit, lit and full.
  player.position.set(AT[0] + 1, player.position.y, AT[2]); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, USE)).toBe(true); // the stand's prompt, by its own id, as the page sends it
  tick(sim, kit, 3);
  expect(lines(sim).get(TAKEN)).toBe(1);
  expect(lines(sim).get('template.lantern.lit')).toBe(1);
  // It burns; another take refills it and leaves it lit (never a toggle off).
  tick(sim, kit, 600);
  const burnt = lines(sim).get('template.lantern.oil') ?? 1;
  expect(burnt).toBeLessThan(1);
  expect(kit.scene(PLAYER, USE)).toBe(true);
  tick(sim, kit, 3);
  expect(lines(sim).get('template.lantern.lit')).toBe(1);
  expect(lines(sim).get('template.lantern.oil')).toBeGreaterThan(burnt);

  // Once taken, the toggle key puts it out and lights it again: a toggle, never a refill.
  expect(kit.scene(PLAYER, 'template.lantern.toggle')).toBe(true);
  tick(sim, kit, 3);
  expect(lines(sim).get('template.lantern.lit')).toBe(0);
  expect(kit.scene(PLAYER, 'template.lantern.toggle')).toBe(true);
  tick(sim, kit, 3);
  expect(lines(sim).get('template.lantern.lit')).toBe(1);

  // A save keeps the take.
  const saved = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level;
  let again: ShardfileSimulation | undefined;
  restoreSimHost(level, { rapier: ports.rapier }, decodeSimSnapshot(saved), restored => {
    again = bindShardfileSim(restored, shard, assets, { ...ports, restoring: true });
    installDeclaredKitItems(restored, shard, again.itemHooks);
  });
  if (again === undefined) throw new Error('Restore did not install');
  expect(lines(again).get(TAKEN)).toBe(1);
  sim.dispose(); again.dispose();
});

test('a tool the loadout carries, or one no take names, is never on a rack', async () => {
  const { base, sim } = await withRack();
  expect(rackToolRows(base).size).toBe(0);
  sim.dispose();
});
