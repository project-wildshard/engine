// oxlint-disable-next-line import/no-nodejs-modules -- A fresh Node isolate proves import-time work without resetting the shared test module graph.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Address the existing strict native simulation loader.
import {resolve} from 'node:path';
import {expect, test} from 'vitest';

test('riding metadata imports without constructing the later rename grapheme segmenter', () => {
  const source = `
    const Native = Intl.Segmenter; let constructed = 0;
    Intl.Segmenter = new Proxy(Native, {construct(target, args) { constructed++; return Reflect.construct(target, args); }});
    const {cleanMountName} = await import('@wildshard/format/riding');
    const imported = constructed;
    let invalid = false;
    try { cleanMountName('Camp horse', 0); } catch (error) { invalid = error.message.includes('limit'); }
    const afterInvalid = constructed;
    const first = cleanMountName(' e\u0301clair and an extra word ', 6), afterFirst = constructed;
    const second = cleanMountName('  ka<ra>   jorga<script>  ', 10);
    console.log(JSON.stringify({imported, invalid, afterInvalid, first, afterFirst, second, constructed}));
  `;
  const result = spawnSync(process.execPath, ['--import', resolve('scripts/sim-node-loader.mjs'), '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 20_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({imported: 0, invalid: true, afterInvalid: 0,
    first: 'Éclair', afterFirst: 1, second: 'Kara Jorga', constructed: 1});
});
