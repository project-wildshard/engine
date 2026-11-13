// oxlint-disable-next-line import/no-nodejs-modules -- Compare the same lint input in both supported filename forms.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { generatorImportViolation, sharddevRuntimeImport, shardEngineImport, shardGameImport } from '../lint/shard-imports.mjs';

const relative = 'src/shards/check/generators/build.ts';
const filenames = [relative, resolve(relative)];

test.each(['./shape', '../data/rows.json', '@wildshard/sharddev/random', '@wildshard/commons/palette', 'three', 'three/examples/jsm/utils/BufferGeometryUtils.js'])(
  'author import %s stays allowed for relative and absolute filenames', source => {
    for (const filename of filenames) expect(generatorImportViolation(filename, source)).toBeNull();
  },
);

test.each(['../../other/generators/shape', '../../../game/private', '@wildshard/engine/private', '@wildshard/sharddev/runtime/level', 'node:fs', 'valibot'])(
  'author import %s stays refused for relative and absolute filenames', source => {
    for (const filename of filenames) expect(generatorImportViolation(filename, source)).not.toBeNull();
  },
);

// Node resolves a relative specifier as a URL, so `./%2e%2e/` is `..` there (Vite refuses it unresolved), while
// path.resolve keeps `%2e%2e` as a folder name inside the shard. No author path needs one: refuse what the URL rewrites.
test('author imports refuse paths a URL reads differently: percent-escapes, backslashes, tabs, newlines', () => {
  const data = 'src/shards/check/data/a.ts';
  for (const [filename, source] of [[relative, './%2e%2e/%2e%2e/other/generators/x'],
    [relative, '../%2E./other/data/a.json'], [relative, './.%2e/%2E%2e/other/generators/x'],
    [relative, '%2e%2e/%2e%2e/other/generators/x'], [data, './%2e%2e/%2e%2e/other/data/a.json'],
    [relative, '..%2f..%2fother/generators/x'], [relative, './..%2F..%2Fother/generators/x'],
    [relative, `file://${resolve('src/shards/check')}/..%2f..%2fother/generators/x.ts`],
    [relative, '@wildshard/sdk%2fsrc/sharddev/immutable.ts'], [relative, '@wildshard/%65ngine'],
    [relative, '@wildshard%2Fengine/host/immutable'], [relative, '@%77ildshard/engine?raw']] as const)
    for (const name of [filename, resolve(filename)])
      expect(generatorImportViolation(name, source), source).toMatch(/percent-escape.*write the path plainly/u);
  // The URL parser also reads `\\` as `/` and drops tabs, newlines and edge spaces; path.resolve keeps them all.
  for (const source of ['./..\\..\\other/generators/x', '..\\..\\other/generators/x', './.\t./.\t./other/generators/x',
    './.\n./.\r./other/generators/x', './rows '])
    for (const filename of filenames) expect(generatorImportViolation(filename, source), source).toMatch(/write the path plainly/u);
  for (const filename of filenames) expect(generatorImportViolation(filename, 'file://host/src/shards/check/data/a.json')).not.toBeNull();
  for (const source of ['./rows?x=%2e', './rows/', '.', '../data/', '@wildshard/sdk/scripts/x.mjs?worker&name=a%20b'])
    for (const filename of filenames) expect(generatorImportViolation(filename, source), source).toBeNull();
});

// The game and engine boundary predicates read a relative path the way Node does too, so an escape cannot hide one.
test('game and engine imports are found through percent-escapes, backslashes and a ?query', () => {
  for (const filename of filenames) {
    for (const source of ['./%2e%2e/%2e%2e/%2e%2e/client/game/x', '..\\..\\..\\client\\game\\x', '../../../client/game?raw'])
      expect(shardGameImport(filename, source), source).toBe(true);
    for (const source of ['./%2e%2e/%2E%2E/%2e%2e/server/engine/x', '..\\..\\..\\shared\\engine\\x', '../../../client/engine#a'])
      expect(shardEngineImport(filename, source), source).toBe(true);
    for (const source of ['./shape', '../data/rows.json', './%2e%2e/x']) {
      expect(shardGameImport(filename, source), source).toBe(false);
      expect(shardEngineImport(filename, source), source).toBe(false);
    }
  }
});

// Bake commands, Blender sources and declarations run or type-check outside the author folders; the layer rules read
// their imports with path.resolve, so an escaped, absolute or file: path refuses there too, and a plain one passes.
test('every shard file refuses escaped, absolute and file: import paths', () => {
  for (const file of ['src/shards/check/bake/run.mjs', 'src/shards/check/blender/rig.mjs', 'src/shards/check/types.d.ts']) {
    for (const filename of [file, resolve(file)]) {
      for (const source of ['./%2e%2e/%2e%2e/other/generators/x.mjs', '..\\..\\other\\x.mjs', './rows '])
        expect(generatorImportViolation(filename, source), source).toMatch(/write the path plainly/u);
      for (const source of [resolve('src/shards/other/x.mjs'), 'file:///repo/src/shards/other/x.mjs'])
        expect(generatorImportViolation(filename, source), source).toMatch(/never an absolute path or file: URL/u);
      for (const source of ['./rows.mjs', '../generators/shape.ts?raw', 'node:fs', '@wildshard/sdk/x', '<computed>'])
        expect(generatorImportViolation(filename, source), source).toBeNull();
    }
  }
});

test('a ?query on a game, engine or runtime package or folder import is still that import', () => {
  for (const filename of filenames) {
    for (const source of ['@wildshard/game?raw', '@wildshard/engine/game#x']) expect(shardGameImport(filename, source), source).toBe(true);
    for (const source of ['@wildshard/engine?raw', '@wildshard/engine#x']) expect(shardEngineImport(filename, source), source).toBe(true);
    for (const source of ['../../../sharddev/runtime', '../../../sharddev/runtime/', '../../../sharddev/runtime?x', './%2e%2e/%2e%2e/%2e%2e/sharddev/runtime/sim'])
      expect(sharddevRuntimeImport(filename, source), source).toBe(true);
    expect(sharddevRuntimeImport(filename, '../../../sharddev/runtimes/x')).toBe(false);
  }
});
