import { expect, test } from 'vitest';
import { featuredZoneEntry, portalExitPlan, resumeZoneEntry, retrySmokeEntries, retryZoneEntry, roadApproach, smokeBatches, smokeGap, stagedTourProof, zoneEntryCorridor, zoneEntryTour } from '../scripts/zone-entry-tour.mjs';
import { zoneEntryGap } from '../scripts/page-release/flow.mjs';
import curated from '../src/server/game/zoneSelect/featured.json';

const cells = [
  {instance:'driftwood-isle', cell:[0, 0]},
  {instance:'far-reach', cell:[0, -1]},
  {instance:'west', cell:[-1, 0]},
  {instance:'south-west', cell:[-1, -1]},
] as const;

const featuredCells = curated.map((slug, index) => ({instance:`cell-${index}`, slug,
  cell: [index % 4, Math.floor(index / 4)] as const}));

test('the smoke seeds two real entries per featured shard and assigns 5/5/6', () => {
  const route = featuredZoneEntry(featuredCells, 476);
  expect(route).toHaveLength(16);
  expect(featuredZoneEntry([...featuredCells].reverse(), 476)).toEqual(route);
  expect(featuredZoneEntry(featuredCells, 477)).not.toEqual(route);
  expect(smokeBatches(route.map((_, index) => index)).map(batch => batch.length)).toEqual([5,5,6]);
  for (const cell of featuredCells) expect(route.filter(leg => leg.to.instance === cell.instance)).toHaveLength(2);
  for (const {from,to} of route) expect(Math.abs(from.cell[0]-to.cell[0])+Math.abs(from.cell[1]-to.cell[1])).toBe(1);
  expect(() => featuredZoneEntry(featuredCells.slice(1), 476)).toThrow(/missing featured/u);
});

test('a retry carries passed pairs forward and only redoes failed indexed pairs for the same build', () => {
  const route = featuredZoneEntry(featuredCells, 476), build = 'a'.repeat(40);
  const pairs = route.map(({from,to}, index) => ({index,from:from.instance,to:to.instance}));
  const all = pairs.map(pair => ({...pair,ms:700})), failed = new Set([1, 7, 14]);
  const arrivals = all.filter(pair => !failed.has(pair.index));
  const failures = pairs.filter(pair => failed.has(pair.index)).map(pair => ({...pair,reason:'timed out'}));
  const report = {engine:'webkit',profile:'phone',mode:'smoke',seed:476,build,cells:featuredCells,expected:16,
    arrivals, failures, failure:failures[0], pass:false};
  expect(stagedTourProof({deploy:{zoneEntry:report}})).toBe(report);
  expect(stagedTourProof(report)).toBe(report);
  expect(retrySmokeEntries(route, report, build, 476)).toEqual({arrivals,pending:[1,7,14]});
  expect(() => retrySmokeEntries(route, report, 'b'.repeat(40), 476)).toThrow(/same staging build/u);
  expect(() => retrySmokeEntries(route, report, build, 477)).toThrow(/seed/u);
  expect(() => retrySmokeEntries(route, {...report,arrivals:[...arrivals, ...arrivals.slice(0, 1)]}, build, 476)).toThrow(/pair/u);
  const {failure: _failure, ...held} = report;
  const complete = {...held,pass:true,arrivals:all,failures:[]};
  expect(zoneEntryGap(complete, build)).toBeUndefined();
  expect(zoneEntryGap(complete, 'b'.repeat(40))).toMatch(/for this build/u);
  expect(smokeGap({...report,pass:true})).toMatch(/16 seeded crossings/u);
  expect(smokeGap({...report,pass:true,arrivals:all.map((pair, index) => index===0 ? {...pair,to:pair.from} : pair),failures:[]})).toMatch(/16 seeded crossings/u);
});

test('opens with Driftwood into Sky Reach and walks both directions of every live edge in one circuit', (): void => {
  const route = zoneEntryTour(cells);
  expect(route[0]).toEqual({from:cells[0], to:cells[1]});
  expect(route).toHaveLength(8);
  const directions = new Set(route.map(({from, to}): string => `${from.instance}/${to.instance}`));
  expect(directions.size).toBe(8);
  for (const [index, {from, to}] of route.entries()) {
    expect(from).toBe(index === 0 ? cells[0] : route[index-1]?.to);
    expect(Math.abs(from.cell[0]-to.cell[0])+Math.abs(from.cell[1]-to.cell[1])).toBe(1);
    expect(directions.has(`${to.instance}/${from.instance}`)).toBe(true);
  }
  expect(route.at(-1)?.to).toBe(cells[0]);
});

