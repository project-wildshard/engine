// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real oxlint entry point on a shard fixture.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own a bounded fixture under the repository scratch root.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only fixture and checker paths.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';

// SF4 (meta standalone-shardfiles): a zone's art lives under `/assets/<its slug>/`, so the shard sandbox owns that folder
// for its shard even when lint/shard-words.pin.json does not list it yet; another zone's folder stays refused.
const Output = v.object({ diagnostics: v.array(v.object({ code: v.string(), message: v.string(),
  labels: v.array(v.object({ span: v.object({ line: v.number() }) })) })) });

test("a shard owns /assets/<its slug>/ and not another zone's folder", () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/zone-folder-lint-')), config = resolve(root, 'lint.json');
  const file = resolve(root, 'src/shards/sample-isle/data/urls.ts');
  try {
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, [
      "export const own = '/assets/sample-isle/models/hut/hut.glb';",
      "export const other = '/assets/driftwood-isle/models/hut/hut.glb';",
      '',
    ].join('\n'));
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' },
      rules: { 'wildshard/shard-sandbox': 'error' } }));
    const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json', '--no-ignore', file],
      { encoding: 'utf8', env: { ...process.env, WILDSHARD_RATCHET_FILE: resolve(root, 'no-ratchet.json') } });
    const lines = v.parse(Output, JSON.parse(result.stdout)).diagnostics
      .filter(row => row.message.includes('asset path')).map(row => row.labels[0]?.span.line);
    expect(lines).toEqual([2]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
