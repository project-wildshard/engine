// HOST-RULER HR1 (meta docs/plans/HOST-RULER-PLAN.md): a built product's page and section roots.
// oxlint-disable-next-line import/no-nodejs-modules -- Reads the pinned format package's section index.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';
import { clientPlanRoots, modulePath, folderRoots, folderRootsFrom, SECTION_HOSTS, sectionHostRows, unresolvedRoots } from '../src/scripts/host-ruler/roots.mjs';

const plan = clientPlanRoots();
const rows = (roots: readonly { from: string; module: string; bindings: readonly string[] }[]) =>
  roots.filter(root => root.from !== '@client-plan').map(root => [root.from, root.module, root.bindings]);

describe('clientPlan.ts read statically', () => {
  test('every import() in CLIENT_FEATURES is read, in all three shapes, and resolves', () => {
    expect(plan.shapes.member + plan.shapes.destructure + plan.shapes.all).toBe(plan.dynamicImports);
    expect(plan.shapes.member).toBeGreaterThan(0);
    expect(plan.shapes.destructure).toBeGreaterThan(0);
    expect(plan.shapes.all).toBeGreaterThan(0);
    expect(unresolvedRoots([...plan.kinds.values()].flat())).toEqual([]);
  });
  test('its own static imports are the shared @client-plan root and resolve', () => {
    expect(plan.shared.length).toBeGreaterThan(20);
    expect(plan.shared.some(row => row.module === 'src/client/engine/world/painterly.ts')).toBe(true);
    expect(plan.shared.some(row => row.module.startsWith('@wildshard/format/src/format/'))).toBe(true);
    expect(unresolvedRoots(plan.shared)).toEqual([]);
    // Client plan types stay out of the runtime roots. The cooked reader owns admission.
    expect(plan.shared.filter(row => row.typeOnly).map(row => row.module).sort()).toEqual([
      '@wildshard/format/src/format/clientPlan.ts', '@wildshard/format/src/format/sections.ts',
      'src/client/game/plugin/context.ts', 'src/shared/engine/app/scope.ts',
    ]);
    expect(plan.shared.find(row => row.module === 'src/client/game/shardfile/cookedDocument.ts'))
      .toMatchObject({ bindings: ['readClientPlan'], typeOnly: false });
  });
  test('a kind roots only its own entry: hooks sharing a target merge, other kinds keep their bindings', () => {
    expect(plan.kinds.get('world.forest-page')).toEqual([{ module: 'src/client/game/shardfile/clientForestPage.ts', bindings: ['enterClientForestPage', 'installClientForestPage'] }]);
    expect(plan.kinds.get('page.life')).toEqual([{ module: 'src/client/game/shardfile/clientForestPage.ts', bindings: ['installClientPageLife'] }]);
    expect(plan.kinds.get('strings.register')).toEqual([]);
  });
});

describe('the section-host table', () => {
  test('names every platform section the pinned format declares, and nothing else', () => {
    const index = readFileSync(modulePath('@wildshard/format/src/format/sections.ts')!, 'utf8');
    const body = index.slice(index.indexOf('export interface PlatformSections {'), index.indexOf('export type PlatformSectionName'));
    const names = [...body.matchAll(/^ {2}'([^']+)':/gmu)].map(match => match[1]);
    expect(names.length).toBeGreaterThan(60);
    expect(Object.keys(SECTION_HOSTS).sort()).toEqual(names.sort());
  });
  test('every host is a side-first module exporting its binding', () => {
    expect(sectionHostRows().every(row => row.module.startsWith('src/') || row.module.startsWith('@wildshard/format/'))).toBe(true);
    expect(unresolvedRoots(sectionHostRows())).toEqual([]);
  });
  test('a missing binding or module is reported', () => {
    expect(unresolvedRoots([{ module: 'src/client/game/shardfile/clientForestPage.ts', bindings: ['noSuchHost'] }, { module: 'src/client/game/nowhere.ts', bindings: ['x'] }]))
      .toEqual(['src/client/game/shardfile/clientForestPage.ts#noSuchHost', 'src/client/game/nowhere.ts']);
  });
});

