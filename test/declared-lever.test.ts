// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { declaredKitSlots, leverLines } from '../src/shared/game/shardfile/items';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems, type DeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

// TE-ENG2: a lever-action rifle from rows alone (`test/fixtures/declared-lever/rows.json`), on Template's product. It starts on its
// rack; the rack's scene takes it; six rounds leave the tube, each a hitscan that lands on a declared body; R feeds one round at a time.
interface LeverFixture {
  readonly context: Shardfile['items']['contexts'][number]; readonly row: Shardfile['items']['rows'][number];
  readonly interaction: Shardfile['targets']['interactions'][number]; readonly itemActions: NonNullable<Shardfile['targets']['itemActions']>;
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture is the author's rows, typed as the format reads them.
const fixture = JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')) as LeverFixture;
async function withLever(): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile;
  const shard: Shardfile = { ...base,
    items: { ...base.items, contexts: [...base.items.contexts, fixture.context], rows: [...base.items.rows, fixture.row] },
    targets: { ...base.targets, interactions: [...base.targets.interactions, fixture.interaction], itemActions: [...(base.targets.itemActions ?? []), ...fixture.itemActions] } };
  return { shard, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
const PLAYER = 'actor.player', LEVER = 'weapon.fixture-lever', LINES = leverLines(LEVER);
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
const line = (sim: ShardfileSimulation, name: string): number => lines(sim).get(name) ?? 0;

test('a rows-only lever: taken at its rack, six rounds that land, then a reload one round at a time that a save keeps', async () => {
  const input = await withLever(), ports = { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } };
  const sim = createShardfileSim(input.shard, input.assets, ports), kit = installDeclaredKitItems(sim.host, input.shard, sim.itemHooks);
  if (kit === null) throw new Error('The fixture declares kit items');
  const blob = sim.host.entities.get('grey-blob:1'), player = sim.host.players.get(PLAYER), slot = declaredKitSlots(input.shard.items.rows).get(LEVER);
  if (blob === undefined || player === undefined || slot === undefined) throw new Error('Missing fixture bodies');
  expect(slot).toBe(2); // after the whip and the sword: the melee slots are where they were

  // On the rack: no swap to it, no line for it.
  expect(kit.equip(PLAYER, slot)).toBe(true);
  expect(player.held).toBe(0);
  expect(line(sim, LINES.taken)).toBe(0);
  // The rack's scene is judged where the player stands: far from its prompt it takes nothing.
  player.position.set(60, player.position.y, 60); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, 'fixture.rack.take')).toBe(true);
  tick(sim, kit);
  expect(line(sim, LINES.taken)).toBe(0);
  const [rx, , rz] = fixture.interaction.at;
  player.position.set(rx + 1, player.position.y, rz); player.motor.resetAt(player.position);
  expect(kit.scene(PLAYER, fixture.interaction.id)).toBe(true); // the rack's prompt, by its own id: the kit runs it, not a script
  tick(sim, kit);
  expect(player.held).toBe(slot);
  expect(line(sim, LINES.taken)).toBe(1);
  expect(line(sim, LINES.rounds)).toBe(6);
  expect(line(sim, LINES.reserve)).toBe(12);

  // Ten metres off the blob, looking at its body: beyond any melee reach, well inside the rifle's 120.
  const aimed = (): NonNullable<NetCommand['attack']> => {
    player.position.set(blob.position.x + 10, blob.position.y, blob.position.z); player.motor.resetAt(player.position);
    const at = { x: -10, y: blob.dims.bodyY * blob.scale - 1.68, z: 0 }, length = Math.hypot(at.x, at.y, at.z);
    return { aim: { origin: { x: 500, y: 0, z: 500 }, direction: { x: at.x / length, y: at.y / length, z: at.z / length } } };
  };
  const settle = (): void => { for (let i = 0; i < 60; i++) tick(sim, kit); }; // past the 0.68 s cycle
  const hp = blob.hp;
  for (let shot = 1; shot <= 5; shot++) {
    tick(sim, kit, command({ attack: aimed() }));
    expect(blob.hp).toBe(hp - 10 * shot);
    settle();
    expect(line(sim, LINES.rounds)).toBe(6 - shot);
  }
  tick(sim, kit, command({ attack: aimed() }));
  expect(blob.alive).toBe(false); // the sixth round downs the 60-point blob
  settle();
  expect(line(sim, LINES.rounds)).toBe(0);

  // A seventh pull fires nothing: the tube is dry. R starts a reload that feeds one round per 0.4 s after a 0.22 s lift.
  expect(kit.reload(PLAYER, slot)).toBe(true);
  tick(sim, kit);
  expect(line(sim, LINES.reloading)).toBe(1);
  const fed: number[] = [];
  for (let i = 0; i < 60 * 3 && line(sim, LINES.reloading) === 1; i++) { tick(sim, kit); const n = line(sim, LINES.rounds); if (fed.at(-1) !== n) fed.push(n); }
  expect(fed.slice(0, 3)).toEqual([0, 1, 2]); // one round at a time, never a magazine swap
  settle();
  // Pine's law: a dry reload fills the five-round tube, then the lever chambers one of them; a second R tops the tube up.
  expect(line(sim, LINES.rounds)).toBe(5);
  expect(line(sim, LINES.reserve)).toBe(12 - 5);
  expect(kit.reload(PLAYER, slot)).toBe(true);
  for (let i = 0; i < 90; i++) tick(sim, kit);
  expect(line(sim, LINES.rounds)).toBe(6);
  expect(line(sim, LINES.reserve)).toBe(12 - 6);

  // A save keeps the tube, the reserve and the take.
  const saved = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level, before = lines(sim);
  let again: { sim?: ShardfileSimulation; kit?: DeclaredKitItems | null } = {};
  restoreSimHost(level, { rapier: input.rapier }, decodeSimSnapshot(saved), restored => {
    const bound = bindShardfileSim(restored, input.shard, input.assets, { ...ports, restoring: true });
    again = { sim: bound, kit: installDeclaredKitItems(restored, input.shard, bound.itemHooks) };
  });
  if (again.sim === undefined) throw new Error('Restore did not install');
  for (const name of Object.values(LINES)) expect(line(again.sim, name)).toBe(before.get(name) ?? 0);
  sim.dispose(); again.sim.dispose();
});
