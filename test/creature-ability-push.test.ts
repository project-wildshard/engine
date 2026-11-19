/** OF20c2: an ability row's `impulse` throws the struck player along the strike's facing and up, and its `aimHeight`
 * aims the strike above the target's feet: the declared path carries what a borrowed row's strikeEffects did. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { authoredStrikeFixture } from './fixtures/authored-strike';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test.each([{ lift: 2 }, {}])('a landed engine strike throws the player with its impulse %o', async (lift) => {
  const source = authoredStrikeFixture('fixture.gale', 1.5, { effect: 'impulse', strength: 14, ...lift });
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player');
    if (player === undefined) throw new Error('Missing live impulse target');
    const start = player.position.z, hp = player.health.attributes.health;
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(hp - player.health.attributes.health).toBeCloseTo(7);
    // 14 m/s along the strike's facing carries the player well past a plain blow's slide
    expect(start - player.position.z).toBeGreaterThan(2);
  } finally {
    sim.dispose();
  }
});

test.each([1.2, undefined])('a declared strike aims %s m above the player\'s feet', async (aimHeight) => {
  const source = authoredStrikeFixture('fixture.stoop', 1.5, aimHeight === undefined ? {} : { aimHeight });
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player');
    if (player === undefined) throw new Error('Missing live aim target');
    const aims: number[] = [];
    for (let i = 0; i < 60 && aims.length === 0; i++) {
      const runner = sim.host.strikes.get('fixture.actor');
      if (runner !== undefined && !Object.hasOwn(runner, 'start')) {
        const start = runner.start.bind(runner);
        runner.start = (spec, actor, target) => { aims.push(target.y - player.position.y); start(spec, actor, target); };
      }
      sim.host.step();
    }
    expect(aims[0]).toBeCloseTo(aimHeight ?? 0);
  } finally {
    sim.dispose();
  }
});
