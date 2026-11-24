import { expect, test, vi } from 'vitest';
import { approachBudget, featuredZoneEntry, rejoinLegs, spawnApproach, portalExitPlan, unstick, resumeZoneEntry, retrySmokeEntries, retryZoneEntry, roadApproach, smokeBatches, smokeGap, stagedTourProof, walkZoneEntryTour, zoneEntryCorridor, zoneEntryTour, type Tour } from '../scripts/zone-entry-tour.mjs';
import { zoneEntryGap } from '../scripts/page-release/flow.mjs';
import { TOUR_FEATURED as curated } from '../scripts/zone-entry-featured.mjs';

const cells = [
  {instance:'driftwood-isle', cell:[0, 0]},
  {instance:'far-reach', cell:[0, -1]},
  {instance:'west', cell:[-1, 0]},
  {instance:'south-west', cell:[-1, -1]},
] as const;

const featuredCells = [
  ...curated.filter(slug => slug !== 'driftwood-isle' && slug !== 'far-reach')
    .map((slug, index) => ({instance:slug === 'brasscap-mesa' ? 'blender-template' : slug, slug,
      cell:[index % 3 + 1, -Math.floor(index / 3)] as const})),
  {instance:'driftwood-isle', slug:'driftwood-isle', cell:[0,0] as const},
  {instance:'far-reach', slug:'far-reach', cell:[0,-1] as const},
];

test('the smoke seeds two real entries per featured shard and assigns 5/5/6', () => {
  const route = featuredZoneEntry(featuredCells, 476);
  expect(route).toHaveLength(16);
  expect(featuredZoneEntry([...featuredCells].reverse(), 476)).toEqual(route);
  expect(featuredZoneEntry(featuredCells, 477)).not.toEqual(route);
  const crossings = route.map((_, index) => index);
  expect(smokeBatches(crossings).map(batch => batch.length)).toEqual([5,5,6]);
  const hosted = smokeBatches(crossings, 2);
  expect(hosted.map(batch => batch.length)).toEqual([8,8]);
  expect(hosted.flat().sort((a,b) => a-b)).toEqual(crossings);
  expect(smokeBatches([1,7,14], 2)).toEqual([[1,14],[7]]);
  for (const cell of featuredCells) expect(route.filter(leg => leg.to.instance === cell.instance)).toHaveLength(2);
  const full = zoneEntryTour(featuredCells);
  for (const leg of route) expect(full).toContainEqual(leg);
  expect(route.filter(({to}) => to.instance === 'blender-template').map(({to}) => to.slug)).toEqual(['brasscap-mesa','brasscap-mesa']);
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
  expect(() => retrySmokeEntries(route, {...report,scope:'loopback'}, build, 476)).toThrow(/same staging build/u);
  expect(retrySmokeEntries(route, {...report,scope:'loopback'}, build, 476, 'loopback').pending).toEqual([1,7,14]);
  expect(() => retrySmokeEntries(route, {...report,arrivals:[...arrivals, ...arrivals.slice(0, 1)]}, build, 476)).toThrow(/pair/u);
  const {failure: _failure, ...held} = report;
  // QA 11-23-b row 20: the first crossing into each zone but Driftwood also goes to the main menu and back, then crosses back
  const rejoin = new Set(rejoinLegs(route));
  expect(rejoin.size).toBe(7);
  expect([...rejoin].map(index => route[index]?.to.instance)).not.toContain('driftwood-isle');
  expect(new Set([...rejoin].map(index => route[index]?.to.instance)).size).toBe(7);
  const crossedOnly = {...held,pass:true,arrivals:all,failures:[]};
  expect(zoneEntryGap(crossedOnly, build)).toMatch(/no menu-and-back for /u);
  const complete = {...crossedOnly,arrivals:all.map(row => rejoin.has(row.index) ? {...row,rejoinMs:9000,returnMs:30_000} : row)};
  const loopback = {...complete,scope:'loopback'};
  expect(zoneEntryGap(complete, build)).toBeUndefined();
  expect(zoneEntryGap(loopback, build)).toMatch(/16 seeded crossings/u);
  expect(zoneEntryGap(complete, 'b'.repeat(40))).toMatch(/for this build/u);
  expect(smokeGap({...report,pass:true})).toMatch(/16 seeded crossings/u);
  expect(smokeGap({...report,pass:true,arrivals:all.map((pair, index) => index===0 ? {...pair,to:pair.from} : pair),failures:[]})).toMatch(/16 seeded crossings/u);
});

