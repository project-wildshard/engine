// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the generator's actual Node strip-only parser.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- The installed package is read as text, not imported.
import { globSync, readFileSync } from 'node:fs';
import { expect,test } from 'vitest';

test('every v2 format module supports the generator strip-only loader',() => {
  const files = globSync('node_modules/@wildshard/format/src/format/*V2.ts');
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(() => stripTypeScriptTypes(readFileSync(file,'utf8'),{ mode: 'strip' }),file).not.toThrow();
  }
});
