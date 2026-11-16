import { expect, test } from 'vitest';
import * as v from 'valibot';
import { NATIVE_ASSEMBLY_FILE, parseNativeAssembly } from '@wildshard/format/nativeAssembly';
import { parseEliteFeature } from '@wildshard/format/eliteFeature';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { readAssemblyInput } from '../src/server/game/shardfile/nativeAssemblyInput';
import { encounterRows } from '../src/shared/engine/sim/encounterRows';
import type { ShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { admittedResidents, step } from './fixtures/engine-lift/residents';

const slugs = ['pine-hollow', 'nalati-grasslands'] as const;
const { input, open } = admittedResidents(slugs);
const definitions = v.object({ rows: v.array(v.object({ def: v.object({ id: v.string() }) })) });
function productOf(slug: typeof slugs[number]): ShardProduct {
  const product = input(slug).product;
  if (product === undefined) throw new Error('Missing admitted roster product');
  return product;
}
const external = v.array(v.object({ def: v.object({ id: v.string() }) }));

/** The product names the encounters; the public room wire must have an owner for each. */
async function namedElites(product: ShardProduct): Promise<string[]> {
  const plan = parseNativeAssembly(await product.json(NATIVE_ASSEMBLY_FILE)), ids = new Set<string>();
  for (const feature of plan.features) {
    if (feature.host === 'population.elites') {
      for (const fight of parseEliteFeature(await product.json(feature.file)).fights) ids.add(fight.def.id);
    } else if (feature.host === 'riding.elites') {
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
  const expected = await namedElites(productOf(slug));
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

test('removing the Pine elite host leaves its declared lairs unowned on the real room wire', async () => {
  const preparation = input('pine-hollow'), product = productOf('pine-hollow');
  const expected = await namedElites(product), plan = parseNativeAssembly(await product.json(NATIVE_ASSEMBLY_FILE));
  const broken = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(row => row.host !== 'population.elites' && row.host !== 'population.elites-ready') }));
  // In-memory fault on admitted plan bytes only; no shard pin/source file changes.
  const damaged: ShardProduct = { ...product, file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(broken) : product.file(name) };
  const live = await createTrustedHeadlessResident({ ...preparation, product: damaged }, undefined, { room: true });
  try {
    step(live);
    const published = encounterRows(live.host);
    expect(expected.filter(id => !published.has(`encounter:${id}`))).toEqual(expected);
  } finally { live.dispose(); }
}, 10_000);