test('a loopback batch resumes its own failed pairs and covers the full route across three jobs', () => {
  const build = 'a'.repeat(40), seed = 476;
  const route = featuredZoneEntry(featuredCells, seed);
  const batches = smokeBatches(route);
  expect(batches.map(batch => batch.length)).toEqual([5,5,6]);
  expect(batches.flat()).toEqual(route);
  const batch = batches[1];
  if (batch === undefined) throw new Error('Missing second batch');
  const pairs = batch.map(({from,to}, index) => ({index,from:from.instance,to:to.instance}));
  const arrivals = pairs.slice(1).map(pair => ({...pair,ms:700}));
  const report = {mode:'smoke',scope:'loopback',batch:1,build,seed,engine:'webkit',profile:'phone',
    cells:featuredCells,expected:batch.length,arrivals,failures:[{...pairs[0],reason:'timed out'}],pass:false};
  expect(retrySmokeEntries(batch, report, build, seed, 'loopback', 1)).toEqual({arrivals,pending:[0]});
  expect(() => retrySmokeEntries(batch, report, build, seed, 'loopback', 0)).toThrow(/batch/u);
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

test('a held crossing reports the active approach waypoint and last player position', async () => {
  const state = { cells: cells.slice(0, 2), pitch: 562.5, home: 'driftwood-isle', feet: {x:0,z:0} };
  const page = {
    evaluate: async (run: (arg: unknown) => unknown, arg: unknown) => run(arg),
    keyboard: {
      async down(key: string) { if (key === 'KeyW') throw new Error('Could not press move\nBrowser details'); },
      async up() {},
    },
  } as unknown as Parameters<typeof walkZoneEntryTour>[0];
  const verdict: Tour = {expected: 0, arrivals: [], pass: false};
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  vi.stubGlobal('window', {__wildshard:{shard:{grid:{state:() => state}},world:{player:{}}}});
  vi.stubGlobal('document', {querySelectorAll:() => []});
  try {
    await walkZoneEntryTour(page, {x:0,z:0}, verdict, () => {}, {restart: async () => page});
    expect(verdict.pass).toBe(false);
    expect(verdict.arrivals).toEqual([]);
    expect(verdict.failure).toEqual({
      from: 'driftwood-isle', to: 'far-reach',
      reason: 'Could not press move (walk waypoint (0.0, -235.0)) (home driftwood-isle, gate none, feet 0.0, 0.0)',
    });
  } finally {
    vi.stubGlobal('window', originalWindow);
    vi.stubGlobal('document', originalDocument);
  }
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

test("budgets a fresh guest's swim round Driftwood's harbour by its length, never under two minutes", (): void => {
  // opus-gate-p0 on staging 6bab8fcc: a guest from the pier swam to the east approach in 168 s at about 2.6 m/s
  const spawn = {x:-0.5, z:-194};
  const west = [{x:-235, z:-194, ride:false}, {x:-235, z:0, ride:false}, {x:-235, z:0, ride:false}];
  expect(approachBudget(spawn, west)).toBeGreaterThanOrEqual(200_000);
  expect(approachBudget(spawn, west)).toBeLessThanOrEqual(240_000);
  expect(approachBudget({x:0, z:-194}, [{x:0, z:-235, ride:false}])).toBe(120_000);
});

test('steps round a pillar on the straight line: a hop, then side-steps that alternate and grow', (): void => {
  // open-plot-2-0's centre pillar held the walker at z -1122.8 through two minutes of hops (opus-gate-p0, staging 6bab8fcc)
  expect(unstick(0)).toEqual({key:'Space', ms:0});
  const steps = [1, 2, 3, 4].map(unstick);
  expect(steps.map(step => step.key)).toEqual(['KeyD', 'KeyA', 'KeyD', 'KeyA']);
  let offset = 0;
  const reach = steps.map(step => { offset += (step.key === 'KeyD' ? 1 : -1)*step.ms; return Math.abs(offset); });
  expect(reach[2]).toBeGreaterThan(reach[0] ?? 0);
  expect(Math.max(...steps.map(step => step.ms))).toBeLessThanOrEqual(4000);
});

test("a fresh guest reaches the gate's centre line first, then walks along it to the approach", (): void => {
  // mirror-salt's straight line from its spawn to the west approach climbs onto a ledge and meets a rock wall at
  // (1455, 1717); the centre line is clear (opus-gate-p0, staging 6bab8fcc)
  const center = {x:1687.5, z:1687.5};
  expect(spawnApproach('mirror-salt', {x:1673, z:1837.5}, center, -1, 0)).toEqual([
    {x:1562.5, z:1687.5, ride:false}, {x:1452.5, z:1687.5, ride:false}]);
  // it joins the line on the gate's half, clear of the centre (open-plot-4-2's centre piece held the walker at (1134.9, 8.7))
  expect(spawnApproach('open-plot-4-2', {x:1124, z:-45}, {x:1125, z:0}, -1, 0)).toEqual([
    {x:1000, z:0, ride:false}, {x:890, z:0, ride:false}]);
  expect(spawnApproach('pastel-plain', {x:-562.5+200, z:30}, {x:-562.5, z:0}, 0, 1)).toEqual([
    {x:-562.5, z:125, ride:false}, {x:-562.5, z:235, ride:false}]);
  // already on the line: straight along it
  expect(spawnApproach('open-plot-2-0', {x:-1, z:-1170}, {x:0, z:-1125}, 0, 1)).toEqual([{x:0, z:-890, ride:false}]);
  // Driftwood keeps the shore route round its harbour
  expect(spawnApproach('driftwood-isle', {x:-0.5, z:-194}, {x:0, z:0}, -1, 0)).toEqual([
    {x:-235, z:-194, ride:false}, {x:-235, z:0, ride:false}]);
});

test("a fresh Fossil Badlands guest goes round the centre block to the north gate", (): void => {
  // v0.1.60's smoke (seed 3519934230, crossing 9) held at the block's south face on the straight line from the spawn
  const center = {x:-562.5, z:-1125}, spawn = {x:-562.5, z:-1170};
  expect(spawnApproach('open-plot-fossil-badlands', spawn, center, 0, 1)).toEqual([
    {x:-562.5, z:-1185, ride:false},
    {x:-500, z:-1185, ride:false},
    {x:-500, z:-1000, ride:false},
    {x:-562.5, z:-1000, ride:false},
    {x:-562.5, z:-890, ride:false}]);
  // its other gates keep the shared rule
  expect(spawnApproach('open-plot-fossil-badlands', spawn, center, 1, 0)).toEqual([
    {x:-437.5, z:-1125, ride:false}, {x:-327.5, z:-1125, ride:false}]);
});

test("a fresh Mossgate guest goes north round the wall west of the spawn to the west gate", (): void => {
  // v0.1.76's smokes (seeds 2943271062, 1436109927) held at (553.3, 567.9) on the straight line west of the spawn
  const center = {x:562.5, z:562.5}, spawn = {x:562.8, z:564.3};
  expect(spawnApproach('mossgate', spawn, center, -1, 0)).toEqual([
    {x:562.5, z:602.5, ride:false},
    {x:437.5, z:602.5, ride:false},
    {x:437.5, z:562.5, ride:false},
    {x:327.5, z:562.5, ride:false}]);
  // its other gates keep the shared rule
  expect(spawnApproach('mossgate', spawn, center, 1, 0)).toEqual([{x:797.5, z:562.5, ride:false}]);
});

test("a fresh Brasscap guest leaves town around the canyon wall before taking the east gate", (): void => {
  const center = {x:-562.5, z:-562.5}, depot = {x:-564.1, z:-559.9};
  expect(spawnApproach('brasscap-mesa', depot, center, 1, 0)).toEqual([
    {x:-558.5, z:-559.9, ride:false},
    {x:-558.5, z:-517.5, ride:false},
    {x:-487.5, z:-517.5, ride:false},
    {x:-437.5, z:-562.5, ride:false},
    {x:-327.5, z:-562.5, ride:false}]);
});
