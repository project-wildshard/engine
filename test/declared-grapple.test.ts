import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { ModesSchema } from '@wildshard/format/modes';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import source from './fixtures/engine-lift/grapple.json' with { type: 'json' };

// ONE-FORMAT OF41c, engine half: a plain `state/modes` grapple row that carries its tool profile and hooks installs the
// same `installGrapple` the native `grapple` host does, from the row alone, with no native assembly or files.
const tool = {
  course: { name: 'Quarry', clearance: { axis: 'x', plane: 0, min: -4, max: 4, base: 0, top: 2, ceiling: 8, owners: ['quarry.rail'] } },
  cues: source.cues, looks: source.looks,
  fact: { name: 'quarry.crossed', entity: 'quarry.pit', source: 'quarry.crossing' },
  headless: { step: 'quarry.claw', lock: 'quarry.lock', aim: 'quarry.pitch', eye: 1.68, aspect: 1, portraitFov: 70 },
};
const timings = { minRange: 2.5, maxRange: 38, zipSpeed: 14, fireTime: 0.27, biteTime: 0.1, reelTime: 0.48, windowX: 0.52, windowY: 0.68 };
const HOOK = { x: -4, y: 2, z: 0 };

function quarryShard(grapple: readonly object[]): Shardfile {
  const base = emptyShardfile({ slug: 'grapple-fixture', name: 'Grapple fixture', author: 'Test', revision: 1, seed: 7 });
  // the rows as an upload's `state/modes` section admits them
  return { ...base, spawn: { x: 4, y: 0.12, z: 0, yaw: Math.PI / 2 }, modes: parse(ModesSchema, { grapple }) };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('OF41c: a plain grapple mode locks, fires and crosses to its hook, and files its fact', () => {
  const facts: string[] = [];
  const sim = createShardfileSim(quarryShard([{ id: 'quarry.claw', ...timings, profile: tool, hooks: [HOOK] }]), new Map(),
    { rapier, quest: { fact: name => { facts.push(name); }, coins: () => undefined } });
  try {
    const { grapple, host } = sim;
    if (grapple === null) throw new Error('A plain grapple mode installs no grapple');
    expect(installedKeys(host).has('grapple')).toBe(true);
    const player = host.players.values().next().value;
    if (player === undefined) throw new Error('Missing player');
    host.step(); grapple.press(player.id, { lock: true }); host.step();
    expect(grapple.sim.target?.hook).toMatchObject(HOOK);
    grapple.press(player.id, { fire: true }); host.step();
    expect(grapple.sim.phase).not.toBe('idle');
    for (let frame = 0; frame < 240 && grapple.sim.phase !== 'idle'; frame++) host.step();
    expect(grapple.sim.phase).toBe('idle');
    expect(player.position.x).toBeLessThan(0); // it crossed to the hook's side
    expect(facts).toEqual(['quarry.crossed']);
  } finally { sim.dispose(); }
});

test('OF41c: the tick port carries a LOCK and a JUMP press into the declared grapple', () => {
  const lock: { on: boolean } = { on: false }, jump: { on: boolean } = { on: false };
  const commands = () => [...(lock.on ? [{ kind: 'script', actorId: 'quarry.lock', value: 0 }] : []), { kind: 'player', jump: jump.on }];
  const sim = createShardfileSim(quarryShard([{ id: 'quarry.claw', ...timings, profile: tool, hooks: [HOOK] }]), new Map(),
    { rapier, grapple: { commands, emit: () => undefined } });
  try {
    const { grapple, host } = sim;
    if (grapple === null) throw new Error('A plain grapple mode installs no grapple');
    host.step(); lock.on = true; host.step(); lock.on = false;
    expect(grapple.sim.target?.hook).toMatchObject(HOOK);
    jump.on = true; host.step(); jump.on = false;
    expect(grapple.sim.phase).not.toBe('idle');
  } finally { sim.dispose(); }
});

test('OF41c: a timing-only grapple mode installs nothing, and a second tool is refused', () => {
  const plain = createShardfileSim(quarryShard([{ id: 'hook', ...timings }]), new Map(), { rapier });
  try {
    expect(plain.grapple).toBeNull();
    expect(installedKeys(plain.host).has('grapple')).toBe(false);
  } finally { plain.dispose(); }
  expect(() => createShardfileSim(quarryShard([{ id: 'a', ...timings, profile: tool, hooks: [HOOK] }, { id: 'b', ...timings, profile: tool, hooks: [HOOK] }]),
    new Map(), { rapier })).toThrow('one grapple tool');
});
