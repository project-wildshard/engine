import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the tiny real compiler fixture.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve that compiler fixture without changing process cwd.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin the miniature product's actual metadata bytes.
import { createHash } from 'node:crypto';
import { readModuleFiles } from '../src/client/engine/boot/download';
import { bootModuleFiles, bootModuleGroups, clientFeatureImports, startupImports } from '../scripts/app-build/bootModules';
import { buildWithBootModules, writtenFiles } from './fixtures/written-build';
import { writtenBundle } from '../scripts/app-build/writtenBundle';

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

test('the actual Vite plugin emits exact module body sizes into the existing document without fetching optional code', async () => {
  mkdirSync('tmp/vite-boot-modules', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-boot-modules/case-'));
  try {
    mkdirSync(resolve(root, 'src/client/game/shardfile'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/game/grid'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/game/session'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/engine/practice'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/engine/models'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/engine/anim'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/game/shard'), { recursive: true });
    mkdirSync(resolve(root, 'src/client/game/models'), { recursive: true });
    writeFileSync(resolve(root, 'index.html'), '<html><head></head><body><script type="module" src="/src/client/app/entry.ts"></script></body></html>');
    writeFileSync(resolve(root, 'src/client/app/entry.ts'), `
      window.optionalClient = () => import('./game/client/shardfile/client');
      window.optionalGrid = () => import('./game/client/grid/session');
      window.optionalLoadout = () => import('./game/client/session/loadout');
      window.title = () => import('./title');
      async function startSelected() { return (await import('./first')).value; }
      void startSelected().then(value => { window.value = value; });
    `);
    writeFileSync(resolve(root, 'src/first.ts'), 'import "./main.css"; import {dummy} from "./engine/client/models/trainingDummy"; import {prepare} from "./engine/client/anim/rig"; import {legacy} from "./game/client/shard/load"; window.parsers=[prepare,legacy]; window.dummy=dummy; window.practice = ()=>import("./engine/client/practice/TrainingArena").then(module=>module.practice()); export const value = "π";');
    writeFileSync(resolve(root, 'src/client/engine/practice/TrainingArena.ts'), 'import {dummyFigure} from "../models/trainingDummyFigure"; export const practice=()=>Promise.all([import("./DummyClips"),dummyFigure()]);');
    writeFileSync(resolve(root, 'src/client/engine/practice/DummyClips.ts'), 'export const clips = 1;');
    writeFileSync(resolve(root, 'src/client/engine/anim/rig.ts'), 'export const prepare=()=>import("./rigParser");');
    writeFileSync(resolve(root, 'src/client/engine/anim/rigParser.ts'), 'export const createRigLoader=()=>({kind:"bounded"});');
    writeFileSync(resolve(root, 'src/client/game/shard/load.ts'), 'export const legacy=()=>import("./legacyParser");');
    writeFileSync(resolve(root, 'src/client/game/shard/legacyParser.ts'), 'export const loader="raw";');
    writeFileSync(resolve(root, 'src/client/game/session/loadout.ts'), 'export const roster=()=>import("../models/explorerCatalogue");');
    writeFileSync(resolve(root, 'src/client/game/models/explorerCatalogue.ts'), 'export const explorerRoster=()=>[];');
    writeFileSync(resolve(root, 'src/client/engine/models/trainingDummy.ts'), 'export const dummy=()=>import("./trainingDummyFigure");');
    writeFileSync(resolve(root, 'src/client/engine/models/trainingDummyFigure.ts'), 'export const dummyFigure=()=>import("../practice/TrainingDummyAssets");');
    writeFileSync(resolve(root, 'src/client/engine/practice/TrainingDummyAssets.ts'), 'export const model = 1;');
    writeFileSync(resolve(root, 'src/main.css'), 'body { color: red; }');
    writeFileSync(resolve(root, 'src/title.ts'), 'export const title = "optional title";');
    writeFileSync(resolve(root, 'src/client/game/shardfile/client.ts'), 'import {CLIENT_FEATURES} from "./clientPlan"; export const client = CLIENT_FEATURES;');
    writeFileSync(resolve(root, 'src/client/game/shardfile/clientPlan.ts'), 'export const CLIENT_FEATURES = {"world.scenes":{install:()=>import("./optional-first")},"world.first":{install:()=>import("./optional-first")},"world.second":{install:()=>import("./optional-second")}};');
    writeFileSync(resolve(root, 'src/client/game/shardfile/optional-first.ts'), 'export const first = "first world";');
    writeFileSync(resolve(root, 'src/client/game/shardfile/optional-second.ts'), 'export const second = "second world";');
    writeFileSync(resolve(root, 'src/client/game/grid/session.ts'), 'export const grid = () => import("./reveal");');
    writeFileSync(resolve(root, 'src/client/game/grid/reveal.ts'), 'export const reveal = "grid reveal";');
    writeFileSync(resolve(root, 'src/client/game/session/play.ts'), 'export const play = () => import("../grid/reveal");');
    const product = resolve(root,'out/example'); mkdirSync(product,{recursive:true});
    const sections = Object.entries({'client/plan':{version:1,features:[{kind:'world.scenes'}]},
      'look/materials':{rows:{looks:[{recipe:'platform.skin'}]}},'explore/catalogue':{version:1,entries:[]}}).map(([name,value]) => {
      const text=JSON.stringify(value),path=`${name.replaceAll('/','-')}.json`;writeFileSync(resolve(product,path),text);
      return {name,path,bytes:Buffer.byteLength(text),hash:createHash('sha256').update(text).digest('hex')};
    });
    writeFileSync(resolve(product,'shard.json'),JSON.stringify({format:'wildshard.shardfile',formatVersion:2,version:{},identity:{slug:'example'},requires:{},admission:{library:[],critical:[]},sections,schemas:[],files:[],runtime:null}));
    const outDir = await buildWithBootModules(root), output = writtenFiles(outDir);
    const match = /<script type="application\/json" id="boot-module-files">([^<]+)<\/script>/u.exec(readFileSync(resolve(outDir, 'index.html'), 'utf8'));
    if (match?.[1] === undefined) throw new Error('Missing emitted module facts');
    const rows: unknown = JSON.parse(match[1]);
    if (typeof rows !== 'object' || rows === null || !('common' in rows) || !('client' in rows) || !('grid' in rows) || !('products' in rows)) throw new Error('Missing banks');
    const expected = (stems: readonly string[]): [string, number][] => output.filter(file => stems.some(stem => file.fileName.includes(stem)) || file.fileName.endsWith('.css'))
      .map((file): [string, number] => [`/${file.fileName}`, file.bytes]).sort(([left], [right]) => left.localeCompare(right));
    const productText=readFileSync(resolve(product,'shard.json'),'utf8');
    const total=Buffer.byteLength(productText)+sections.reduce((sum,row)=>sum+row.bytes,0);
    expect(rows.products).toEqual({'/shardfiles/example/':[Buffer.byteLength(productText),total,total,total]});
    expect(rows.common).toEqual(expected(['/first-', '/index-']));
    expect(rows.client).toEqual(expected(['/client-', '/index-']));
    expect(rows.grid).toEqual(expected(['/session-', '/reveal-', '/index-']));
    const optional: unknown = Reflect.get(rows, 'optional');
    if (typeof optional !== 'object' || optional === null) throw new Error('Missing optional banks');
    const files = readModuleFiles(Reflect.get(optional, 'files')), groups: unknown = Reflect.get(optional, 'groups');
    if (typeof groups !== 'object' || groups === null) throw new Error('Missing optional groups');
    const indices: unknown = Reflect.get(groups, 'world.first');
    if (!Array.isArray(indices)) throw new Error('Missing first group');
    expect(indices.map(index => { if (typeof index !== 'number') throw new Error('Invalid group index'); return files[index]; })).toEqual(expected(['/optional-first-']));
    const home: unknown = Reflect.get(groups,'home:/shardfiles/example/');
    if(!Array.isArray(home))throw new Error('Missing selected home graph');
    expect(home.map(index => {if(typeof index!=='number')throw new Error('Invalid home index');return files[index];})).toEqual(expected(['/optional-first-','/rigParser-']));
    expect(home.map(index => {if(typeof index!=='number')throw new Error('Invalid home index');return files[index];})).not.toEqual(expect.arrayContaining(expected(['/explorerCatalogue-'])));
    expect(rows.common).not.toEqual(expect.arrayContaining(expected(['/optional-first-'])));
    const practice: unknown = Reflect.get(groups, 'practice.models');
    if (!Array.isArray(practice)) throw new Error('Missing practice group');
    const practiceFiles = practice.map(index => { if (typeof index !== 'number') throw new Error('Invalid practice index'); const file = files[index]; if (file === undefined) throw new Error('Missing practice file'); return file; });
    expect(practiceFiles.sort(([left], [right]) => left.localeCompare(right))).toEqual(expected(['/DummyClips-', '/TrainingDummyAssets-', '/trainingDummyFigure-', '/index-']));
    expect(rows.common).not.toEqual(expect.arrayContaining(practiceFiles));
    for (const [kind, stem] of [['models.gltf', '/rigParser-'], ['legacy.gltf', '/legacyParser-'], ['explorer.catalogue', '/explorerCatalogue-']] as const) {
      const parserIndices: unknown = Reflect.get(groups, kind);
      if (!Array.isArray(parserIndices)) throw new Error('Missing parser module facts');
      const selected = parserIndices.map(index => {
        if (typeof index !== 'number' || files[index] === undefined) throw new Error('Invalid parser module index');
        return files[index];
      });
      expect(selected).toEqual(expected([stem]));
      for (const file of expected([stem]).filter(([url]) => !url.endsWith('.css'))) expect(rows.common).not.toContainEqual(file);
    }
    expect(JSON.stringify(rows)).not.toContain('/title-');
    expect(readFileSync(resolve(root, 'index.html'), 'utf8')).not.toContain('boot-module-files');
  } finally { rmSync(root, { recursive: true, force: true }); }
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
