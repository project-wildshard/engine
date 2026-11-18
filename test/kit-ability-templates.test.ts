import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Vector3 } from 'three';
import { parseRows } from '@wildshard/format/rows';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { authoredStrikeFixture } from './fixtures/authored-strike';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';
import breath from './fixtures/kit-abilities/breath.json';
import shoot from './fixtures/kit-abilities/shoot.json';
import thrown from './fixtures/kit-abilities/throw.json';
import spit from './fixtures/kit-abilities/spit.json';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

function fixture(template: typeof breath | typeof shoot, distance: number) {
  const shard = authoredStrikeFixture(template.strike.id, distance, {});
  const [species] = shard.rows.species;
  if (species === undefined) throw new Error('Missing Kit ability species');
  shard.rows = parseRows({ ...shard.rows, species: [{ ...species, abilities: [template.ability] }], strikes: [template.strike] });
  return shard;
}

test.each([shoot, thrown, spit])('a live $strike.id reaches a player at its authored range', async template => {
  const shard = fixture(template, template.ability.range - 0.2);
  const sim = createShardfileSim(shard, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player');
    if (player === undefined) throw new Error('Missing projectile target');
    let damage = 0;
    sim.host.events.on('damage.dealt', event => { if (event.req.moveId === template.strike.id) damage += event.dealt; }, sim.host.scope);
    for (let tick = 0; tick < 100; tick++) sim.host.step();
    expect(damage).toBe(template.strike.damage);
    expect(player.health.attributes.health).toBe(100 - template.strike.damage);
  } finally { sim.dispose(); }
});

test('Kit breath waits for entry into the wedge during its active window and uses the head socket', async () => {
  const shard = fixture(breath, 5), skin = await creatureVolumeFixture();
  const [species] = shard.rows.species, [skinSpecies] = skin.source.rows.species;
  if (species?.temperament?.tuning === undefined || skinSpecies?.body === undefined) throw new Error('Missing admitted head');
  species.body = skinSpecies.body;
  species.temperament.tuning = { ...species.temperament.tuning, turnRate: 0 };
  shard.rows.looks = skin.source.rows.looks; shard.files = skin.source.files; shard.library = skin.source.library;
  shard.spawn.x = 4.5; shard.spawn.z = 7;
  const sim = createShardfileSim(shard, skin.assets, { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player'), actor = sim.host.entities.get('fixture.actor');
    if (player === undefined || actor === undefined) throw new Error('Missing live breath actors');
    const at = actor.position.clone();
    let from: Vector3 | undefined;
    sim.host.events.on('damage.dealt', event => { if (event.req.moveId === breath.strike.id) from = event.req.from; }, sim.host.scope);
    for (let tick = 0; tick < 24; tick++) sim.host.step();
    expect(sim.host.strikes.get(actor.entityId)?.state).toBe('active');
    expect(player.health.attributes.health).toBe(100);
    player.position.set(0, 0, 2); player.motor.resetAt(player.position);
    for (let tick = 0; tick < 12; tick++) sim.host.step();
    expect(player.health.attributes.health).toBe(100 - breath.strike.damage);
    const head = actor.strikePoint('head', at);
    if (head === undefined) throw new Error('Missing head socket');
    expect(head.y).toBeGreaterThan(actor.position.y);
    expect(from?.distanceTo(head)).toBeLessThan(0.01);
  } finally { sim.dispose(); }
});
