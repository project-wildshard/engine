import { expect } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Collection regressions run a bounded isolated real-GC Vitest child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The child configuration lives only in owned repository scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the exact fixture and installed runner without a shell.
import { resolve } from 'node:path';

/** The isolated child's budget: a cold Vitest start, transform and one test. It runs in 7.7 s alone on the
 * MacBook and passed 20 s on a loaded hosted runner (engine run 45452091364, tests 8). It is the parent's 30 s
 * `testTimeout` less 3 s for the parent's own setup and cleanup, so a slow child still fails as its own
 * ETIMEDOUT inside the parent test (test/real-gc-budget.test.ts holds that order). */
export const REAL_GC_CHILD_MS = 27_000;

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
        env: { ...process.env, WS_RETIRED_SCOPE_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: REAL_GC_CHILD_MS,
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
