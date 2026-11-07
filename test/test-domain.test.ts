// oxlint-disable-next-line import/no-nodejs-modules -- Run the real linter on isolated production and test files.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and clean only the tiny lint fixture.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed CLI and fixture paths explicitly.
import { dirname, resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { TEST_DOMAIN_RUNTIME_RULES } from '../lint/wildshard-plugin.js';

test('colocated fixtures keep product guards in production and architecture guards in tests', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/test-domain-'));
  const put = (path: string, source: string): string => { const file = resolve(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); return file; };
  // The real HTML rule owns a typed source census rooted at the child cwd.
  // Keep that census inside this fixture, rather than the full game checkout.
  put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, types: [], target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' }, include: ['src'] }));
  const config = put('config.json', JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: {
    ...Object.fromEntries(TEST_DOMAIN_RUNTIME_RULES.map(name => [`wildshard/${name}`, 'error'])),
    'wildshard/layer': 'error', 'wildshard/no-module-mock': 'error', 'wildshard/no-production-test-import': 'error', 'wildshard/generator-imports': 'error',
  } }));
  const surfaces = put('surfaces.json', JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: {
    'wildshard/engine-words': 'error', 'wildshard/no-inline-ui-string': 'error', 'wildshard/no-authored-html': 'error',
    'wildshard/no-global-listener-patch': 'error', 'wildshard/no-raw-hud': 'error',
  } }));
  const boundaries = put('boundaries.json', JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: {
    'wildshard/layer': 'error', 'wildshard/no-module-mock': 'error', 'wildshard/no-production-test-import': 'error', 'wildshard/generator-imports': 'error',
  } }));
  const run = (files: readonly string[], selected = config): ReturnType<typeof spawnSync> => spawnSync(resolve('node_modules/.bin/oxlint'),
    ['--threads=1', '--no-ignore', '-c', selected, '-f', 'json', ...files], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  const code = 'const label = "Pine loot"; const node = document.createElement("div"); node.textContent = "Play now"; node.innerHTML = document.title; document.body.appendChild(node); export { label };';
  const rejected: { file: string; rules: readonly string[] }[] = [];
  const refuses = (path: string, source: string, rules: readonly string[]): void => { rejected.push({ file: put(path, source), rules }); };
  try {
    const allowed = run([put('src/engine/core/fixture.test.ts', code), put('src/test/engine/helper.ts', code), put('src/test/game/helper.ts', code), put('src/sharddev/test/helper.ts', code),
      put('src/shards/probe/generators/unit.test.ts', 'import {test} from "vitest"; import {readFile} from "node:fs"; export const fixture = {test,readFile};')]);
    expect(allowed.status, String(allowed.error ?? '') + String(allowed.stdout) + String(allowed.stderr)).toBe(0);
    refuses('src/engine/core/fixture.ts', code, ['engine-words', 'no-inline-ui-string', 'no-authored-html', 'no-global-listener-patch', 'no-raw-hud']);
    refuses('src/sharddev/runtime/fixture.ts', code, ['no-authored-html', 'no-global-listener-patch', 'no-raw-hud']);
    refuses('src/game/runtime/fixture.ts', code, ['no-authored-html', 'no-global-listener-patch', 'no-raw-hud']);
    refuses('src/engine/core/boundary.test.ts', 'import {value} from "../../game/value"; import {vi} from "vitest"; vi.mock("./value"); export {value};', ['layer', 'no-module-mock']);
    refuses('src/sharddev/test/boundary.ts', 'import {value} from "../../shards/probe/value"; import {vi} from "vitest"; vi.mock("./value"); export {value};', ['layer', 'no-module-mock']);
    refuses('src/test/game/boundary.ts', 'import {value} from "../../sdk/value"; import {vi} from "vitest"; vi.mock("./value"); export {value};', ['layer', 'no-module-mock']);
    refuses('src/shards/probe/generators/runner.ts', 'import {test} from "vitest"; export const fixture = test;', ['generator-imports']);
    refuses('src/shards/probe/generators/files.ts', 'import {readFile} from "node:fs"; export const fixture = readFile;', ['generator-imports']);
    refuses('src/shards/probe/generators/cross.test.ts', 'import {value} from "../../other/generators/value"; export {value};', ['layer', 'generator-imports']);
    refuses('src/shards/probe/generators/computed.test.ts', 'export function load(source: string) { return import(source); }', ['generator-imports']);
    refuses('src/shards/probe/generators/computed.ts', 'export function load(source: string) { return import(source); }', ['generator-imports']);
    refuses('src/shards/probe/generators/game.test.ts', 'import {value} from "@wildshard/engine/game/world"; export {value};', ['generator-imports']);
    refuses('src/shards/probe/generators/absolute.test.ts', 'import {value} from "/src/engine/value"; export {value};', ['generator-imports']);
    const statements = ['import "./fixture.test";', 'export * from "./fixture.test.ts";', 'void import("./fixture.test.js");', 'export type Value = typeof import("./fixture.test");',
      'import "../test/helper";', 'export * from "../test/helper";', 'void import("../test/helper");', 'export type Helper = typeof import("../test/helper");'];
    statements.forEach((source, index) => { refuses(`src/engine/core/importer-${index}.ts`, source, ['no-production-test-import']); });
    statements.forEach((source, index) => { refuses(`src/sharddev/runtime/importer-${index}.ts`, source, ['no-production-test-import']); });
    statements.forEach((source, index) => { refuses(`src/game/runtime/importer-${index}.ts`, source, ['no-production-test-import']); });
    for (const layer of ['engine', 'game', 'sdk']) {
      refuses(`src/${layer}/fixture-consumer.ts`, 'import {FakeGame} from "@wildshard/engine/test/FakeGame"; export const value = FakeGame;', ['no-production-test-import']);
      refuses(`src/${layer}/sdk-fixture-consumer.ts`, 'import {helper} from "@wildshard/sharddev/test/helper"; export const value = helper;', ['no-production-test-import']);
      refuses(`src/${layer}/game-fixture-consumer.ts`, 'import {helper} from "@wildshard/engine/game/test/helper"; export const value = helper;', ['no-production-test-import']);
    }
    const production = rejected.slice(0, 3), architecture = rejected.slice(3);
    for (const [rows, selected] of [[production, surfaces], [architecture, boundaries]] as const) {
      const result = run(rows.map(row => row.file), selected);
      expect(result.status, String(result.error ?? '') + String(result.stdout) + String(result.stderr)).toBe(1);
      const output = v.parse(v.object({ diagnostics: v.array(v.object({ filename: v.string(), code: v.string() })) }), JSON.parse(String(result.stdout)));
      for (const row of rows) {
        const codes = output.diagnostics.filter(diagnostic => resolve(root, diagnostic.filename) === row.file).map(diagnostic => diagnostic.code);
        for (const rule of row.rules) expect(codes, row.file).toContain(`wildshard(${rule})`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