test('refuses a partial tour when a live cell is disconnected', (): void => {
  expect((): void => { zoneEntryTour([...cells, {instance:'stranded', cell:[3, 3]}]); }).toThrow(/outside the walking tour/u);
});

test('resumes only the next crossing after an exact live route prefix', (): void => {
  const build = 'a'.repeat(40), route = zoneEntryTour(cells);
  const prefix = {
    build, engine:'webkit', profile:'phone', pass:false, expected:route.length,
    arrivals:[{from:'driftwood-isle',to:'far-reach',ms:25}],
    failure:{from:'far-reach',to:'south-west',reason:'entry timed out'},
  };
  expect(resumeZoneEntry(route, prefix, build, 2)).toEqual(prefix.arrivals);
  expect(() => resumeZoneEntry(route, prefix, build, 3)).toThrow(/next crossing/u);
  expect(() => resumeZoneEntry(route, {...prefix, build:'b'.repeat(40)}, build, 2)).toThrow(/same staging build/u);
  expect(() => resumeZoneEntry(route, {...prefix, arrivals:[{...prefix.arrivals[0], to:'west'}]}, build, 2)).toThrow(/live route/u);
  expect(() => resumeZoneEntry(route, {...prefix, failure:{from:'far-reach',to:'west',reason:'hold'}}, build, 2)).toThrow(/live route/u);
});

test('retries the same crossing once and reports the second failure', async () => {
  const calls: number[] = [];
  const result = await retryZoneEntry(async attempt => {
    calls.push(attempt);
    return `failed ${String(attempt)}`;
  });
  expect(calls).toEqual([1,2]);
  expect(result).toBe('failed 2');
  calls.length = 0;
  expect(await retryZoneEntry(async attempt => { calls.push(attempt); return undefined; })).toBeUndefined();
  expect(calls).toEqual([1]);
  calls.length = 0;
  expect(await retryZoneEntry(async attempt => { calls.push(attempt); return attempt === 1 ? 'busy' : undefined; })).toBeUndefined();
  expect(calls).toEqual([1,2]);
});

test('returns to a held source over the shortest directed route already qualified', (): void => {
  const route = zoneEntryTour(cells);
  const saved = route.slice(0, 6);
  expect(zoneEntryCorridor(saved,'driftwood-isle','south-west')).toEqual(route.slice(0,2));
  expect(zoneEntryCorridor(saved,'driftwood-isle','driftwood-isle')).toEqual([]);
  expect(() => zoneEntryCorridor(route.slice(0,1),'far-reach','driftwood-isle')).toThrow(/No completed route/u);
});

test('rides the long public road from Nine’s west gate and walks both turn-ins', (): void => {
  const farReach = {instance:'far-reach', cell:[0, -1]} as const;
  const nine = {instance:'nine-dragon-stack', cell:[1, -1]} as const;
  const plot = {instance:'open-plot-4-1', cell:[2, -1]} as const;
  const pitch = 562.5, center = {x: pitch, z: -pitch};
  const plan = roadApproach(farReach, {from:nine, to:plot}, center, pitch);
  expect(plan).toEqual([
    {x:281.25, z:-562.5, ride:false},
    {x:281.25, z:-843.75, ride:true},
    {x:562.5, z:-843.75, ride:true},
    {x:843.75, z:-843.75, ride:true},
    {x:843.75, z:-562.5, ride:true},
  ]);
  expect(roadApproach(farReach, {from:nine, to:farReach}, center, pitch)).toEqual(plan.slice(0, 1));
});

test('uses the declared walk out of a portal arrival and rejoins the road from the actual deck', (): void => {
  const center = {x:562.5, z:-562.5};
  const route = [[0.95, 125, 7.5], [5.5, 125, 2], [6, 125, -14], [12, 125, -20]] as const;
  const roads = [[-236, 0, 0], [0, 0, 236]] as const;
  const plan = portalExitPlan(roads.map(at => ({road:{at}, route})), center, {x:-1,z:0});
  expect(plan).toEqual({
    walk: [{x:563.45,z:-555}, {x:568,z:-560.5}, {x:568.5,z:-576.5}, {x:574.5,z:-582.5}],
    decks: [{x:326.5,z:-562.5,dx:-1,dz:0}, {x:562.5,z:-326.5,dx:0,dz:1}],
  });
  expect(portalExitPlan([], center, {x:-1,z:0})).toBeNull();
});
