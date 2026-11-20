// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The pins name the products this test reads.
import { readFileSync } from 'node:fs';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { expect, test } from 'vitest';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { DATA_CELL_OWN_PLAN, dataCellPlanRows } from '../src/client/game/grid/dataCellPlan';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// meta ONE-FORMAT OF22e2 (opus-drift6): the one-shard page installs every `client/plan` feature a shard declares
// (`ShardfileClient` through `installClientPhase`), and so does a grid runtime cell (`runtimePage.ts`). A grid DATA cell
// (no `runtime`, no declared client page: `liveSession.ts` admission) installed none of them but its audio scene, so on the
// grid Nine's city stood half built (a50bbaf00 named seven gaps). `grid/dataCellPlan.ts` now enters the rest of the plan
// while the feet stand in the cell. This reads each pinned product the grid enters as a data cell and fails for a plan
// feature the data cell neither covers its own way nor enters, so a plain upload's new plan feature cannot skip the grid.

const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards.map(row => row.slug);

test('a pinned grid data cell enters every client plan feature it does not cover its own way', async () => {
  const skipped: string[] = [], entered = new Map<string, string[]>();
  for (const slug of pins) {
    const product = await loadHeadlessFolder(builtFolder(slug)), source = product.shardfile;
    if (source.runtime !== null || hasDeclaredClientPage(source) || !product.has('client/plan')) continue;
    const rows = dataCellPlanRows(product);
    for (const row of product.section('client/plan').features) {
      if (DATA_CELL_OWN_PLAN.has(row.kind)) continue;
      if (!rows.includes(row) || !Object.hasOwn(CLIENT_FEATURES, row.kind)) skipped.push(`${slug}: ${row.kind}`);
      else entered.set(slug, [...entered.get(slug) ?? [], row.kind]);
    }
  }
  expect(skipped, 'a grid data cell skips these plan features').toEqual([]);
  // Nine is the pinned data cell with a plan: its city, place sets, movers' views, portal veil and the rest now enter on the grid
  expect(entered.get('nine-dragon-stack')).toEqual(expect.arrayContaining(['world.assembly', 'world.sets', 'view.program', 'portal.ride',
    'practice.course', 'strings.register', 'world.runtime-hooks']));
}, 120_000);
