import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { authoredStrikeFixture } from './fixtures/authored-strike';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const actorId = 'fixture.actor', playerId = 'actor.player', strikeId = 'fixture.fireball';

function source() {
  return authoredStrikeFixture(strikeId, 20, {
    damage: 11, projectile: { speed: 20, gravity: 0, radius: 0.1 },
  });
}

test('the server sweeps a live creature fireball for one second and restores its flight exactly', async () => {
  const physics = await rapier, fixture = source();
  const world = createShardfileSim(fixture, new Map(), { rapier: physics });
  const resumed = prepareShardfileSimRestore(fixture, new Map(), { rapier: physics });
  try {
    const player = world.host.players.get(playerId);
    if (player === undefined) throw new Error('Missing projectile target');
    let dealt = 0, hitAt = 0;
    world.host.events.on('damage.dealt', event => { dealt += event.dealt; hitAt = world.host.state.tick; }, world.host.scope);
    world.host.step();
    expect(world.host.strikes.get(actorId)?.state).toBe('active');
    const launched = world.host.state.tick + 1;
    for (let n = 0; n < 15; n++) world.host.step();
    expect(dealt).toBe(0);
    resumed.restore(snapshotSimHost(world.host));
    for (let n = 0; n < 70; n++) {
      world.host.step(); resumed.host.step();
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(world.host));
    }
    expect(dealt).toBe(11);
    expect(Math.abs(hitAt - launched + 1 - 60)).toBeLessThanOrEqual(1);
    expect(world.host.entities.size).toBe(1);
  } finally {
    resumed.host.dispose(); world.dispose();
  }
});

test('a world wall stops the sphere before a player', async () => {
  const fixture = source(), physics = await rapier;
  const world = createShardfileSim(fixture, new Map(), { rapier: physics });
  try {
    const player = world.host.players.get(playerId);
    if (player === undefined) throw new Error('Missing projectile target');
    world.host.step();
    expect(world.host.strikes.get(actorId)?.state).toBe('active');
    world.host.physics.world.createCollider(physics.ColliderDesc.cuboid(2, 2, 0.25)
      .setTranslation(0, 1, -3).setCollisionGroups(groups('WORLD')));
    world.host.physics.step();
    for (let tick = 0; tick < 100; tick++) world.host.step();
    expect(player.health.attributes.health).toBe(100);
    expect(world.host.adapters.get('creatures.strike-flight')?.snapshot()).toEqual(Array.from({ length: 128 }, () => null));
  } finally {
    world.dispose();
  }
});
