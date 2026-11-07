// oxlint-disable-next-line import/no-nodejs-modules -- Exercise both real entry points in a tiny owned Git-independent fixture.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual entry scripts supplied to the fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Private candidate paths are test inputs, never production hook switches.
import { env } from 'node:process';
import { expect, test } from 'vitest';

const { WS_GEN_DOCS_FIXTURE: fixture, WS_GEN_ENTRY: game, WS_DOCS_ENTRY: docs } = env;
test('all generation modes exclude derived docs; docs keeps every writer and propagates failure', () => {
  expect(execFileSync('python3', [fixture ?? 'test/fixtures/gen-docs.py', game ?? resolve('scripts/gen.mjs'), docs ?? resolve('scripts/docs.mjs')],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).toContain('6 generation/docs separation regressions passed');
});
