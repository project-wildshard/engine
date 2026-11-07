// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { readModuleFiles, readModuleGroups, preloadModuleFiles, preloadModuleGroups } from '../src/client/engine/boot/download';
import { checkClientPlanModules, checkProductClientModules, prepareClientModuleGroups } from '../src/client/game/shardfile/clientModules';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { emptyShardfile } from '../src/shared/host/author';

afterEach(() => { document.body.replaceChildren(); for (const link of document.querySelectorAll('link[rel="modulepreload"]')) link.remove(); });
function bank(input: unknown): void {
  const element = document.createElement('script'); element.id = 'boot-module-files';
  element.textContent = JSON.stringify({optional:input}); document.body.append(element);
}
test('warm module groups reuse private parsing and return their exact selected rows', () => {
  bank({files:[['/assets/parser.js',8]],groups:{'models.gltf':[0]}});
  const parse = vi.spyOn(JSON, 'parse');
  try {
    for (let i = 0; i < 4; i++) expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',8]]);
    expect(parse).toHaveBeenCalledTimes(1);
  } finally { parse.mockRestore(); }
});

test('pure group reads deduplicate overlaps without starting transport or native imports', () => {
  bank({files:[['/assets/shared.js',4],['/assets/parser.js',8]],groups:{shared:[0],'models.gltf':[0,1]}});
  const fetch = vi.spyOn(globalThis,'fetch');
  try {
    expect(readModuleGroups(['shared','models.gltf','shared'])).toEqual([['/assets/shared.js',4],['/assets/parser.js',8]]);
    expect(readModuleGroups(['shared'])).toEqual([['/assets/shared.js',4]]);
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelectorAll('link[rel="modulepreload"],script[src]')).toHaveLength(0);
  } finally { fetch.mockRestore(); }
});

test('changed or replaced banks return the exact new compiler facts', () => {
  const input = {files:[['/assets/parser.js',8]],groups:{'models.gltf':[0]}};
  bank(input); expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',8]]);
  const element = document.getElementById('boot-module-files');
  if (element === null) throw new Error('Missing test module bank');
  element.textContent = JSON.stringify({optional:{...input,files:[['/assets/parser.js',12]]}});
  expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',12]]);
  document.body.replaceChildren(); bank(input);
  expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',8]]);
});

test('caller banks are detached and never replace the private compiler selection', () => {
  bank({files:[['/assets/parser.js',8]],groups:{'models.gltf':[0]}});
  const input: [string, number][] = [['/assets/parser.js',12]];
  expect(readModuleFiles(input)).toEqual(input);
  expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',8]]);
  input.push(['/assets/next.js',4]); expect(readModuleFiles(input)).toEqual(input);
  input.push(['/assets/prefix.js',3],['https://foreign.invalid/bad.js',1]);
  expect(() => readModuleFiles(input)).toThrow('Invalid boot module file');
  expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/parser.js',8]]);
});

test('changed module text revalidates unselected files before returning anything', () => {
  bank({files:[['/assets/parser.js',8]],groups:{'models.gltf':[0]}});
  readModuleGroups(['models.gltf']);
  const element = document.getElementById('boot-module-files');
  if (element === null) throw new Error('Missing test module bank');
  element.textContent = JSON.stringify({optional:{files:[['/assets/parser.js',8],['https://foreign.invalid/a.js',9]],groups:{'models.gltf':[0]}}});
  expect(() => readModuleGroups(['models.gltf'])).toThrow('Invalid boot module file');
  element.textContent = JSON.stringify({optional:{files:[['/assets/new.js',12]],groups:{'models.gltf':[0],bad:[1]}}});
  expect(() => readModuleGroups(['models.gltf','bad'])).toThrow('Missing selected client module file');
  expect(readModuleGroups(['models.gltf'])).toEqual([['/assets/new.js',12]]);
});

test('replacement module elements get their own complete admission', () => {
  const input = {files:[['/assets/parser.js',8]],groups:{'models.gltf':[0]}}; bank(input);
  const parse = vi.spyOn(JSON, 'parse');
  try { readModuleGroups(['models.gltf']); document.body.replaceChildren(); bank(input); readModuleGroups(['models.gltf']);
    expect(parse).toHaveBeenCalledTimes(2);
  } finally { parse.mockRestore(); }
});

