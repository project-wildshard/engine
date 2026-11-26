import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the tiny real compiler fixture.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve that compiler fixture without changing process cwd.
import { resolve } from 'node:path';
import { bootModuleFiles, bootModuleGroups, clientFeatureImports, startupImports } from '../src/scripts/app-build/bootModules';
import { writtenBundle } from '../src/scripts/app-build/writtenBundle';

test('grouped dynamic entries follow their manifest facade and complete implementation', () => {
  mkdirSync('tmp/vite-boot-modules', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-boot-modules/facade-')), out = resolve(root, 'dist');
  try {
    mkdirSync(resolve(out, '.vite'), { recursive: true });
    mkdirSync(resolve(out, 'assets'));
    writeFileSync(resolve(out, 'assets/core.js'), 'export const selected = 42;');
    writeFileSync(resolve(out, 'assets/core.js.map'), JSON.stringify({ sources: ['../../src/selected.ts'] }));
    writeFileSync(resolve(out, 'assets/selected.js'), 'export {selected} from "./core.js";');
    writeFileSync(resolve(out, '.vite/manifest.json'), JSON.stringify({
      core: { file: 'assets/core.js' },
      selected: { file: 'assets/selected.js', src: 'src/selected.ts', isDynamicEntry: true, imports: ['core'] },
      alias: { file: 'assets/selected.js', src: 'src/alias.ts', isDynamicEntry: true, imports: ['core'] },
    }));
    const bundle = writtenBundle(out, root), selected = resolve(root, 'src/selected.ts');
    const expected = [['/assets/core.js', 27], ['/assets/selected.js', 35]];
    expect(bootModuleFiles(bundle, [selected])).toEqual(expected);
    expect(bootModuleFiles(bundle, [resolve(root, 'src/alias.ts')])).toEqual(expected);
    expect(() => bootModuleFiles({ ...bundle, 'assets/duplicate.js': bundle['assets/selected.js'] }, [selected])).toThrow('ambiguous');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('startup roots follow the executed entry function, excluding title, recovery and error entry branches', () => {
  expect(startupImports(`
    function title() { return import('./title'); }
    async function startSelected() { await import('./first'); await import('@engine/second'); await import('./first'); }
    function recovery() { return import('./recovery'); }
  `)).toEqual(['./first', '@engine/second']);
  expect(() => startupImports('function title() {}')).toThrow('Missing selected startup');
  expect(() => startupImports('function startSelected() { return import(variable); }')).toThrow('literal source');
  expect(() => startupImports('function startSelected() { if (optional) return import("./optional"); }')).toThrow('Conditional startup imports');
  expect(() => startupImports('function startSelected() { return () => import("./later"); }')).toThrow('Deferred startup imports');
  expect(startupImports('function startSelected() { return retried(() => import("./required")); }')).toEqual(['./required']);
  const actual = startupImports(readFileSync('src/client/app/entry.ts', 'utf8'));
  expect(actual).toContain('@wildshard/engine/game/session/session');
  expect(actual).toContain('./shardSelection');
  expect(actual).not.toContain('./shardList');
  expect(actual).not.toContain('@wildshard/engine/ui/StartTitle');
  expect(actual.length).toBe(new Set(actual).size);
});

test('static closures deduplicate shared/cyclic chunks, count UTF-8 and CSS, and exclude optional imports and asset URLs', () => {
  const bundle = {
    'assets/entry.js': { type: 'chunk', code: 'é', modules: { '/entry.ts': {} }, imports: ['assets/shared.js'], dynamicImports: ['assets/optional.js'], assets: ['assets/picture.webp'] },
    'assets/other.js': { type: 'chunk', code: 'ab', modules: { '/other.ts': {} }, imports: ['assets/shared.js'] },
    'assets/shared.js': { type: 'chunk', code: 'x', imports: ['assets/entry.js'] },
    'assets/optional.js': { type: 'chunk', code: 'optional' },
    'assets/main.css': { type: 'asset', source: 'abc' },
    'assets/picture.webp': { type: 'asset', source: new Uint8Array(1000) },
  };
  expect(bootModuleFiles(bundle, ['/entry.ts', '/other.ts'])).toEqual([
    ['/assets/entry.js', 2], ['/assets/main.css', 3], ['/assets/other.js', 2], ['/assets/shared.js', 1],
  ]);
  expect(() => bootModuleFiles(bundle, ['/missing.ts'])).toThrow('Missing or ambiguous');
  expect(() => bootModuleFiles({ ...bundle, duplicate: { ...bundle['assets/entry.js'] } }, ['/entry.ts'])).toThrow('ambiguous');
  expect(() => bootModuleFiles({ 'assets/entry.js': { ...bundle['assets/entry.js'], imports: ['missing'] } }, ['/entry.ts'])).toThrow('Missing boot module dependency');
});

test('feature module facts follow literal rows and share one file table', () => {
  const actual = clientFeatureImports(readFileSync('src/client/game/shardfile/clientPlan.ts', 'utf8'));
  // Hostless plans need the driver and its camera view before controls.
  // These explicit roots are already in the worldScenes static closure.
  expect(actual['world.scenes']).toEqual(['./worldScenes', './tileDriver', './streamingView']);
  expect(actual['world.dressing']).toEqual(['./sceneDressing']);
  expect(clientFeatureImports(`export const CLIENT_FEATURES = {
    'world.first': { install: () => import('./first'), play: { install: () => import('./first') } },
    'world.second': { install: () => import('./second') }, 'strings.register': { install() {} }
  };`)).toEqual({'world.first':['./first'],'world.second':['./second'],'strings.register':[]});
  expect(() => clientFeatureImports(`const CLIENT_FEATURES = {'world.first': {install: () => import(path)}};`)).toThrow('literal import');
  const bank = bootModuleGroups({
    'assets/first.js': {type:'chunk', code:'first', modules:{'/first.ts':{}}, imports:['assets/shared.js']},
    'assets/second.js': {type:'chunk', code:'second', modules:{'/second.ts':{}}, imports:['assets/shared.js']},
    'assets/shared.js': {type:'chunk',code:'shared'},
  }, {'world.first':['/first.ts'],'world.second':['/second.ts'],'strings.register':[]});
  expect(bank.files).toHaveLength(3);
  expect(bank.groups['strings.register']).toEqual([]);
  expect(bank.groups['world.first']?.map(index => bank.files[index])).toEqual([['/assets/first.js',5],['/assets/shared.js',6]]);
  expect(bank.groups['world.second']?.map(index => bank.files[index])).toEqual([['/assets/second.js',6],['/assets/shared.js',6]]);
});


test('an explicit scene driver root adds no files or bytes to the scene static closure', () => {
  const bundle = {
    'assets/scenes.js': { type: 'chunk', code: 'scenes', modules: { '/worldScenes.ts': {} }, imports: ['assets/tiles.js'] },
    'assets/tiles.js': { type: 'chunk', code: 'tiles', modules: { '/tileDriver.ts': {} }, imports: ['assets/shared.js'] },
    'assets/shared.js': { type: 'chunk', code: 'shared' },
    'assets/main.css': { type: 'asset', source: 'css' },
    'assets/optional.js': { type: 'chunk', code: 'not booted', modules: { '/optional.ts': {} } },
  };
  const scenes = bootModuleFiles(bundle, ['/worldScenes.ts']);
  expect(bootModuleFiles(bundle, ['/worldScenes.ts', '/tileDriver.ts'])).toEqual(scenes);
  expect(scenes).toEqual([['/assets/main.css', 3], ['/assets/scenes.js', 6], ['/assets/shared.js', 6], ['/assets/tiles.js', 5]]);
});
