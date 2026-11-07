// oxlint-disable-next-line import/no-nodejs-modules -- Compare the same lint input in both supported filename forms.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { generatorImportViolation } from '../lint/shard-imports.mjs';

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
