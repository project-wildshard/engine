import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseEliteFeature } from '@wildshard/format/eliteFeature';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { readAssemblyInput } from '../src/server/game/shardfile/nativeAssemblyInput';
import { standingHosts } from '../src/server/game/shardfile/nativeAssembly';
import { encounterRows } from '../src/shared/engine/sim/encounterRows';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { admittedResidents, step } from './fixtures/engine-lift/residents';

const slugs = ['pine-hollow', 'nalati-grasslands'] as const;
const { input, open } = admittedResidents(slugs);
const definitions = v.object({ rows: v.array(v.object({ def: v.object({ id: v.string() }) })) });
function folderOf(slug: typeof slugs[number]): ShardFolder {
  const product = input(slug).product;
  if (product === undefined) throw new Error('Missing admitted roster product');
  return product;
}
const external = v.array(v.object({ def: v.object({ id: v.string() }) }));
/** ONE-FORMAT OF29e1/e3: no plan names a `population.*` host any more; the engine stands `population.elites` from this
 *  declared file (engine `nativeAssembly.ts` POPULATION_FILES), so the test reads the same file. */
const ELITES_FILE = 'actors/elites.json';

/** The product names the encounters; the public room wire must have an owner for each. */
async function namedElites(product: ShardFolder): Promise<string[]> {
  const ids = new Set<string>();
  if (product.hasFile(ELITES_FILE)) for (const fight of parseEliteFeature(await product.json(ELITES_FILE)).fights) ids.add(fight.def.id);
  for (const feature of await standingHosts(product)) { // FP16b/c/f: a planless pin's hosts stand from its sections
    if (feature.host === 'riding.elites') {
      const rows = await readAssemblyInput<unknown>(product, feature.rows);
      for (const row of v.parse(definitions, rows).rows) ids.add(row.def.id);
    } else if (feature.host === 'encounter.patrol') {
      const rows = await readAssemblyInput<unknown>(product, feature.external);
      for (const row of v.parse(external, rows)) ids.add(row.def.id);
    }
  }
  return [...ids].sort();
}

for (const slug of slugs) test(`${slug}: every declared elite has a live server encounter owner`, async () => {
  const expected = await namedElites(folderOf(slug));
  expect(expected.length).toBeGreaterThan(0);
  const live = await open(slug);
  try {
    step(live);
    const published = encounterRows(live.host);
    for (const id of expected) {
      const read = published.get(`encounter:${id}`);
      expect(read, `missing server owner for ${slug}/${id}`).toBeDefined();
      expect(read?.().kind).toBe('elite');
    }
  } finally { live.dispose(); }
}, 10_000);

test('removing the Pine elite file leaves its declared lairs unowned on the real room wire', async () => {
  const preparation = input('pine-hollow'), product = folderOf('pine-hollow');
  const expected = await namedElites(product);
  expect(expected.length).toBeGreaterThan(0);
  // In-memory fault on the admitted product only (the engine stands population.elites from this file); no pin changes.
  const damaged: ShardFolder = { ...product, hasFile: name => name !== ELITES_FILE && product.hasFile(name) };
  const live = await createNativeHeadlessResident({ ...preparation, product: damaged }, undefined, { room: true });
  try {
    step(live);
    const published = encounterRows(live.host);
    expect(expected.filter(id => !published.has(`encounter:${id}`))).toEqual(expected);
  } finally { live.dispose(); }
}, 10_000);
