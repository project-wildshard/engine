import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Tiny isolated source trees exercise the actual guard.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths only.
import { dirname, join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small disposable fixtures.
import { tmpdir } from 'node:os';
import { closedComponents, closedComponentSources, closedComponentFailures, compareClosedComponents } from '../scripts/check-closed-components.mjs';
import { componentInventory } from '../scripts/shard-components.mjs';
import ratchetPolicy from '../lint/ratchet.json' with { type: 'json' };

test('every countable source is frozen even beyond a partial component policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'closed-components-'));
  const policy = { 'pine-hollow': ['C3', 'C7', 'C8'], 'nine-dragon-stack': ['C5'] };
  const put = (path: string, source: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  try {
    put('src/shards/pine-hollow/runtime/index.ts', 'export const worldBuild = 1;\n');
    put('scripts/source-generation-outputs.json', JSON.stringify({ schema: 'source-generation-outputs/1',
      producers: { 'scripts/gen-shards.mjs': ['src/shards/pine-hollow/discovery.generated.ts'] } }));
    put('src/shards/pine-hollow/discovery.generated.ts', 'export const audio = 1;\n');
    expect(closedComponentSources(root, policy)).toEqual([expect.stringContaining('CLOSED C1')]);
    rmSync(join(root, 'src/shards/pine-hollow/runtime/index.ts'));
    for (const [id, name] of [['C3', 'windFx'], ['C7', 'mover'], ['C8', 'audio']]) {
      const path = `src/shards/pine-hollow/runtime/${name}.ts`;
      put(path, `export const ${name} = 1;\n`);
      expect(closedComponentSources(root, policy)).toEqual([expect.stringContaining(`CLOSED ${id}`)]);
      rmSync(join(root, path));
    }
    put('src/shards/nine-dragon-stack/quest/story.ts', 'export const quest = 1;\n');
    expect(closedComponentSources(root, policy)).toEqual([expect.stringContaining('nine-dragon-stack: CLOSED C5')]);
    rmSync(join(root, 'src/shards/nine-dragon-stack/quest/story.ts'));
    put('src/shards/pine-hollow/runtime/weapons/item.ts', 'export const weapon = 1;\n');
    expect(closedComponentSources(root, policy)).toEqual([expect.stringContaining('CLOSED C6')]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('sole-user platform contributions also fail the full inventory guard', () => {
  const components = componentInventory('', 'pine-hollow', [{ path: 'src/game/audio/private.ts', kind: 'sole-export', name: 'audioCue', lines: 1 }], 1);
  expect(closedComponentFailures({ 'pine-hollow': { components } }, { 'pine-hollow': ['C8'] })).toEqual([
    'pine-hollow: CLOSED C8 Audio has 1 custom lines',
  ]);
  expect(closedComponentFailures({}, { 'pine-hollow': ['C8'] })).toEqual(['pine-hollow: closed component inventory missing']);
});

test('erased JSON declarations stay zero while executable JSON-suffix files remain charged', () => {
  const root = mkdtempSync(join(tmpdir(), 'closed-json-types-'));
  const policy = { 'nalati-grasslands': ['C4', 'C9'] };
  const put = (path: string, source: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
  const contract = 'import type { Rows } from "./types";\ndeclare const rows: Rows;\nexport default rows;\n';
  try {
    for (const path of ['species/example.d.json.ts', 'creatures/example.d.json.ts', 'data/example.d.json.ts'])
      put(`src/shards/nalati-grasslands/${path}`, contract);
    expect(closedComponentSources(root, policy)).toEqual([]);
    const executable = 'src/shards/nalati-grasslands/creatures/extra.d.json.ts';
    for (const source of [
      'export const creature = 1;\n',
      'declare const rows: unknown;\nexport default (() => rows);\n',
      'import { Rows } from "./runtime";\ndeclare const rows: Rows;\nexport default rows;\n',
    ]) {
      put(executable, source);
      expect(closedComponentSources(root, policy)).toEqual([expect.stringContaining('CLOSED C4')]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source checks read art JSON, so an art-only commit still meets the push gate', () => {
  mkdirSync('tmp',{recursive:true});
  const root=mkdtempSync(join('tmp','art-json-'));
  const put=(path:string,source:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);};
  try {
    put('src/shards/far-reach/art/round-1/cameras.json',JSON.stringify({ url:'/?shard=far-reach&view=road',note:'Read: 40 m' }));
    expect(closedComponentSources(root,{})).toEqual([]);
    put('src/shards/far-reach/art/round-1/cameras.json',JSON.stringify({ url:'tier=desktop' }));
    expect(closedComponentSources(root,{})).toEqual([expect.stringContaining('CLOSED art src/shards/far-reach/art/round-1/cameras.json')]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('locks cannot be removed or changed into adjustable budgets', () => {
  const before = { 'pine-hollow': ['C8'] };
  expect(compareClosedComponents(before, { 'pine-hollow': ['C8', 'C3'] })).toEqual([]);
  expect(compareClosedComponents(before, {})).toEqual(['pine-hollow: closed component C8 lock removed']);
  expect(() => closedComponents({ 'pine-hollow': { C8: 1 } })).toThrow('Invalid closedComponents');
  expect(() => closedComponents({ 'pine-hollow': ['C8', 'C8'] })).toThrow('Invalid closedComponents');
});

test('Nine rejects regrowth in all nine zero components after G614', () => {
  const locked = ratchetPolicy.closedComponents['nine-dragon-stack'];
  expect(locked).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']);
  const inventory = (counts: Record<string, number>) => ({ 'nine-dragon-stack': { components: {
    ...componentInventory('', 'nine-dragon-stack', [], 0), counts,
  } } });
  const counts = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0 };
  const nine = { 'nine-dragon-stack': locked };
  expect(closedComponentFailures(inventory(counts), nine)).toEqual([]);
  for (const id of locked) {
    expect(closedComponentFailures(inventory({ ...counts, [id]: 1 }), nine)).toEqual([
      expect.stringContaining(`CLOSED ${id}`),
    ]);
  }
});


test('new, native and Sky shard folders are structurally frozen without policy rows',()=>{
  mkdirSync('tmp',{recursive:true});
  const root=mkdtempSync(join('tmp','all-shard-freeze-'));
  const put=(path:string,source:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);};
  try {
    for(const shard of ['pastel-plain','far-reach','new-shard']) {
      const path=`src/shards/${shard}/runtime/extra.ts`;
      put(path,'export const extra = 1;\n');
      expect(closedComponentSources(root,{})).toEqual([expect.stringContaining(`${shard}: CLOSED`)]);
      rmSync(join(root,path));
    }
    put('src/shards/new-shard/generators/build.ts','export const generate = 1;\n');
    put('src/shards/new-shard/rows.d.json.ts','declare const rows: unknown; export default rows;\n');
    put('src/shards/new-shard/shard.config.ts','export default { slug: "new-shard" };\n');
    put('src/shards/frozen-legacy/runtime/extra.ts','export const legacy = 1;\n');
    expect(closedComponentSources(root,{})).toEqual([]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('all six shards permanently lock every component',()=>{
  for(const shard of ['far-reach','sunscar-dunes','pine-hollow','driftwood-isle','nalati-grasslands','nine-dragon-stack']) {
    expect(Reflect.get(ratchetPolicy.closedComponents,shard)).toEqual(['C1','C2','C3','C4','C5','C6','C7','C8','C9']);
  }
  expect(Object.hasOwn(ratchetPolicy,'closingComponents')).toBe(false);
});
