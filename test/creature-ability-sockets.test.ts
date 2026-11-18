import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

async function swingFixture(from: string | undefined, x: number, clip = false) {
  const { source, assets } = await creatureVolumeFixture('translation', 2, 0.1, 'hand.R');
  const species = source.rows.species[0], swing = source.rows.strikes[0];
  if (species?.body === undefined || swing === undefined) throw new Error('Missing socket source');
  source.spawn.x = x; source.spawn.z = 7;
  if (clip) { species.body.size = 'giant'; species.body.scale = 0.125; species.body.hits = 'clip'; }
  species.temperament = {
    brain: 'pursue', reaction: 'aggressive', leash: 24, assist: 0, home: { speed: 0, stop: 0 },
    tuning: { speed: 0, turnRate: 0, thinkDivisor: 1, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 60 },
  };
  species.abilities = [{ use: swing.id, range: 2, cooldown: 2, weight: 1, ...(from === undefined ? {} : { from }) }];
  swing.shape = { kind: 'sphere', radius: 0.8 }; swing.windup = 0; swing.recover = 0; swing.active = 0.05;
  source.rows = parseRows(source.rows);
  return { source, assets };
}

test.each([
  { from: 'hand.R', x: 1, loss: 7 },
  { from: undefined, x: 1, loss: 0 },
  { from: undefined, x: 0.7, loss: 7 },
])('constrains real swing contact to the chosen origin ($from, x=$x)', async ({ from, x, loss }) => {
  const { source, assets } = await swingFixture(from, x);
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'), player = sim.host.players.get('actor.player');
    if (actor === undefined || player === undefined) throw new Error('Missing live socket fixture');
    if (from !== undefined) expect(actor.strikePoint(from, new Vector3())?.toArray()).toEqual([1, 1, 7]);
    const initial = player.health.attributes.health;
    let contactOrigin: Vector3 | undefined;
    sim.host.events.on('damage.dealt', event => { contactOrigin = event.req.from; }, sim.host.scope);
    for (let n = 0; n < 8; n++) sim.host.step();
    expect(initial - player.health.attributes.health).toBeCloseTo(loss);
    if (from !== undefined) expect(contactOrigin?.toArray()).toEqual([1, 1, 7]);
  } finally {
    sim.dispose();
  }
});

test('refuses a socket absent from the admitted skin before the brain starts', async () => {
  const { source, assets } = await swingFixture('hand.L', 1), physics = await rapier;
  expect(() => createShardfileSim(source, assets, { rapier: physics })).toThrow('Missing creature strike socket hand.L');
});

test('reads a giant socket through the same animated collision pose', async () => {
  const { source, assets } = await swingFixture('head', 1, true);
  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing live animated socket fixture');
    const before = actor.strikePoint('head', new Vector3())?.x;
    if (before === undefined) throw new Error('Missing animated head socket');
    for (let n = 0; n < 30; n++) sim.host.step();
    expect(actor.strikePoint('head', new Vector3())?.x).toBeCloseTo(before + actor.scale * 0.5);
  } finally {
    sim.dispose();
  }
});
