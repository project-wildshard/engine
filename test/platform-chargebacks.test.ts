import { expect, test } from 'vitest';
import pendingRows from '../lint/platform-pending-users.json' with { type: 'json' };
// oxlint-disable-next-line import/no-nodejs-modules -- Verify retired receipts without touching the shared WIP ledger.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chargePlatformUsers, inlinePlatformPaths, inlinePlatformSpans, platformChargeback, recordPrivateCharge } from '../scripts/platform-chargebacks.mjs';
import { pendingPlatformUsers, partitionPendingPlatformUsers } from '../scripts/shard-platform.mjs';
import type { PendingPlatformUser } from '../scripts/shard-platform.d.mts';
import { componentInventory } from '../scripts/shard-components.mjs';
import { g571HostApprovals,approvedG571Host } from '../scripts/g571-hosts.mjs';
import { onDisk } from '../scripts/format-package.mjs';

test('optional shared dispatch does not invent another arena or keeper user', () => {
  const arena = 'src/shared/game/boss/openArenaFight.ts', phase = 'src/server/game/plugin/bossPhase.ts';
  const groups = 'src/server/game/population/pageGroups.ts';
  const both = new Set(['nalati-grasslands', 'pine-hollow']);
  const modules = new Map([[arena, both], [phase, both], [groups, both]]);
  const bindings = new Map([[`${arena}\0OpenArenaFight`,both],[`${phase}\0bossFight`, both],
    [`${groups}\0PageGroups`, both], [`${groups}\0FixedPageSpawnTable`, both]]);
  chargePlatformUsers(modules, bindings);
  expect(modules.get(arena)).toEqual(both);
  expect(bindings.get(`${arena}\0OpenArenaFight`)).toEqual(both);
  expect(bindings.get(`${groups}\0PageGroups`)).toEqual(both);
  expect(bindings.get(`${phase}\0bossFight`)).toEqual(both);
  expect(bindings.get(`${groups}\0FixedPageSpawnTable`)).toEqual(both);
  expect(platformChargeback('src/client/game/looks/staticCapture.ts', 'StaticCapture')).toBeNull();
  expect(platformChargeback('src/client/game/systems/viewmodel/rigArms.ts', 'RigArms')).toBeNull();
});

test('a non-shard sole user maps to its reviewed owner or reports its excluded lines', () => {
  const arena = { path: 'src/client/game/boss/encounterView.ts',name:'SlotEncounterView', lines: 514 };
  const charges = new Map<string, { path: string; lines: number; name?: string }[]>([['nalati-grasslands', []]]);
  const reports: string[] = [], report = (line: string) => { reports.push(line); };
  expect(recordPrivateCharge(charges, 'fixture-only-user', arena, report)).toBe(true);
  expect(charges.get('nalati-grasslands')).toEqual([arena]);
  const outside = new Map<string, typeof arena[]>([['far-reach', []]]);
  expect(recordPrivateCharge(outside, 'fixture-only-user', arena, report)).toBe(false);
  expect(reports[0]).toContain('514 lines owned by nalati-grasslands, outside measured shards');
  expect(recordPrivateCharge(charges, 'fixture-only-user', { path: 'src/game/fixture.ts', name: 'unused', lines: 7 }, report)).toBe(false);
  expect(reports[1]).toContain('src/game/fixture.ts#unused: 7 lines owned by fixture-only-user');
  expect(charges.get('nalati-grasslands')).toEqual([arena]);
});

test('Nine pool spans charge actual source lines while instance packets remain shared', () => {
  const reports: string[] = [], selected: string[] = [];
  const charges = new Map<string, { path: string; name: string; lines: number }[]>([['nine-dragon-stack', []]]);
  for (const path of ['src/client/game/shardfile/worldScenes.ts', 'src/client/game/shardfile/scenePools.ts', 'src/format/worldScenes.ts']) {
    const source = readFileSync(onDisk('.', path), 'utf8'), lines = source.split('\n');
    for (const span of inlinePlatformSpans(path, source, line => { reports.push(line); })) {
      expect(platformChargeback(path, span.name)).toBe('C1');
      recordPrivateCharge(charges, 'fixture-only-user', { path, name: span.name, lines: span.lines.length });
      selected.push(...span.lines.map(line => lines[line] ?? ''));
    }
  }
  expect(reports).toEqual([]);
  expect(charges.get('nine-dragon-stack')?.reduce((sum, row) => sum + row.lines, 0)).toBe(14);
  expect(selected.join('\n')).not.toMatch(/instanceMatrix|instanceAttributes|packet/u);
});

