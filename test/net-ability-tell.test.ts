import { readFileSync } from 'node:fs';
import { Mesh, Scene } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { buildTerrain } from '@wildshard/format/terrainField';
import { NetClient } from '../src/client/engine/net/client';
import { AbilityTells } from '../src/client/game/shardfile/abilityTell';
import { abilityRows } from '../src/client/game/shardfile/clientRecipes';
import { configureLevel } from '../src/shared/engine/level/selection';
import type { LevelSpec } from '../src/shared/engine/level/spec';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// ONE-FORMAT CC11b3: two pages on one room draw a running ability's ground tell from its animal row (`ability`, `abilityT`)
// and the species' declared ability: a ring through the marked slam's wind-up on both, and nothing for the unmarked bite.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
// a page drapes its tells on its level's ground: flat here, the only part of a level a tell reads
configureLevel({ id: 'cc11b3', ground: { terrain: buildTerrain(77, { landscape: () => 0, trails: [], cabinSites: [] }) } } as unknown as LevelSpec);

interface Frame { readonly ability: number; readonly windup: boolean; readonly rings: readonly number[] }

/** Runs one strike to its end with the slam or the bite weighted, and records what each page's scene shows per tick. */
async function strikeOnTwoPages(weighted: 'slam' | 'bite'): Promise<{ slamIndex: number; biteIndex: number; frames: Frame[] }> {
  const { source, assets } = await creatureVolumeFixture('translation', 2, 0.1, 'hand.R', true);
  const body = source.rows.species[0], strike = source.rows.strikes[0];
  if (body?.body === undefined || strike === undefined) throw new Error('Missing ability source');
  source.spawn.z = 5.5;
  body.body.size = 'giant'; body.body.scale = .125;
  body.temperament = { brain: 'pursue', reaction: 'aggressive', leash: 24, assist: 0, home: { speed: 0, stop: 0 },
    tuning: { speed: 0, turnRate: 0, thinkDivisor: 1, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 60 } };
  const slam = { ...strike, id: 'fixture.slam', windup: 0.8, active: 0.2, recover: 0.4 };
  const bite = { ...strike, windup: 0.8, active: 0.2, recover: 0.4 }; // the fixture's own strike is `fixture.bite`
  source.rows = parseRows({ ...source.rows, species: [{ ...body, abilities: [
    { use: bite.id, range: 2, cooldown: 2, weight: weighted === 'bite' ? 1 : 0 },
    { use: slam.id, range: 2, cooldown: 2, weight: weighted === 'slam' ? 1 : 0, tell: 'ring' },
  ] }], strikes: [bite, ...source.rows.strikes.slice(1), slam] });
  const declared = abilityRows(source.rows).get(body.id) ?? [];

  const sim = createShardfileSim(source, assets, { rapier: await rapier });
  const room = new NetRoom({ world: new SimNetWorld(sim.host), step: () => { sim.host.step(); } });
  const pages = [directLoopback(), directLoopback()].map((link) => {
    const scene = new Scene();
    return { link, client: new NetClient(link.client), scene, tells: new AbilityTells(scene) };
  });
  const frames: Frame[] = [];
  /** One page's frame, as the worker draws it: its row's ability and progress through the species' declared ability. */
  const draw = (page: typeof pages[number], tick: number): { ability: number; rings: number } => {
    const [handle] = [...page.client.entities].find(([, info]) => info.cls.cls === ANIMAL_CLASS.cls && info.id === 'fixture.actor') ?? [];
    const row = handle === undefined ? undefined : page.client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER);
    const ability = Number(row?.['ability'] ?? 0), progress = Number(row?.['abilityT'] ?? 0);
    page.tells.begin();
    if (ability > 0) page.tells.show(declared[ability - 1], progress, Number(row?.['x'] ?? 0), Number(row?.['z'] ?? 0), 0, tick / 60);
    return { ability, rings: page.scene.children.filter((child) => child instanceof Mesh && child.visible).length };
  };
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing actor');
    for (const { link, client } of pages) { room.join(link.server); client.hello(); link.pump(); }
    room.open(); for (const { link } of pages) link.pump();
    let started = false;
    for (let tick = 0; tick < 600; tick++) {
      room.tick(); for (const { link } of pages) link.pump();
      const running = actor.runningAbility, spec = running === undefined ? undefined : declared.find((a) => a.id === running.id);
      if (running !== undefined) started = true;
      const shown = pages.map((page) => draw(page, tick));
      const windup = spec !== undefined && running !== undefined
        && running.progress * (spec.windup + spec.active + spec.recover) < spec.windup;
      frames.push({ ability: shown[0]?.ability ?? 0, windup, rings: shown.map((page) => page.rings) });
      if (started && running === undefined) break;
    }
    expect(started).toBe(true);
    return { slamIndex: declared.findIndex((a) => a.id === slam.id) + 1, biteIndex: declared.findIndex((a) => a.id === bite.id) + 1, frames };
  } finally { room.dispose(); sim.dispose(); }
}

test('both pages show a ring through the marked slam\'s wind-up, and only then', async () => {
  const { slamIndex, frames } = await strikeOnTwoPages('slam');
  const slamming = frames.filter((frame) => frame.ability === slamIndex);
  expect(slamming.length).toBeGreaterThan(30);
  const ringed = frames.filter((frame) => frame.rings.every((rings) => rings === 1));
  expect(ringed.length).toBeGreaterThan(30); // 0.8 s of wind-up at 60 Hz, less the row's own delay
  for (const frame of frames) expect(frame.rings[0]).toBe(frame.rings[1]); // the two pages agree, tick for tick
  // a page's ring lags the server by its row's delay, never leads it: every ringed tick but the last few is a server wind-up tick
  const late = ringed.filter((frame) => !frame.windup);
  expect(late.length).toBeLessThanOrEqual(3);
  expect(frames.at(-1)?.rings).toEqual([0, 0]);
});

test('neither page shows a warning for the unmarked bite', async () => {
  const { biteIndex, frames } = await strikeOnTwoPages('bite');
  expect(frames.filter((frame) => frame.ability === biteIndex).length).toBeGreaterThan(30);
  for (const frame of frames) expect(frame.rings).toEqual([0, 0]);
});
