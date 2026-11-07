import { expect } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Collection regressions run a bounded isolated real-GC Vitest child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The child configuration lives only in owned repository scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the exact fixture and installed runner without a shell.
import { resolve } from 'node:path';

/** Never skip a collection assertion when the parent runner lacks --expose-gc. */
export async function realGc(file: string, name: string, proof: (collect: (ref: WeakRef<object>) => Promise<void>) => Promise<void>): Promise<void> {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_RETIRED_SCOPE_GC'] === '1') throw new Error('Collection fixture requires --expose-gc');
    mkdirSync('tmp', { recursive: true });
    const directory = mkdtempSync(resolve('tmp/retired-scope-gc-'));
    try {
      const config = resolve(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolve('.'))},test:{include:[${JSON.stringify(file)}],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', config, '-t', name], {
        env: { ...process.env, WS_RETIRED_SCOPE_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 20_000,
      });
      expect(output).toContain('1 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  await proof(async ref => {
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(_resolve => { setTimeout(_resolve, 0); });
      Reflect.apply(gc, globalThis, []);
      if (ref.deref() === undefined) break;
    }
    expect(ref.deref()).toBeUndefined();
  });
}
