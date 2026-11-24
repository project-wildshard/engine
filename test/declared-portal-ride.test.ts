import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { DirectorsSchema } from '@wildshard/format/directorStages';
import { EntrywaysSchema } from '@wildshard/format/entryways';
import { PropsSchema } from '@wildshard/format/props';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { planPortalRide } from '../src/server/game/shardfile/declaredPortalRide';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { HeadlessSimulation } from '../src/server/host/headless';

// ONE-FORMAT OF41b (Q-S9, J367 (4)): the `portal` primitive from a plain upload. A shard with no native host declares a
// `portalLink` entryway, its floors as plain box colliders, the ride's director and the `client/plan` `portal.ride` rows;
// the server rides a player who walks into the road ring to the destination and files the landing fact.
const ride = { director: 'fixture.portal-ride', trigger: { front: 0.6, back: 0.6, half: 1, feet: 0.15, reach: 1.25 },
  fade: { out: 0.28, hold: 0.12, in: 0.4 }, veil: { cls: 'fixture-veil', style: {} },
  landings: [{ node: 'plaza.arrival', fact: 'portal-fixture.plaza' }] };
const stages = { version: 2, id: ride.director,
  inputs: { touch: 'zone:fixture.portal', dark: 'event:fixture.portal-dark', clear: 'event:fixture.portal-clear' },
  stages: [{ id: 'idle', do: [{ emit: 'portal.clear' }], next: [{ target: 'held', when: 'touch' }] },
    { id: 'held', do: [{ emit: 'portal.hold' }], next: [{ target: 'transferred', when: 'dark' }] },
    { id: 'transferred', do: [{ emit: 'portal.transfer' }], next: [{ target: 'idle', when: 'clear' }] }] };
const portal = { road: { id: 'road', at: [0, 0, 240], floor: 'deck' }, destination: { id: 'plaza.arrival', at: [50, 10, 50], floor: 'plaza' },
  exit: { id: 'plaza.exit', at: [50, 10, 56], floor: 'plaza' },
  links: [{ from: 'road', to: 'plaza.arrival' }, { from: 'plaza.exit', to: 'road' }], route: [[50, 10, 50], [50, 10, 56]] };
const box = (x: number, top: number, z: number, hx: number, hz: number) => ({ kind: 'box', x, y: top - 0.25, z, hx, hy: 0.25, hz });
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

function portalShard(linked: boolean): Shardfile {
  const base = emptyShardfile({ slug: 'portal-fixture', name: 'Portal fixture', author: 'Test', revision: 1, seed: 7 });
  const entryways = v.parse(EntrywaysSchema, base.entryways.map(row => row.edge === 'north' && linked ? { ...row, kind: 'portalLink', portal } : row));
  const props = v.parse(PropsSchema, { version: 1, family: 'toon', tiles: [], panels: [], models: [], far: null, textures: [],
    colliders: [{ id: 'deck', panel: null, initialActive: true, shapes: [box(0, 0, 235, 10, 15)] },
      { id: 'plaza', panel: null, initialActive: true, shapes: [box(50, 10, 52, 10, 10)] }] });
  return { ...base, entryways, props, directors: v.parse(DirectorsSchema, [stages]) };
}

test('OF41b: a plain upload\'s portal ride carries a player from the road ring to its destination and files the landing', () => {
  const shard = portalShard(true), facts: string[] = [];
  const portalRide = planPortalRide([{ kind: 'strings.register' }, { kind: 'portal.ride', rows: ride }]);
  // The ride's director is the ride's own: the declared director lane would refuse its zone and event inputs.
  expect(() => { createShardfileSim(shard, new Map(), { rapier }).dispose(); }).toThrow('native observation owner');
  const sim = createShardfileSim(shard, new Map(), { rapier, portalRide, quest: { fact: name => { facts.push(name); } } });
  try {
    expect(installedKeys(sim.host).has('portalRide')).toBe(true);
    const player = [...sim.host.players.values()][0];
    if (player === undefined) throw new Error('Missing player');
    player.resetPose({ x: 0, y: 0, z: 240 }, Math.PI);
    for (let tick = 0; tick < 120; tick++) sim.host.step();
    expect(Math.hypot(player.position.x - 50, player.position.z - 50)).toBeLessThan(1);
    expect(player.position.y).toBeCloseTo(10, 0);
    expect(facts).toEqual(['portal-fixture.plaza']);
  } finally { sim.dispose(); }
});

test('OF41b: a shard with no portal link installs no ride', () => {
  const shard = { ...portalShard(false), directors: [] }, sim = createShardfileSim(shard, new Map(), { rapier, portalRide: ride });
  try { expect(installedKeys(sim.host).has('portalRide')).toBe(false); } finally { sim.dispose(); }
});

test('the author simulation runs the ordinary portal declared in the plan', async () => {
  const sections = new Map([['server/plan', { version: 1, features: [{ kind: 'portal.ride', rows: ride }] }]]); // HS6: the server reads server/plan only
  const shard = { ...portalShard(true), spawn: { x: 0, y: 0, z: 240, yaw: Math.PI } };
  const sim = await HeadlessSimulation.create(shard, new Map(), undefined, { sections, deadline: 'advisory' });
  const facts: string[] = [];
  try {
    for (let tick = 0; tick < 120; tick++) {
      for (const effect of (await sim.step()).effects) if (effect.kind === 'fact') facts.push(effect.name);
    }
    expect(facts).toEqual(['portal-fixture.plaza']);
  } finally { await sim.dispose(); }
}, 30_000);
