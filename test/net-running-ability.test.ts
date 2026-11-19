import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { NetClient } from '../src/client/engine/net/client';
import { abilityRows } from '../src/client/game/shardfile/clientRecipes';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { creatureClipName } from '../src/shared/game/shardfile/creatureClipChoice';
import { directLoopback } from '../src/test/engine/netLoopback';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// ONE-FORMAT CC11a2c: the declared ability a creature runs goes on its animal row (wire 1.4 `ability`, `abilityT`), so a
// page that joined before the strike and one that joined during it pick the same ability until the strike ends.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('a late-joining page and a continuing page read the same running ability until it ends', async () => {
  const { source, assets } = await creatureVolumeFixture('translation', 2, 0.1, 'hand.R', true);
  const body = source.rows.species[0], strike = source.rows.strikes[0];
  if (body?.body === undefined || strike === undefined) throw new Error('Missing ability source');
  source.spawn.z = 5.5;
  body.body.size = 'giant'; body.body.scale = .125;
  body.temperament = { brain: 'pursue', reaction: 'aggressive', leash: 24, assist: 0, home: { speed: 0, stop: 0 },
    tuning: { speed: 0, turnRate: 0, thinkDivisor: 1, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 60 } };
  source.rows = parseRows({ ...source.rows, species: [{ ...body, abilities: [
    { use: 'fixture.unused', range: 0.1, cooldown: 2, weight: 0 },
    { use: strike.id, range: 2, cooldown: 2, weight: 1, clip: 'swing' },
  ] }], strikes: [...source.rows.strikes, { ...strike, id: 'fixture.unused' }] });

  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  const room = new NetRoom({ world: new SimNetWorld(sim.host), step: () => { sim.host.step(); } });
  const early = directLoopback(), late = directLoopback();
  const pages = [{ link: early, client: new NetClient(early.client) }, { link: late, client: new NetClient(late.client) }];
  const [first, second] = pages; if (first === undefined || second === undefined) throw new Error('Missing pages');
  const read = (client: NetClient): { ability: unknown; abilityT: unknown } => {
    const [handle] = [...client.entities].find(([, info]) => info.cls.cls === ANIMAL_CLASS.cls && info.id === 'fixture.actor') ?? [];
    if (handle === undefined) throw new Error('The page has no fixture.actor');
    const row = client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER);
    return { ability: row?.['ability'], abilityT: row?.['abilityT'] };
  };
  const tick = (joined: readonly typeof pages[number][]): void => { room.tick(); for (const { link } of joined) link.pump(); };
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing actor');
    room.join(first.link.server); first.client.hello(); first.link.pump();
    room.open(); first.link.pump();
    for (let at = 0; at < 120 && actor.runningAbility === undefined; at++) tick([first]);
    expect(actor.runningAbility?.id).toBe(strike.id);
    // the late page joins mid-strike
    room.join(second.link.server); second.client.hello(); second.link.pump();
    tick(pages); tick(pages);
    const running = actor.runningAbility;
    expect(running?.id).toBe(strike.id);
    for (const { client } of pages) {
      const row = read(client);
      expect(row.ability).toBe(2); // the second declared ability
      expect(row.abilityT).toBeCloseTo(running?.progress ?? -1, 1);
    }
    // both pages resolve it to the same id and clip, which the skin picks over the attack fallback
    const [shown] = abilityRows(source.rows).get(body.id)?.slice(1) ?? [];
    expect(shown).toEqual({ id: strike.id, clip: 'swing', windup: strike.windup, active: strike.active, recover: strike.recover, reach: expect.any(Number), width: expect.any(Number) });
    for (let at = 0; at < 240 && actor.runningAbility !== undefined; at++) tick(pages);
    expect(actor.runningAbility).toBeUndefined();
    tick(pages);
    for (const { client } of pages) expect(read(client).ability).toBe(0);
  } finally { room.dispose(); sim.dispose(); }
});

test('a row with no running ability (an older room) keeps the attack fallback', () => {
  const clips = { has: (name: string): boolean => name === 'attack' || name === 'swing' };
  expect(creatureClipName('attack', undefined, clips, undefined)).toBe('attack');
  expect(creatureClipName('attack', undefined, clips, { id: 'fixture.strike', clip: 'swing' as never, progress: 0.5 })).toBe('swing');
});
