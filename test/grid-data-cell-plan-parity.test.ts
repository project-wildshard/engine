// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The pins name the products this test reads.
import { readFileSync } from 'node:fs';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { Group, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import * as dataCellPlan from '../src/client/game/grid/dataCellPlan';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// meta ONE-FORMAT OF22e2 (opus-drift6): the one-shard page installs every `client/plan` feature a shard declares
// (`ShardfileClient` through `installClientPhase`), and so does a grid runtime cell (`runtimePage.ts`). A grid DATA cell
// (no `runtime`, no declared client page: `liveSession.ts` admission) installed none of them but its audio scene, so on the
// grid Nine's city stood half built (a50bbaf00 named seven gaps). `grid/dataCellPlan.ts` now enters the rest of the plan
// while the feet stand in the cell. This reads each pinned product the grid enters as a data cell and fails for a plan
// feature the data cell neither covers its own way nor enters, so a plain upload's new plan feature cannot skip the grid.
// OF22n (opus-nine-cell): most players reach Nine from the road, not as their home, and f983b4e79e entered the plan in the
// home cell only, so each data cell is read for both entries; before OF22n (no entry set) the home alone entered it.
const { DATA_CELL_OWN_PLAN, dataCellPlanRows } = dataCellPlan;
const ENTRIES: readonly dataCellPlan.DataCellEntry[] = ['home', 'road'];
const entered = (entry: dataCellPlan.DataCellEntry): boolean => ((dataCellPlan as Partial<typeof dataCellPlan>).DATA_CELL_PLAN_ENTRIES ?? new Set(['home'])).has(entry);

const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards.map(row => row.slug);

test('a pinned grid data cell enters every client plan feature it does not cover its own way', async () => {
  const skipped: string[] = [], enteredBy = new Map<string, string[]>();
  for (const slug of pins) {
    const product = await loadHeadlessFolder(builtFolder(slug)), source = product.shardfile;
    if (source.runtime !== null || hasDeclaredClientPage(source) || !product.has('client/plan')) continue;
    const rows = dataCellPlanRows(product);
    for (const entry of ENTRIES) for (const row of product.section('client/plan').features) {
      if (DATA_CELL_OWN_PLAN.has(row.kind)) continue;
      if (!entered(entry) || !rows.includes(row) || !Object.hasOwn(CLIENT_FEATURES, row.kind)) skipped.push(`${slug} (${entry}): ${row.kind}`);
      else enteredBy.set(`${slug} (${entry})`, [...enteredBy.get(`${slug} (${entry})`) ?? [], row.kind]);
    }
  }
  // Before OF22n this named Nine's seven road-entry gaps (`nine-dragon-stack (road): world.assembly` and the rest)
  expect(skipped, 'a grid data cell skips these plan features').toEqual([]);
  // Nine is the pinned data cell with a plan: its city, place sets, movers' views, portal veil and the rest enter on the grid,
  // as the home and from the road
  for (const entry of ENTRIES) expect(enteredBy.get(`nine-dragon-stack (${entry})`)).toEqual(expect.arrayContaining(['world.assembly', 'world.sets',
    'view.program', 'portal.ride', 'practice.course', 'strings.register', 'world.runtime-hooks']));
}, 120_000);

test('a data cell entered from the road draws its plan at its offset in the home frame', () => {
  const home = { instance: 'open-plot-3-0', origin: { x: 562.5, z: -1125 } }, nine = { instance: 'nine-dragon-stack', origin: { x: 562.5, z: -562.5 } };
  expect(dataCellPlan.dataCellPlanFrame(home, home)).toBeNull();
  const frame = dataCellPlan.dataCellPlanFrame(nine, home);
  expect(frame).toEqual({ name: 'nine-dragon-stack', x: 0, z: 562.5 });
  if (frame === null) return;
  const scene = new Group(), stay = new Scope('stay'), root = dataCellPlan.dataCellPlanRoot(scene, frame, stay);
  expect(root.parent).toBe(scene);
  expect(new Vector3().setFromMatrixPosition(root.matrixWorld)).toMatchObject({ x: 0, y: 0, z: 562.5 });
  stay.dispose();
  expect(root.parent).toBeNull();
});
