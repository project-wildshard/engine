import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { parseRows } from '@wildshard/format/rows';
import { parseSkinFile } from '@wildshard/format/skinAssets';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import deer from './fixtures/kit-wildlife/deer.json';
import wolf from './fixtures/kit-wildlife/wolf.json';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
function fixture(kind: 'deer' | 'wolf') {
  const source = kind === 'deer' ? deer : wolf;
  const shard = emptyShardfile({ slug: 'kit-wildlife', name: 'Kit wildlife', author: 'Test', revision: 1, seed: 42 });
  const glb = new Uint8Array(readFileSync(new URL(`./fixtures/kit-wildlife/${kind}.glb`, import.meta.url)));
  const metadata = new Uint8Array(readFileSync(new URL(`./fixtures/kit-wildlife/${kind}.skin.json`, import.meta.url)));
  const cost = parseSkinFile(metadata).row.cost;
  const file = hashImmutableBytes(glb), skin = hashImmutableBytes(metadata);
  shard.rows = parseRows({ ...shard.rows, species: [source.species], strikes: source.strikes, looks: [
    { id: source.species.body.look, species: source.species.id, recipe: 'platform.skin', material: null, parameters: { skin },
      animation: { recipe: 'platform.clips', parameters: { attackSpan: 1 } } },
  ] });
  shard.files = [{ hash: file, kind: 'glb', compressed: glb.length, ...cost, dependencies: [], critical: false },
    { hash: skin, kind: 'json', compressed: metadata.length, decoded: metadata.length * 2, gpu: 0, triangles: 0, draws: 0, dependencies: [file], critical: false }];
  shard.library = [skin];
  const variant = source.species.variants[0]; if (variant === undefined) throw new Error('Missing wildlife variant');
  const spawn = { id: 'fixture.actor', species: source.species.id, variant: variant.id, at: [0, 0, 0] as [number, number, number],
    seed: 9, scale: 1, yaw: 0, brain: null, strike: null };
  return { shard, assets: new Map([[file, glb], [skin, metadata]]), spawn };
}

test('the actual Kit hind bolts from a nearby player and opens space', async () => {
  const { shard, assets, spawn } = fixture('deer');
  shard.creatures.spawns = [{ ...spawn, at: [0, 0, 4.5], yaw: Math.PI }];
  shard.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
  const sim = createShardfileSim(shard, assets, { rapier: await rapier });
  try {
    const hind = sim.host.entities.get(spawn.id), player = sim.host.players.get('actor.player');
    if (hind === undefined || player === undefined) throw new Error('Missing admitted wildlife');
    const distance = hind.position.distanceTo(player.position);
    expect(hind.hitVolumes?.volumes.length).toBeGreaterThan(0);
    let fled = false;
    for (let tick = 0; tick < 480; tick++) { sim.host.step(); fled ||= hind.state === 'flee'; }
    expect(fled).toBe(true);
    expect(hind.position.distanceTo(player.position)).toBeGreaterThan(distance + 5);
    expect(player.health.attributes.health).toBe(100);
  } finally { sim.dispose(); }
});

test('a hit on a Kit wolf calls only its pack mate within the authored assist radius', async () => {
  const { shard, assets, spawn } = fixture('wolf');
  shard.spawn = { x: 0, y: 0, z: 38, yaw: Math.PI };
  shard.creatures.spawns = [
    { ...spawn, group: 'fixture.pack' },
    { ...spawn, id: 'fixture.near', at: [10, 0, 0], group: 'fixture.pack' },
    { ...spawn, id: 'fixture.far', at: [20, 0, 0], group: 'fixture.pack' },
    { ...spawn, id: 'fixture.other', at: [-10, 0, 0], group: 'fixture.other-pack' },
  ];
  const sim = createShardfileSim(shard, assets, { rapier: await rapier });
  try {
    const lead = sim.host.entities.get(spawn.id), player = sim.host.players.get('actor.player');
    if (lead === undefined || player === undefined) throw new Error('Missing admitted wolf pack');
    expect(lead.hitVolumes?.volumes.length).toBeGreaterThan(0);
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    for (const actor of sim.host.entities.values()) expect(actor.state).not.toBe('stalk');
    sim.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: lead.combatActor(), amount: 1,
      point: lead.position.clone(), dir: new Vector3(0, 0, -1) });
    for (let tick = 0; tick < 6; tick++) sim.host.step();
    for (const id of [spawn.id, 'fixture.near']) expect(sim.host.entities.get(id)?.state, id).toBe('stalk');
    for (const id of ['fixture.far', 'fixture.other']) expect(sim.host.entities.get(id)?.state, id).not.toBe('stalk');
  } finally { sim.dispose(); }
});
