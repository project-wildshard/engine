// SHARD-COMPAT CP16: a kept original admits as stored. Every kept original (staging and prod, read from the API's
// `/api/shardfiles` on 2026-11-24) that ships `server/native-assembly.json` is held here by its plan file as stored: it
// parses, its population rows pass the engine's population step, and it names no retired host. Pine r5 (prod's head),
// r6 and r10 name the population family themselves and run it as written. Driftwood r4 and r5 name the island population
// hosts OF22c3 retired in v0.1.59 (no engine since runs them); they stay named here until a step declares their creatures.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the kept originals' plan files.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseNativeAssembly } from '@wildshard/format/nativeAssembly';
import { withSectionPopulation } from '../src/server/game/shardfile/nativeAssembly';
import { RETIRED_HOSTS } from '../src/server/game/shardfile/nativeAssemblyHosts';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';

interface Kept { readonly hash: string; readonly revisions: readonly string[]; readonly plan: unknown }
const kept = (JSON.parse(readFileSync('test/fixtures/kept-native-plans.json', 'utf8')) as { originals: readonly Kept[] }).originals;
/** A product with none of the declared population files: the step then adds nothing, so only the plan's own rows remain. */
const bare = { hasFile: () => false, has: () => false } as unknown as ShardFolder;
const KNOWN_REFUSED = ['driftwood-isle r4', 'driftwood-isle r5'];

test('every kept original with a native plan admits as stored, but the two OF22c3 retired (CP16)', async () => {
  expect(kept).toHaveLength(20);
  const refused: string[] = [];
  for (const original of kept) {
    const plan = parseNativeAssembly(original.plan);
    const features = await withSectionPopulation(bare, plan.features);
    if (features.some(row => RETIRED_HOSTS.has(row.host))) refused.push(...original.revisions);
  }
  expect(refused).toEqual(KNOWN_REFUSED);
});

test('Pine r5, r6 and r10 keep their population rows as written (CP16)', async () => {
  for (const name of ['pine-hollow r5', 'pine-hollow r6', 'pine-hollow r10']) {
    const original = kept.find(row => row.revisions.includes(name));
    if (original === undefined) throw new Error(`fixture lacks ${name}`);
    const plan = parseNativeAssembly(original.plan);
    expect(plan.features.filter(row => row.host.startsWith('population.')).map(row => row.host), name).toEqual(
      ['population.environment', 'population.shelter', 'population.roster', 'population.elites', 'population.spawn-script', 'population.elites-ready']);
    expect(await withSectionPopulation(bare, plan.features), name).toEqual(plan.features);
  }
});