test('selected product plans retain their actual feature guard without fetching extra graphs', () => {
  bank({files:[['/assets/shared.js',4],['/assets/scenes.js',6],['/assets/meadow.js',8]],groups:{'world.scenes':[0,1],'world.meadow':[0,2]}});
  const source = emptyShardfile({slug:'module-fixture',name:'Modules',author:'Fixture',revision:1,seed:7});
  const product = createShardProduct({slug:source.identity.slug,revision:1,shardfile:source,
    sections:new Map([['client/plan',{version:1,features:[{kind:'world.scenes'}]}]]),files:new Map(),read:()=>Promise.reject(new Error('No read expected'))});
  checkProductClientModules(product);
  expect(readModuleGroups(['world.scenes'])).toEqual([['/assets/shared.js',4],['/assets/scenes.js',6]]);
  expect(readModuleGroups(['world.scenes','world.meadow'])).toHaveLength(3);
  document.body.replaceChildren(); bank({files:[],groups:{}});
  expect(() => checkClientPlanModules({features:[{kind:'world.scenes'}]})).toThrow('Missing selected client module group');
});

test('an invalid suffix or missing selected group returns no usable prefix', () => {
  bank({files:[['/assets/first.js',4]],groups:{good:[0],bad:[1]}});
  expect(() => readModuleGroups(['good','bad'])).toThrow('Missing selected client module file');
  expect(() => readModuleGroups(['good','absent'])).toThrow('Missing selected client module group');
  expect(document.querySelectorAll('link[rel="modulepreload"]')).toHaveLength(0);
});

test('overlapping selected graphs retain their bounded exact file union', () => {
  const files = Array.from({length:1024}, (_, index) => [`/assets/part-${index}.js`,index+1]);
  const indices = files.map((_, index) => index), kinds = Array.from({length:8}, (_, index) => `feature.${index}`);
  bank({files,groups:{...Object.fromEntries(kinds.map(kind => [kind,indices])),bad:[files.length]}});
  expect(() => readModuleGroups([...kinds,'bad'])).toThrow('Missing selected client module file');
  const selected=readModuleGroups(kinds);
  expect(selected).toEqual(files); expect(selected.reduce((sum,row)=>sum+row[1],0)).toBe(524800);
});

test('selected preloads start together without importing code', () => {
  bank({files:[['/assets/shared.js',4],['/assets/scenes.js',6],['/assets/unused.js',8],['/assets/styles.css',2]],
    groups:{'world.scenes':[0,1,3],unused:[2]}});
  preloadModuleGroups(['world.scenes']); preloadModuleGroups(['world.scenes']);
  expect([...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(link => new URL(link.href).pathname)).toEqual(['/assets/shared.js','/assets/scenes.js']);
  expect(document.querySelectorAll('script[src]')).toHaveLength(0);
  preloadModuleFiles([['/assets/direct.js',5]]);
  expect(document.querySelector('link[href$="/assets/direct.js"]')?.getAttribute('crossorigin')).toBe('anonymous');
});

test('invalid selected suffixes create no preload prefix', () => {
  bank({files:[['/assets/first.js',4]],groups:{good:[0],bad:[1]}});
  expect(() => preloadModuleGroups(['good','bad'])).toThrow('Missing selected client module file');
  expect(() => preloadModuleFiles([['/assets/first.js',4],['https://foreign.invalid/second.js',4]])).toThrow('Invalid boot module file');
  expect(document.querySelectorAll('link[rel="modulepreload"]')).toHaveLength(0);
});

test('verified plan metadata prepares only its selected feature and actual loadout graphs', () => {
  bank({files:[['/assets/scenes.js',4],['/assets/explorer.js',6],['/assets/parser.js',8],['/assets/meadow.js',10]],
    groups:{'world.scenes':[0],'explorer.catalogue':[1],'models.gltf':[2],'world.meadow':[3]}});
  const source = emptyShardfile({slug:'module-fixture',name:'Modules',author:'Fixture',revision:1,seed:7});
  const sections = new Map<string,unknown>([['client/plan',{version:1,features:[{kind:'world.scenes'}]}],['explore/catalogue',{version:1,entries:[]}]]);
  prepareClientModuleGroups(source,sections);
  expect([...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(link => new URL(link.href).pathname)).toEqual(['/assets/scenes.js']);
  source.rows.looks.push({id:'look.test',species:'species.test',recipe:'platform.skin',material:null,parameters:{skin:'a'.repeat(64)},animation:{recipe:'platform.clips',parameters:{}}});
  prepareClientModuleGroups(source,sections);
  expect([...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(link => new URL(link.href).pathname)).toEqual(['/assets/scenes.js','/assets/parser.js']);
  expect(document.querySelector('link[href$="meadow.js"]')).toBeNull();
  expect(document.querySelector('link[href$="explorer.js"]')).toBeNull();
  preloadModuleGroups(['explorer.catalogue']);
  expect(document.querySelector('link[href$="explorer.js"]')).not.toBeNull();
});
