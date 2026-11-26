import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual installed-package loader in a child runtime.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the disposable installed packages.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the disposable package and committed loader paths.
import { resolve, join } from 'node:path';

test('installed own TypeScript keeps enums and parameter properties while foreign packages stay refused', () => {
  const parent = resolve('tmp/codex-ms-release');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'format-runtime-'));
  const hook = resolve('src/scripts/format-hook.mjs');
  try {
    const own = join(root, 'node_modules/@wildshard/runtime-fixture');
    const foreign = join(root, 'node_modules/foreign-runtime-fixture');
    mkdirSync(own, { recursive: true });mkdirSync(foreign, { recursive: true });
    writeFileSync(join(own, 'package.json'), JSON.stringify({ type: 'module', exports: './index.ts' }));
    writeFileSync(join(own, 'index.ts'), 'enum Value { First = 7 } export class Probe { constructor(public readonly value: number = Value.First) {} } export const typed: number = 11;');
    writeFileSync(join(foreign, 'package.json'), JSON.stringify({ type: 'module', exports: './index.ts' }));
    writeFileSync(join(foreign, 'index.ts'), 'export const foreign: number = 3;');
    const runtime = process.env['WS_FORMAT_NODE'] ?? process.execPath;
    const imported = spawnSync(runtime, ['--import', hook, '--input-type=module', '-e', "import {Probe,typed} from '@wildshard/runtime-fixture'; console.log(JSON.stringify([new Probe().value,typed]));"], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    expect(imported.status, imported.stderr).toBe(0);expect(JSON.parse(imported.stdout.trim())).toEqual([7, 11]);
    // Meta QA 11-25 row 95: a file plain stripping takes never pays for the TypeScript compiler (on Node 26 it cost each
    // sim thread about 500 ms, and the tape-worker tests passed their fence); only an enum or parameter property does.
    writeFileSync(join(own, 'plain.ts'), 'export const plain: number = 5;');
    writeFileSync(join(own, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.ts', './plain': './plain.ts' } }));
    const plain = spawnSync(runtime, ['--import', hook, '--input-type=module', '-e', "import {plain} from '@wildshard/runtime-fixture/plain'; import {createRequire} from 'node:module'; const cache=createRequire(import.meta.url).cache; console.log(JSON.stringify([plain, Object.keys(cache).some(path => /typescript/u.test(path))]));"], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    expect(plain.status, plain.stderr).toBe(0);expect(JSON.parse(plain.stdout.trim())).toEqual([5, false]);
    const refused = spawnSync(runtime, ['--import', hook, '--input-type=module', '-e', "import 'foreign-runtime-fixture';"], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    expect(refused.status).not.toBe(0);expect(refused.stderr).toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
