// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-E5: a cell's `native` `track` mover with a `shared` trigger turns when a hook sets its field. Template's own
// door hook (`behaviour/door.as`) toggles shared field 101 (`template.door.open`) from its door prompt; a lift row added here
// rides on that field, as Mossgate's lever and lift (TC-M4) and Brasscap's side door (TC-B7b) will.
const PLAYER = 'actor.player', DOOR_FIELD = 101;
async function withLift() {
  const directory = builtFolder('_template'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile;
  const rest = { at: { x: 4, y: 0, z: 4 }, euler: { x: 0, y: 0, z: 0 } };
  const motion = { driver: { kind: 'track' }, trigger: { kind: 'shared', field: DOOR_FIELD, equals: 1 },
    track: { clip: 'rise', duration: 1, loop: 'once', speed: 1, times: [0, 1], position: [[0, 0, 0], [0, 3, 0]] } };
  const movers = parseMovers([{ id: 'template.lift', entity: 9001, kind: 'platform', ...rest, enabled: true,
    boxes: [{ x: 0, y: 0, z: 0, hx: 1, hy: 0.1, hz: 1, rot: { x: 0, y: 0, z: 0, w: 1 } }], ...lowerMoverMotion(motion, rest), ...motion, execution: 'native' }]);
  // Template rev 8 ships its own lift (TC-M4b); this test drives a fixed one of the same id, so it takes the product's place.
  const shard: Shardfile = { ...base, movers: [...base.movers.filter(mover => mover.id !== 'template.lift'), ...movers] };
  return { shard, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
}

test('a native track mover on a shared trigger rises when the door hook sets its field', async () => {
  const input = await withLift();
  const sim = createShardfileSim(input.shard, input.assets, { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const movers = sim.movers; if (movers === undefined) throw new Error('No mover runtime in the cell');
    for (let i = 0; i < 30; i++) sim.host.step();
    expect(movers.pose('template.lift').position.y).toBeCloseTo(0, 6);
    const door = input.shard.targets.interactions.find(row => row.id.includes('door'));
    if (door === undefined) throw new Error(`No door prompt in ${input.shard.targets.interactions.map(row => row.id).join(', ')}`);
    const player = sim.host.players.get(PLAYER); if (player === undefined) throw new Error('No player');
    // Stand where the door's prompt is seen: its eye (feet + 1.68) beside the prompt, on whichever side its panel leaves clear.
    const stand = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].find(([dx = 0, dz = 0]) => {
      player.position.set(door.at[0] + dx, door.at[1] - 1.68, door.at[2] + dz); player.motor.resetAt(player.position);
      return sim.selectedInteraction(PLAYER) === door.id;
    });
    expect(stand, `door ${door.id} at ${door.at.join(',')} r ${door.radius}`).toBeDefined();
    expect(sim.interact(door.id, PLAYER)).toBe(true);
    for (let i = 0; i < 90; i++) sim.host.step();
    expect(movers.pose('template.lift').position.y).toBeCloseTo(3, 3);
  } finally { sim.dispose(); }
}, 30_000);