test('reviewed Pine and Driftwood branches charge their actual owners', () => {
  const reports: string[] = [];
  const charges = new Map<string, {path: string; name: string; lines: number}[]>([['pine-hollow', []], ['driftwood-isle', []]]);
  for (const path of inlinePlatformPaths().filter(file => !file.endsWith('/worldScenes.ts') && file !== 'src/client/game/shardfile/scenePools.ts')) {
    const source = readFileSync(onDisk('.', path), 'utf8');
    for (const span of inlinePlatformSpans(path, source, line => { reports.push(line); })) {
      expect(span.lines.length).toBeGreaterThan(0);
      expect(platformChargeback(path, span.name)).not.toBeNull();
      expect(recordPrivateCharge(charges, 'fixture-only-user', {path, name: span.name, lines: span.lines.length})).toBe(true);
    }
  }
  expect(reports).toEqual([]);
  expect(platformChargeback('src/client/game/systems/looks/waterSurface.ts', 'WaterTransition')).toBeNull();
  expect(platformChargeback('src/format/water.ts', 'WaterTransition')).toBeNull();
  const explorer = 'src/client/game/models/explorerCatalogue.ts', users = new Set(['pine-hollow', 'driftwood-isle']);
  const metadataBindings = new Map([[`${explorer}\0Presentation`, users]]);
  chargePlatformUsers(new Map(), metadataBindings);
  expect(metadataBindings.get(`${explorer}\0Presentation`)).toEqual(users);
  expect(platformChargeback(explorer, 'Presentation')).toBeNull();
  const figure = 'src/client/game/models/figureCatalogue.ts', hull = 'src/client/game/looks/speciesBook.ts';
  const both = new Set(['pine-hollow', 'driftwood-isle']);
  const bindings = new Map(['admitted','ProductFigureCatalogue','ProductFigureImports','FigureCatalogue'].map(name=>[`${figure}\0${name}`,both]));
  chargePlatformUsers(new Map([[figure, both]]), bindings);
  for(const name of ['admitted','ProductFigureCatalogue','ProductFigureImports','FigureCatalogue']) {
    expect(bindings.get(`${figure}\0${name}`)).toEqual(both);
    expect(platformChargeback(figure,name)).toBeNull();
  }
  expect(inlinePlatformPaths()).not.toContain(figure);
  expect(platformChargeback(hull, 'HullLookBook')).toBeNull();
  expect(platformChargeback('src/client/engine/models/geometryPack.ts', 'GeometryPack')).toBeNull();
});

test('the product posed loader has a real second user', () => {
  const posed = 'src/client/game/looks/posedInstances.ts';
  const both = new Set(['pine-hollow', 'nalati-grasslands']);
  const bindings = new Map([
    [`${posed}\0PosedLibrary`, both], [`${posed}\0PosedDraw`, both], [`${posed}\0PosedInstances`, both],
  ]);
  const modules = new Map([[posed, both]]);
  chargePlatformUsers(modules, bindings);
  // G520 re-score (625514ff80): Driftwood's Explorer gull card is a product posed library row read by the same loader
  for (const [path, name] of [[posed, 'PosedLibrary'], [posed, 'ProductPosedLibrary'], [posed, 'PosedDraw'], [posed, 'PosedInstances']] as const) {
    if (bindings.has(`${path}\0${name}`)) expect(bindings.get(`${path}\0${name}`)).toEqual(both);
    expect(platformChargeback(path, name)).toBeNull();
  }
  expect(modules.get(posed)).toEqual(both);
  expect(inlinePlatformPaths()).not.toContain(posed);
  const driftwood = readFileSync('src/shards/driftwood-isle/generators/explorerCatalogue.ts', 'utf8');
  expect(driftwood).toMatch(/kind:'posed',file:'[^']+',source:'product'/u);
});


test('the real Pine and Driftwood Explorer dispatcher no longer has a sole-user receipt', () => {
  const users = new Set(['pine-hollow', 'driftwood-isle']);
  const paths = ['src/client/game/models/explorerCatalogue.ts', 'src/format/explorerCatalogue.ts'];
  const modules = new Map(paths.map(path => [path, users]));
  const bindings = new Map(paths.map(path => [`${path}\0ProductExplorerDispatch`, users]));
  chargePlatformUsers(modules, bindings);
  for (const path of paths) {
    expect(platformChargeback(path, 'ProductExplorerDispatch')).toBeNull();
    expect(inlinePlatformPaths()).not.toContain(path);
    expect(modules.get(path)).toEqual(users);
    expect(bindings.get(`${path}\0ProductExplorerDispatch`)).toEqual(users);
  }
  // Dispatch credit does not waive a private intake or presentation owner.
  expect(platformChargeback('src/engine/models/geometrySources.ts', 'registerPackedGeometrySource')).toBeNull();
  expect(platformChargeback('src/shared/game/boss/openArenaFight.ts','OpenArenaFight')).toBeNull();
});

test('day-one feature credit cannot erase a G520 chargeback', () => {
  const path = 'src/client/game/boss/encounterView.ts';
  const allowance: PendingPlatformUser = { module: path, documentation: 'docs/HOST-BAR.md',
    approvedFeature: { name: 'painterly look host', decision: { path: 'docs/plans/decisions.md', row: 'G478' } } };
  const painterly = { path, name: 'SlotEncounterView', exported: true, lines: 40 };
  const rows = [painterly,
    { path, name: 'ElitePageRows', exported: true, lines: 80 }];
  const result = partitionPendingPlatformUsers('nalati-grasslands', [], rows, [allowance]);
  expect(result.exports).toEqual([rows[0]]);
  expect(result.pending.map(row => row.name)).toEqual(['ElitePageRows']);
  const single = partitionPendingPlatformUsers('nalati-grasslands', [{ path, lines: 200 }], [painterly], [allowance]);
  expect(single.exports).toEqual([rows[0]]);
  expect(single.pending.map(row => row.lines)).toEqual([160]);
  const unapproved = partitionPendingPlatformUsers('nalati-grasslands', [{ path, lines: 200 }], [painterly], []);
  expect(unapproved.modules).toEqual([{ path, lines: 200 }]);
  expect(unapproved.exports).toEqual([]);
});

