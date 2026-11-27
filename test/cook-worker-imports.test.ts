// @vitest-environment node
// SF15: the cook's encoder worker threads load a module through src/scripts/format-hook.mjs only, which strips types but
// resolves no extensionless relative import, so a value import there must name its `.ts` (cook 1.1.0 died on
// `./astc6Wasm` in every Pine cook while vitest, which resolves it, stayed green).
// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the worker modules' source.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

/** The modules a cook worker thread imports by `workerData.module` (their WORKER strings). */
const WORKER_MODULES = ['src/cook/game/imageKtx2Wasm.ts', 'src/cook/game/astc6Wasm.ts'];
const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gmu;

test('a cook worker module names the extension of every relative value import', () => {
  const extensionless = WORKER_MODULES.flatMap(file => [...readFileSync(file, 'utf8').matchAll(VALUE_IMPORT)]
    .map(match => match[1] ?? '').filter(specifier => !/\.(?:ts|mjs|js|json)$/u.test(specifier)).map(specifier => `${file}: ${specifier}`));
  expect(extensionless).toEqual([]);
});
