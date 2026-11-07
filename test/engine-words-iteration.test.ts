// oxlint-disable-next-line import/no-nodejs-modules -- Invoke the real policy on an owned tiny fixture.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Create and remove only this fixture.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the policy independently of the fixture cwd.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';

test('engine vocabulary reports every repeated token across intervening ordinary text', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/engine-words-'));
  try {
    const file = resolve(root, 'src/engine/probe.ts'), config = resolve(root, 'policy.json');
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, 'export const ordinary = ["shard shard", "ordinary text", "shard"];');
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')],
      categories: { correctness: 'off' }, rules: { 'wildshard/engine-words': 'error' } }));
    const result = spawnSync(resolve('node_modules/.bin/oxlint'), ['--config', config, '--no-ignore', '--format', 'json', file], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(1);
    const output = v.parse(v.object({ diagnostics: v.array(v.object({ message: v.string() })) }), JSON.parse(result.stdout));
    expect(output.diagnostics.map(row => row.message)).toEqual(Array.from({ length: 3 }, () => 'Engine contains Wildshard word: shard'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