test('chargebacks retain their exact component after guest admission', () => {
  const sources = [
    { path: 'src/client/game/models/mountedSpecimen.ts', kind: 'sole-module', lines: 27 },
    { path: 'src/client/game/boss/encounterView.ts', name: 'SlotEncounterView', kind: 'sole-export', lines: 40 },
  ] as const;
  const inventory = componentInventory('.', 'nalati-grasslands', [...sources], 67);
  expect(inventory.counts.C2).toBe(0);
  expect(inventory.counts.C1).toBe(27); expect(inventory.counts.C7).toBe(0);
  expect(inventory.counts.C4).toBe(40);
  expect(inventory.unknown).toEqual([]);
});

test('whole-module cuts retire their old receipts while unknown missing modules still refuse', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync('tmp/retired-host-test-');
  try {
    mkdirSync(`${root}/lint`); mkdirSync(`${root}/docs/plans`, { recursive: true });
    writeFileSync(`${root}/docs/plans/decisions.md`, '| G475 | approved toon |');
    const receipt = (module: string): PendingPlatformUser => ({ module, documentation: 'docs/ENGINE.md',
      approvedFeature: { name: 'toon look host', decision: { path: 'docs/plans/decisions.md', row: 'G475' } } });
    const put = (modules: string[]) => writeFileSync(`${root}/lint/platform-pending-users.json`, JSON.stringify({
      schema: 'platform-pending-users/1', entries: modules.map(receipt),
    }));
    put(['src/engine/models/glbNodes.ts', 'src/game/shardfile/buildingAssembly.ts']);
    expect(pendingPlatformUsers(root)).toEqual([]);
    put(['src/game/missing.ts']); expect(() => pendingPlatformUsers(root)).toThrow('ENOENT');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('shared numeric course preserves only each native entry charge', () => {
  const path = 'src/client/game/practice/course.ts', both = new Set(['nalati-grasslands', 'nine-dragon-stack']);
  const names = ['CourseController', 'PracticeCourse', 'MountedCourseEntry', 'GrappleCourseEntry', 'GrappleEntryRows'];
  const modules = new Map([[path, both]]), bindings = new Map(names.map(name => [`${path}\0${name}`, both]));
  chargePlatformUsers(modules, bindings);
  expect(modules.get(path)).toEqual(both);
  expect(bindings.get(`${path}\0PracticeCourse`)).toEqual(both);
  expect(bindings.get(`${path}\0CourseController`)).toEqual(both);
  for (const name of ['MountedCourseEntry']) {
    expect([...bindings.get(`${path}\0${name}`) ?? []]).toEqual(['nalati-grasslands']);
    expect(platformChargeback(path, name)).toBe('C6');
  }
  for (const name of ['GrappleCourseEntry', 'GrappleEntryRows']) {
    expect([...bindings.get(`${path}\0${name}`) ?? []]).toEqual(['nine-dragon-stack']);
    expect(platformChargeback(path, name)).toBe('C6');
  }
  const charges = new Map<string, {path: string; name: string; lines: number}[]>([['nalati-grasslands', []], ['nine-dragon-stack', []]]);
  for (const name of names.slice(2)) recordPrivateCharge(charges, 'fixture', {path, name, lines: 1});
  expect(charges.get('nalati-grasslands')?.map(row => row.name)).toEqual(['MountedCourseEntry']);
  expect(charges.get('nine-dragon-stack')?.map(row => row.name)).toEqual(['GrappleCourseEntry', 'GrappleEntryRows']);
});

test('the single slot roster stays charged despite an optional dispatcher',()=>{
  const path='src/client/game/boss/encounterView.ts',both=new Set(['nalati-grasslands','pine-hollow']);
  const modules=new Map([[path,both]]),bindings=new Map([[`${path}\0SlotEncounterView`,both],[`${path}\0PatrolEncounterView`,both],[`${path}\0CloudBody`,both]]);
  chargePlatformUsers(modules,bindings);
  expect([...bindings.get(`${path}\0SlotEncounterView`)??[]]).toEqual(['nalati-grasslands']);
  expect([...bindings.get(`${path}\0PatrolEncounterView`)??[]]).toEqual(['nalati-grasslands']);
  expect(bindings.get(`${path}\0CloudBody`)).toEqual(both);expect(platformChargeback(path,'SlotEncounterView')).toBe('C4');
});


test('shared hull imports grant no second user to the packed species adapter',()=>{
  const path='src/client/game/looks/speciesBook.ts',format='src/format/speciesLooks.ts',both=new Set(['nalati-grasslands','pine-hollow']);
  const modules=new Map([[path,both],[format,both]]),bindings=new Map([
    [`${path}\0HullLookBook`,both],[`${path}\0SpeciesLookBook`,both],[`${path}\0packedRows`,both],
    [`${format}\0HullLookBookSchema`,both],
  ]);
  chargePlatformUsers(modules,bindings);
  for(const [file,name]of [[path,'SpeciesLookBook'],[path,'packedRows']]as const){
    expect([...bindings.get(`${file}\0${name}`)??[]]).toEqual(['nalati-grasslands']);
    expect(platformChargeback(file,name)).toBe('C1');
  }
  expect(bindings.get(`${path}\0HullLookBook`)).toEqual(both);
  expect(bindings.get(`${format}\0HullLookBookSchema`)).toEqual(both);
  expect(platformChargeback(path,'HullLookBook')).toBeNull();
  expect(platformChargeback(format,'HullLookBookSchema')).toBeNull();
  expect(modules.get(path)).toEqual(both);expect(modules.get(format)).toEqual(both);
  const charges=new Map<string,{path:string;name:string;lines:number}[]>([['nalati-grasslands',[]]]);
  expect(recordPrivateCharge(charges,'fixture',{path,name:'SpeciesLookBook',lines:7})).toBe(true);
  expect(charges.get('nalati-grasslands')?.map(row=>row.name)).toEqual(['SpeciesLookBook']);
});


test('G571 placed actors and G667 group bindings keep broad ownership without chargebacks',()=>{
  const path='src/server/game/population/pageGroups.ts',broad=new Set(['nalati-grasslands','driftwood-isle','pine-hollow']);
  const names=['Placement','Counts','PageActorGroups','PagePopulationPlanner','PageGroups'];
  const bindings=new Map(names.map(name=>[`${path}\0${name}`,broad]));
  chargePlatformUsers(new Map(),bindings);
  for(const name of names){
    expect(bindings.get(`${path}\0${name}`)).toBe(broad);
    expect(platformChargeback(path,name)).toBeNull();
    const row={path,name,lines:7},charges=new Map<string,typeof row[]>([['nalati-grasslands',[]]]);
    expect(recordPrivateCharge(charges,'fixture-only-user',row)).toBe(false);
    expect(charges.get('nalati-grasslands')).toEqual([]);
  }
});


test('explicit admitted Bag rows retire only the former private projection spans',()=>{
 for(const path of ['src/client/game/loot/runtime.ts','src/format/lootEconomy.ts']){
  const reports:string[]=[],spans=inlinePlatformSpans(path,readFileSync(onDisk('.', path),'utf8'),line=>{reports.push(line);});
  expect(spans.some(span=>span.name==='LootBagProjection')).toBe(false);expect(reports).toEqual([]);
 }
});


test('optional chapter dispatch preserves the carried and merged-figure owners', () => {
  const carried = 'src/client/game/quest/carriedProp.ts', figures = 'src/client/game/systems/npc/figureRows.ts';
  const shared = new Set(['pine-hollow', 'driftwood-isle', 'nalati-grasslands']);
  const moduleUsers = new Map([[carried, shared], [figures, shared]]);
  const bindings = new Map([[`${figures}\0FigureRows`, shared]]);
  chargePlatformUsers(moduleUsers, bindings);
  expect([...moduleUsers.get(carried) ?? []]).toEqual(['nalati-grasslands']);
  // G601 credit is the exact picked binding, never a fabricated second user.
  expect(platformChargeback(carried,'CarriedQuestProp')).toBeNull();
  expect(moduleUsers.get(figures)).toEqual(shared);
  expect(bindings.get(`${figures}\0FigureRows`)).toEqual(shared);
});


test('optional chapter imports retain the remaining unapproved combat dependency owners', () => {
  const rows: readonly (readonly [string, readonly string[] | null])[] = [["src/client/engine/combat/effects/types.ts", ["SourceMulDef", "anyTag", "sourceMultiplier"]]];
  const shared = new Set(['pine-hollow', 'driftwood-isle', 'nalati-grasslands']);
  const modules = new Map(rows.map(([path]) => [path, shared]));
  const bindings = new Map(rows.flatMap(([path, names]) => [...(names ?? []), 'unrelatedShared'].map(name => [`${path}\0${name}`, shared])));
  chargePlatformUsers(modules, bindings);
  for (const [path, names] of rows) {
    expect(modules.get(path)).toEqual(names === null ? new Set(['nalati-grasslands']) : shared);
    for (const name of names ?? []) expect(bindings.get(`${path}\0${name}`)).toEqual(new Set(['nalati-grasslands']));
    expect(bindings.get(`${path}\0unrelatedShared`)).toEqual(shared);
  }
});

test('retired crowd geometry intake no longer claims a private reader', () => {
  expect(platformChargeback('src/server/game/ambient/crowdPage.ts', 'readCrowdBody')).toBeNull();
  expect(platformChargeback('src/client/game/models/fixedDraws.ts', 'fixedDraws')).toBeNull();
});

test('retired assembly weather has no private chargeback', () => {
  expect(platformChargeback('src/client/game/shardfile/worldAssembly.ts', 'installAssemblyWeather')).toBeNull();
  expect(platformChargeback('src/client/game/shardfile/clientForestPage.ts', 'installClientForestWeather')).toBeNull();
});

test('ordered arena script construction retains its actual Nalati-only C9 owner', () => {
  const path = 'src/client/game/shardfile/worldAssembly.ts', name = 'installAssemblyArenaScript', both = new Set(['nalati-grasslands', 'driftwood-isle']);
  const modules = new Map([[path, both]]), bindings = new Map([[`${path}\0${name}`, both], [`${path}\0WorldAssembly`, both]]);
  chargePlatformUsers(modules, bindings);
  expect(platformChargeback(path, name)).toBe('C9');
  expect(bindings.get(`${path}\0${name}`)).toEqual(new Set(['nalati-grasslands']));
  expect(bindings.get(`${path}\0WorldAssembly`)).toEqual(both);
});

test('G614 approves exactly the bounds trio and removes only its Nine chargeback', () => {
  const runtime = 'src/client/game/shardfile/clientRuntimeHooks.ts', format = 'src/format/clientPlan.ts';
  const selectors = [[runtime, 'runtimeLevelBounds'], [runtime, 'RuntimeBoundsRows'], [format, 'RuntimeBoundsSchema']] as const;
  const both = new Set(['nine-dragon-stack', 'nalati-grasslands']);
  const bindings = new Map(selectors.map(([path, name]) => [`${path}\0${name}`, both]));
  chargePlatformUsers(new Map(), bindings);
  const approvals = g571HostApprovals('.');
  for (const [path, name] of selectors) {
    expect(platformChargeback(path, name)).toBeNull();
    expect(bindings.get(`${path}\0${name}`)).toBe(both);
    expect(approvedG571Host(approvals, path, name)).toBe(true);
  }
  expect(approvedG571Host(approvals, runtime)).toBe(false);
  expect(approvedG571Host(approvals, format, 'ClientFeatureSchema')).toBe(false);
  expect(platformChargeback(runtime, 'installClientRuntimeHooks')).toBeNull();
});


test('C3 approvals select exactly the picked ground and engine primitives', () => {
  const approvals = g571HostApprovals('.');
  for (const [path,name] of [
    ['src/shared/engine/physics/heightPatch.ts','HeightPatch'],['src/shared/engine/physics/heightPatch.ts','HeightPatchOpts'],
    ['src/client/engine/core/gpuOnly.ts','rebakes'],['src/client/engine/core/gpuOnly.ts','onGpuRestored'],
    ['src/shared/engine/world/water/body.ts','basinBody'],['src/client/game/shard/manifest.ts','declaredGround'],
    ['src/format/terrain.ts','GroundRowsSchema'],
  ]) {
    if (path === undefined || name === undefined) throw new Error('Incomplete C3 selector');
    expect(approvedG571Host(approvals,path,name)).toBe(true);
    expect(approvedG571Host(approvals,path,'unreviewedBinding')).toBe(false);
  }
});


test('the hardened CORE scene host credits all fourteen inline lines without changing their owner', () => {
  const approvals = g571HostApprovals('.'), paths = ['src/client/game/shardfile/worldScenes.ts', 'src/client/game/shardfile/scenePools.ts', 'src/format/worldScenes.ts'];
  // G601 C2's former volume description already named the whole format module.
  const previous = new Map<string, Set<string> | null>([['src/format/worldScenes.ts', null]]);
  let before = 0, chargedBefore = 0, after = 0;
  for (const path of paths) for (const span of inlinePlatformSpans(path, readFileSync(onDisk('.', path), 'utf8'))) {
    expect(platformChargeback(path, span.name)).toBe('C1');
    before += span.lines.length;
    if (!approvedG571Host(previous, path, span.name)) chargedBefore += span.lines.length;
    if (!approvedG571Host(approvals, path, span.name)) after += span.lines.length;
  }
  expect(before).toBe(14); expect(chargedBefore).toBe(9); expect(after).toBe(0);
  expect(paths.every(path => approvals.get(path) === null)).toBe(true);
});


test('C11 shares one native row controller and retires the separate entry classes', () => {
  const approvals=g571HostApprovals('.'),path='src/client/game/practice/course.ts',source=readFileSync(onDisk('.', path),'utf8');
  expect(approvedG571Host(approvals,path,'CourseController')).toBe(true);
  for(const name of ['MountedCourseEntry','GrappleCourseEntry','MountEntryRows','GrappleEntryRows']){
    expect(approvedG571Host(approvals,path,name)).toBe(false);
    expect(source.includes(name)).toBe(false);
    expect(platformChargeback(path,name)).toBe('C6');
  }
});


test('the completed G599 N1 second user grants the explicit post-graph host approval', () => {
  const approvals=g571HostApprovals('.');
  expect(approvedG571Host(approvals,'src/client/game/looks/postGraphLook.ts','postGraphLook')).toBe(true);
  expect(approvedG571Host(approvals,'src/format/postGraphLook.ts')).toBe(true);
});


test('CORE fixed draws credit only their picked defining bindings', () => {
  const approvals = g571HostApprovals('.'), path = 'src/client/game/models/fixedDraws.ts';
  expect(approvedG571Host(approvals, path, 'inlineFixedDraw')).toBe(false);
  expect(approvedG571Host(approvals, path, 'bakedFixedDraws')).toBe(false);
  expect(approvedG571Host(approvals, path, 'fixedDraws')).toBe(true);
  expect(approvedG571Host(approvals, path, 'productFixedDraws')).toBe(true);
  expect(approvedG571Host(approvals, path, 'unreviewedBinding')).toBe(false);
  expect(approvals.get(path)).not.toBeNull();
});

test('the approved riding specimen module contains its factory boundary and retains its actual owner', () => {
  const approvals = g571HostApprovals('.'), path = 'src/client/game/models/mountedSpecimen.ts';
  expect(approvedG571Host(approvals, path)).toBe(true);
  expect(platformChargeback(path)).toBe('C1');
  expect(approvedG571Host(approvals, 'src/game/models/unreviewedSpecimen.ts')).toBe(false);
});

test('G615 credits only timed encounters and its selected slot and patrol views', () => {
  const approvals = g571HostApprovals('.'), path = 'src/client/game/boss/encounterView.ts';
  expect(approvedG571Host(approvals, 'src/client/game/boss/timedEncounters.ts')).toBe(true);
  for (const name of ['SlotEncounterView', 'PatrolEncounterView']) expect(approvedG571Host(approvals, path, name)).toBe(true);
  expect(approvedG571Host(approvals, path)).toBe(false);
  for (const name of ['CloudBody', 'ArenaSceneView', 'EncounterSites']) expect(approvedG571Host(approvals, path, name)).toBe(false);
  expect(platformChargeback(path, 'PatrolEncounterView')).toBe('C4');
});


test('retired arsenal and variant modules leave no standalone item charge',()=>{
  expect(platformChargeback('src/game/loadout/mounted.ts')).toBeNull();
  expect(platformChargeback('src/game/weapons/bowVariant.ts')).toBeNull();
  expect(platformChargeback('src/shared/game/boss/openArenaFight.ts','OpenArenaFight')).toBeNull();
});

test('G667 credits the crowd prey joins and keeps the original Pine ray consumer', () => {
  const path = 'src/shared/game/shardfile/crowdRuntime.ts';
  // Pine's generator declares its forager's combat row; the shared page life builds the weapon target over a roster from it
  expect(readFileSync('src/shards/pine-hollow/generators/pageLife.ts', 'utf8')).toMatch(/combat: \{ target: \{ kind: life\.forager\.id/u);
  expect(readFileSync('src/client/game/population/pageLife.ts', 'utf8')).toContain('new CrowdWeaponTarget(new CrowdRoster([], [new ForagerTargets(population, row.combat, row.scale)]), row.combat.target)');
  for (const name of ['CrowdWeaponTarget', 'CrowdRoster']) expect(platformChargeback(path, name)).toBeNull();
  for (const name of ['CrowdPrey', 'CrowdTargets']) expect(platformChargeback(path, name)).toBeNull();
  const reports: string[] = [], spans = inlinePlatformSpans(path, readFileSync(onDisk('.', path), 'utf8'), line => { reports.push(line); });
  expect(reports).toEqual([]);
  expect(spans).toEqual([]);
});


test('G615 encounter helpers follow the extracted slot owner without approving siblings', () => {
  const path = 'src/client/game/boss/encounterView.ts', shared = new Set(['nalati-grasslands', 'pine-hollow']);
  const names = ['SlotViewActor', 'SlotSiteChange', 'PatrolViewActor', 'PatrolHit', 'Rider', 'PatrolActor', 'PatrolActorRoster'];
  const modules = new Map([[path, shared]]), bindings = new Map(names.map(name => [`${path}\0${name}`, shared]));
  chargePlatformUsers(modules, bindings);
  const approvals = g571HostApprovals('.');
  for (const name of names) {
    expect(platformChargeback(path, name)).toBeNull();
    expect(bindings.get(`${path}\0${name}`)).toEqual(shared);
    expect(approvedG571Host(approvals, path, name)).toBe(true);
  }
  expect(approvedG571Host(approvals, path)).toBe(false);
  for (const name of ['EncounterSite', 'EncounterSites', 'CloudBody', 'lookParam']) expect(approvedG571Host(approvals, path, name)).toBe(false);
  expect(platformChargeback(path, 'SlotEncounterView')).toBe('C4');
  expect(platformChargeback(path, 'PatrolEncounterView')).toBe('C4');
  expect(modules.get(path)).toEqual(shared);
  const law='src/shared/game/boss/slotLaw.ts';
  expect(approvedG571Host(approvals,path,'Awake')).toBe(false);
  expect(approvedG571Host(approvals,law,'Awake')).toBe(true);
  expect(approvedG571Host(approvals,law,'SlotEncounterLaw')).toBe(true);
  expect(platformChargeback(law,'SlotEncounterLaw')).toBe('C4');
  expect(approvedG571Host(approvals,law)).toBe(false);
  for(const name of ['SlotContinuation','SlotActor','SlotTell','SlotActorRoster','SlotSiteChange','continuation'])
    expect(approvedG571Host(approvals,law,name)).toBe(false);
  expect(readFileSync(law,'utf8')).toContain('interface Awake<A, Tell>');
  expect(readFileSync(law,'utf8')).toContain('export class SlotEncounterLaw');
});


test('G621 D4 retires only the three already-approved chapter dependency overrides', () => {
  const shared = new Set(['pine-hollow', 'driftwood-isle', 'nalati-grasslands']);
  const rows = [
    ['src/shared/engine/physics/heightPatch.ts', ['HeightPatch', 'HeightPatchOpts']],
    ['src/client/game/loadout/actors.ts', ['EquipmentActorOwner', 'owners', 'equipmentActorOwner']],
    ['src/client/game/systems/npc/figureSkins.ts', ['atlasFigureSkin']],
  ] as const;
  const modules = new Map(rows.map(([path]) => [path, shared]));
  const bindings = new Map(rows.flatMap(([path, names]) => [...names, 'unreviewed'].map(name => [`${path}\0${name}`, shared])));
  chargePlatformUsers(modules, bindings);
  const approvals = g571HostApprovals('.');
  for (const [path, names] of rows) {
    expect(modules.get(path)).toEqual(shared);
    expect(approvedG571Host(approvals, path)).toBe(false);
    for (const name of names) {
      expect(bindings.get(`${path}\0${name}`)).toEqual(shared);
      expect(approvedG571Host(approvals, path, name)).toBe(true);
    }
    expect(approvedG571Host(approvals, path, 'unreviewed')).toBe(false);
  }
  const combat = 'src/client/engine/combat/effects/types.ts';
  const native = new Map([[`${combat}\0sourceMultiplier`, shared]]);
  chargePlatformUsers(new Map(), native);
  expect(native.get(`${combat}\0sourceMultiplier`)).toEqual(new Set(['nalati-grasslands']));
  expect(approvedG571Host(approvals, combat, 'sourceMultiplier')).toBe(false);
});


test('G665 credits only the complete listed open-arena host',()=>{
  const rows = [
    ['src/client/game/boss/arenaRoom.ts',['OpenArenaWorld','_openW']],
    ['src/client/game/boss/arenaRoomView.ts',['buildOpenArenaEncounter','arenaScriptCloud']],
    ['src/shared/game/boss/openArenaFight.ts',['OpenArenaFight','SupportActor','Chain','_openV','_openRAY','_openSPH','_openHITP','readArenaScriptData','OpenArenaViews','OpenArenaFightWorld','OpenArenaFightHost','ArenaBodyPort','ArenaScenePort','ArenaFirePort','ArenaWhirlsPort']],
    ['src/client/game/riding/client.ts',['ArenaBoundary','boundaries','arenaBlockedAt','installArenaBoundary','arenaBoundaryBlocked']],
  ] as const;
  const shared=new Set(['nalati-grasslands','pine-hollow']),approvals=g571HostApprovals('.');
  const modules=new Map(rows.map(([path])=>[path,shared]));
  const bindings=new Map(rows.flatMap(([path,names])=>names.map(name=>[`${path}\0${name}`,shared] as const)));
  chargePlatformUsers(modules,bindings);
  for(const [path,names]of rows){
    expect(modules.get(path)).toBe(shared);
    expect(approvedG571Host(approvals,path)).toBe(false);
    for(const name of names){
      expect(platformChargeback(path,name)).toBeNull();
      expect(approvedG571Host(approvals,path,name)).toBe(true);
      expect(bindings.get(`${path}\0${name}`)).toBe(shared);
    }
    expect(approvedG571Host(approvals,path,'unreviewed')).toBe(false);
  }
  expect(approvedG571Host(approvals,'src/client/game/boss/arenaRoom.ts','ArenaRoomEncounter')).toBe(false);
  expect(approvedG571Host(approvals,'src/client/game/riding/client.ts','installClientRiding')).toBe(false);
  expect(platformChargeback('src/client/game/shardfile/worldAssembly.ts','installAssemblyArenaScript')).toBe('C9');
  expect(platformChargeback('src/game/boss/arenaScript.ts')).toBe('C4');
});


test('pending native continuation receipts name the actual defining schema and type', () => {
  const names = ['EliteCoreContinuationSchema', 'EliteCoreContinuation'];
  const rows = pendingRows.entries.filter(row => row.shard === 'nalati-grasslands' && 'export' in row && names.includes(row.export ?? ''));
  expect(rows.map(row => ({ module: row.module, export: 'export' in row ? row.export : undefined, shard: row.shard }))).toEqual(
    names.map(name => ({ module: 'src/format/eliteContinuation.ts', export: name, shard: 'nalati-grasslands' })),
  );
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync('tmp/native-continuation-receipts-');
  try {
    mkdirSync(`${root}/lint`); mkdirSync(`${root}/node_modules/@wildshard/format/src/format`, { recursive: true }); mkdirSync(`${root}/docs/plans/host-audit`, { recursive: true });
    writeFileSync(`${root}/lint/platform-pending-users.json`, JSON.stringify({ schema: pendingRows.schema, entries: rows }));
    writeFileSync(`${root}/node_modules/@wildshard/format/src/format/eliteContinuation.ts`, readFileSync('node_modules/@wildshard/format/src/format/eliteContinuation.ts', 'utf8'));
    writeFileSync(`${root}/docs/ENGINE.md`, 'format/eliteContinuation');
    writeFileSync(`${root}/docs/plans/host-audit/shard-platform-rows.md`, '| W3 Nalati elite rule continuation (G441) | Nalati |');
    expect(pendingPlatformUsers(root)).toEqual(rows);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('retired elite keeper selectors carry no chargeback after declared engine entry', () => {
  for (const name of ['keeperBrains','keeperActs','keeperDamage','setEliteBrain','setEliteAct','setEliteDamage','eliteThink','eliteAct','eliteDamageMul','KeeperEliteRow','KeeperEliteEffect','KeeperEliteServices','KeeperElitePage'])
    expect(platformChargeback('src/client/game/quest/elitePage.ts', name)).toBeNull();
});

test('G667 case three credits only its exact original binding selectors',()=>{
  const rows = [
    ['src/client/game/looks/speciesBook.ts',['productSpeciesCatalogue', 'SpeciesCatalogue', 'speciesBehaviour']],
    ['src/shared/engine/entities/eliteBrain.ts',['current', 'eliteThink', 'eliteAct', 'eliteDamageMul']],
    ['src/shared/game/shardfile/crowdRuntime.ts',['CrowdPrey', 'CrowdTargets', 'CrowdRoster']],
  ] as const;
  const shared=new Set(['nalati-grasslands','pine-hollow']),approvals=g571HostApprovals('.');
  const modules=new Map(rows.map(([path])=>[path,shared]));
  const bindings=new Map(rows.flatMap(([path,names])=>[...names,'unreviewed'].map(name=>[`${path}\0${name}`,shared] as const)));
  chargePlatformUsers(modules,bindings);
  for(const [path,names]of rows){
    expect(modules.get(path)).toBe(shared);expect(approvedG571Host(approvals,path)).toBe(false);
    for(const name of names){
      expect(platformChargeback(path,name)).toBeNull();expect(approvedG571Host(approvals,path,name)).toBe(true);
      expect(bindings.get(`${path}\0${name}`)).toBe(shared);
    }
    expect(approvedG571Host(approvals,path,'unreviewed')).toBe(false);
    expect(bindings.get(`${path}\0unreviewed`)).toBe(shared);
  }
  expect(approvedG571Host(approvals,'src/server/game/ambient/crowdPage.ts','createPageCrowds')).toBe(false);
  expect(approvedG571Host(approvals,'src/shared/game/shardfile/crowdRuntime.ts','CrowdWeaponTarget')).toBe(false);
  expect(approvedG571Host(approvals,'src/shared/engine/entities/eliteBrain.ts','setEliteBrain')).toBe(false);
});


test('G667 case 1 credits only the listed herd and pack host',()=>{
  const rows=[
    ["src/server/game/shardfile/groupRuntime.ts", ["collections", "nativeHerdCollection", "nativeGroupCollection", "NativeGroupCollection", "installNativeGroupRows"]],
  ] as const;
  const approvals=g571HostApprovals('.'),users=new Set(['nalati-grasslands','pine-hollow']);
  const modules=new Map(rows.map(([path])=>[path,users]));
  const bindings=new Map(rows.flatMap(([path,names])=>names.map(name=>[`${path}\0${name}`,users] as const)));
  chargePlatformUsers(modules,bindings);
  for(const [path,names]of rows){
    expect(modules.get(path)).toBe(users);
    expect(approvedG571Host(approvals,path)).toBe(false);
    for(const name of names){
      expect(approvedG571Host(approvals,path,name)).toBe(true);
      expect(platformChargeback(path,name)).toBeNull();
      expect(bindings.get(`${path}\0${name}`)).toBe(users);
    }
    expect(approvedG571Host(approvals,path,'unreviewed')).toBe(false);
  }
  expect(approvedG571Host(approvals,'src/client/game/shardfile/worldAssembly.ts','installAssemblyWeather')).toBe(false);
  expect(platformChargeback('src/client/game/shardfile/worldAssembly.ts','installAssemblyWeather')).toBeNull();
});


test('G667 case two credits only the listed native driver roster and field',()=>{
 const rows=[
  ['src/server/game/population/nativeManager.ts',['NativePopulationDriver','NativeDriverRows']],
  ['src/server/game/shardfile/homeKeeper.ts',['NativeDeferredRoster','NativeDeferredSpawn']],
  ['src/server/game/population/environment.ts',['NativePopulationField']],
 ] as const;
 const approvals=g571HostApprovals('.'),users=new Set(['nalati-grasslands']);
 const modules=new Map(rows.map(([path])=>[path,users]));
 const bindings=new Map(rows.flatMap(([path,names])=>names.map(name=>[`${path}\0${name}`,users] as const)));
 chargePlatformUsers(modules,bindings);
 for(const[path,names]of rows){
  expect(modules.get(path)).toBe(users);expect(approvedG571Host(approvals,path)).toBe(false);
  for(const name of names){expect(approvedG571Host(approvals,path,name)).toBe(true);expect(platformChargeback(path,name)).toBeNull();expect(bindings.get(`${path}\0${name}`)).toBe(users);}
  expect(approvedG571Host(approvals,path,'unreviewed')).toBe(false);
 }
 expect(approvedG571Host(approvals,'src/server/game/population/nativeManager.ts','NativeManager')).toBe(false);
 expect(approvedG571Host(approvals,'src/server/game/shardfile/homeKeeper.ts','createNativeCreatureRoster')).toBe(false);
 expect(approvedG571Host(approvals,'src/server/game/population/environment.ts','installPopulationEnvironment')).toBe(false);
});

test('G677 credits only the exact entered adapters and preserves their original authorities',()=>{
  const rows = [
    ['src/client/game/shardfile/clientStealthEntry.ts',['EntryRows','bindStealthWeapons','installClientStealthEntry']],
    ['src/client/game/shardfile/clientTimedEncounters.ts',['installClientTimedEncounters']],
    ['src/client/game/shardfile/clientEliteConstruction.ts',['installClientEliteConstruction']],
  ] as const;
  const users=new Set(['nalati-grasslands','pine-hollow']),approvals=g571HostApprovals('.');
  const modules=new Map(rows.map(([path])=>[path,users]));
  const bindings=new Map(rows.flatMap(([path,names])=>names.map(name=>[`${path}\0${name}`,users] as const)));
  chargePlatformUsers(modules,bindings);
  for(const [path,names]of rows){
    expect(modules.get(path)).toBe(users);expect(approvedG571Host(approvals,path)).toBe(false);
    for(const name of names){
      expect(approvedG571Host(approvals,path,name)).toBe(true);expect(platformChargeback(path,name)).toBeNull();
      expect(bindings.get(`${path}\0${name}`)).toBe(users);
    }
    expect(approvedG571Host(approvals,path,'unreviewed')).toBe(false);
  }
  // The original G571 module grant already covers these loan types; G677 must not duplicate it.
  expect(approvedG571Host(approvals,'src/shared/game/shardfile/entryOwners.ts','WorldFrameOwner')).toBe(true);
  expect(approvedG571Host(approvals,'src/shared/game/shardfile/entryOwners.ts','EliteEntryConstruction')).toBe(true);
  expect(approvedG571Host(approvals,'src/client/game/riding/client.ts','enterClientRiding')).toBe(false);
  const hostBar=readFileSync('docs/HOST-BAR.md','utf8').split('\n').filter(line=>line.startsWith('- G677 ')).join('\n');
  expect(hostBar).not.toContain('game/client/stealth/controller');expect(hostBar).not.toContain('game/server/population/pageGroups');
  expect(hostBar).not.toContain('game/client/shardfile/entryOwners');
});