describe('product roots', () => {
  test('a fixture product lists every root, one per import() shape', () => {
    const roots = folderRoots('test/fixtures/host-ruler/fixture-product', plan);
    expect(roots.slug).toBe('host-ruler-fixture');
    expect(rows(roots.roots)).toEqual([
      ['section:world/scenes', 'src/client/game/shardfile/worldScenes.ts', ['installWorldScenes']],
      ['section:view/modules', '@wildshard/format/src/format/scriptContract.ts', ['ViewModulesSchema', 'admitScriptContract']],
      ['section:held/arms', 'src/client/game/loadout/claims.ts', ['HeldClaims']],
      ['section:held/arms', 'src/client/game/systems/viewmodel/heldView.ts', ['HeldView']],
      ['kind:world.meadow', 'src/client/game/shardfile/clientMeadow.ts', ['installClientMeadow']],
      ['kind:world.forest-page', 'src/client/game/shardfile/clientForestPage.ts', ['enterClientForestPage', 'installClientForestPage']],
      ['kind:world.scenes', 'src/client/game/shardfile/streamingView.ts', ['StreamingCamera']],
      ['kind:world.scenes', 'src/client/game/shardfile/tileDriver.ts', ['cameraCone', 'folderTileRing', 'followResidentTiles', 'noteTileBytes', 'residentTiles']],
      ['kind:world.scenes', 'src/client/game/shardfile/worldScenes.ts', ['installWorldScenes']],
      ['kind:world.dressing', 'src/client/game/shardfile/sceneDressing.ts', ['SceneDressing']],
    ]);
    expect(roots.roots.filter(root => root.from === '@client-plan').map(({ module, bindings }) => ({ module, bindings })))
      .toEqual(plan.shared.filter(root => !root.typeOnly).map(({ module, bindings }) => ({ module, bindings })));
    // world.meadow is the loadFeature member shape, world.forest-page inline destructuring, world.scenes Promise.all.
    expect(['world.meadow', 'world.forest-page', 'world.scenes', 'world.dressing'].map(kind => plan.kindShapes.get(kind)))
      .toEqual([['member'], ['destructure'], ['all'], ['destructure']]);
    expect(unresolvedRoots(roots.modules)).toEqual([]);
  });
  // ZONE-SNAPSHOTS ZS10 (J507): Pine Hollow's live pin, not a trimmed copy of an old revision.
  test('a real product (Pine Hollow\'s live pin) lists every root, zero unresolved', () => {
    const roots = folderRoots(builtFolder('pine-hollow'), plan);
    expect(roots.slug).toBe('pine-hollow');
    expect(roots.kinds.length).toBeGreaterThan(0);
    expect(rows(roots.roots).some(([from]) => (from as string).startsWith('kind:'))).toBe(true);
    // Every declared section with an executable host appears; metadata-only sections root nothing.
    const listed = new Set(roots.roots.map(root => root.from));
    for (const name of roots.sections) expect(listed.has(`section:${name}`) || name === 'client/plan' || SECTION_HOSTS[name]?.length === 0).toBe(true);
    expect(unresolvedRoots(roots.modules)).toEqual([]);
  });
  test('an unknown kind or section refuses', () => {
    expect(() => folderRootsFrom({ slug: 'x', sections: ['client/plan'], kinds: ['world.nowhere'] }, plan)).toThrow('unknown client/plan kind world.nowhere');
    expect(() => folderRootsFrom({ slug: 'x', sections: ['world/nowhere'], kinds: [] }, plan)).toThrow('unknown section world/nowhere');
    expect(() => folderRootsFrom({ slug: 'x', sections: [], kinds: ['world.meadow'] }, plan)).toThrow('without a client/plan section');
  });
});
