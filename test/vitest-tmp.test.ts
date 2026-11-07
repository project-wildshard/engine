import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real workers must inherit the scoped run directory and clean it on exit.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture files and fake system temp paths belong to one checkout scratch directory.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed runner and the exact owned fixture roots.
import { resolve } from 'node:path';

test.each(['forks', 'threads'] as const)('%s workers keep every temp file inside the run and remove it at exit', pool => {
  const root = mkdtempSync(resolve('tmp/vitest-tmp-')), system = resolve(root, 'system'), scoped = resolve(root, 'scoped');
  const report = resolve(root, 'worker.json'), closed = resolve(root, 'closed.json'), config = resolve(root, 'vitest.config.mjs');
  mkdirSync(system); mkdirSync(scoped);
  try {
    writeFileSync(config, `import {vitestTmpRoot} from ${JSON.stringify(resolve('scripts/vitest-tmp.ts'))};
import {existsSync,writeFileSync} from 'node:fs';
export default {root:${JSON.stringify(root)},plugins:[vitestTmpRoot(),{name:'observe-close',configureVitest({vitest}){
vitest.onClose(()=>writeFileSync(${JSON.stringify(closed)},JSON.stringify({exists:existsSync(process.env.WS_VITEST_TMP_DIR),temp:process.env.TMPDIR,compile:process.env.NODE_COMPILE_CACHE})));}}],test:{include:['sample.test.ts'],setupFiles:[],pool:${JSON.stringify(pool)},maxWorkers:1}};`);
    writeFileSync(resolve(root, 'sample.test.ts'), `import {test,expect} from 'vitest';
import {tmpdir} from 'node:os';import {mkdtempSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
test('worker owns its temp files',()=>{const run=process.env.WS_VITEST_TMP_DIR;
writeFileSync(${JSON.stringify(report)},JSON.stringify({run,temp:tmpdir(),compile:process.env.NODE_COMPILE_CACHE}));
expect(tmpdir()).toBe(run);const child=mkdtempSync(join(tmpdir(),'worker-'));writeFileSync(join(child,'payload'),'owned');});`);
    const child = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, TMPDIR: system, NODE_COMPILE_CACHE: resolve(root, 'compile'), VITEST_TMP_ROOT: scoped },
    });
    expect(child.status, child.stdout + child.stderr).toBe(0);
    const observed: unknown = JSON.parse(readFileSync(report, 'utf8'));
    if (typeof observed !== 'object' || observed === null || !('run' in observed) || typeof observed.run !== 'string') throw new Error('Missing worker run directory');
    expect(Object.keys(observed).sort()).toEqual(['compile', 'run', 'temp']);
    expect(observed.run.startsWith(`${scoped}/`)).toBe(true);
    expect(observed.run.slice(scoped.length + 1)).toMatch(/^[0-9]+$/u);
    expect(observed).toMatchObject({ temp: observed.run, compile: resolve(observed.run, 'node-compile-cache') });
    expect(existsSync(observed.run)).toBe(false);
    const atClose: unknown = JSON.parse(readFileSync(closed, 'utf8'));
    expect(atClose).toEqual({ exists: false, temp: system, compile: resolve(root, 'compile') });
    expect(readdirSync(scoped)).toEqual([]);
    expect(readdirSync(system)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each(['forks', 'threads'] as const)('%s standalone configs are contained before config loading', pool => {
  const root = mkdtempSync(resolve('tmp/vitest-standalone-'));
  const system = resolve(root, 'system'), scoped = resolve(root, 'scoped');
  const config = resolve(root, 'vitest.config.mjs'), report = resolve(root, 'worker.json');
  mkdirSync(system); mkdirSync(scoped);
  writeFileSync(resolve(system, 'foreign'), 'keep');
  try {
    // These configs intentionally do not import the root config or its temp plugin.
    writeFileSync(config, `export default {root:${JSON.stringify(root)},test:{include:['sample.test.ts'],setupFiles:[],pool:${JSON.stringify(pool)},maxWorkers:1}};`);
    writeFileSync(resolve(root, 'sample.test.ts'), `import {test,expect} from 'vitest';
import {tmpdir} from 'node:os';import {mkdtempSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
test('original verdict',()=>{const run=process.env.WS_VITEST_TMP_DIR;
const child=mkdtempSync(join(tmpdir(),'worker-'));writeFileSync(join(child,'payload'),'owned');
writeFileSync(${JSON.stringify(report)},JSON.stringify({run,temp:tmpdir()}));
expect(process.env.EXPECT_REFUSAL).toBe('0');});`);
    const run = (refused: boolean) => spawnSync(process.execPath, [resolve('scripts/vitest-tmp.ts'), 'run', 'sample.test.ts', '--config', config], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, TMPDIR: system, NODE_COMPILE_CACHE: resolve(root, 'compile'), VITEST_TMP_ROOT: scoped, EXPECT_REFUSAL: refused ? '1' : '0' },
    });
    for (const refused of [false, true]) {
      const child = run(refused);
      expect(child.status, child.stdout + child.stderr).toBe(refused ? 1 : 0);
      const observed: unknown = JSON.parse(readFileSync(report, 'utf8'));
      if (typeof observed !== 'object' || observed === null || !('run' in observed) || typeof observed.run !== 'string') throw new Error('Missing standalone run directory');
      expect(observed.run.startsWith(`${scoped}/`)).toBe(true);
      expect(observed).toEqual({ run: observed.run, temp: observed.run });
      expect(existsSync(observed.run)).toBe(false);
      expect(readdirSync(scoped)).toEqual([]);
      expect(readdirSync(system)).toEqual(['foreign']);
      expect(readFileSync(resolve(system, 'foreign'), 'utf8')).toBe('keep');
    }
    writeFileSync(config, "throw new Error('original config refusal');");
    const early = run(false);
    expect(early.status).toBe(1);
    expect(early.stdout + early.stderr).toContain('original config refusal');
    expect(readdirSync(scoped)).toEqual([]);
    expect(readdirSync(system)).toEqual(['foreign']);
    const unleased = spawnSync(process.execPath, [resolve('scripts/vitest-tmp.ts'), 'run', '--config', config], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, TMPDIR: system, VITEST_TMP_ROOT: scoped, WS_HEAVY_ROOT: resolve(root, 'no-lease') },
    });
    expect(unleased.status).toBe(1);
    expect(unleased.stdout + unleased.stderr).toContain('heavy-lane.py full-test');
    expect(unleased.stdout + unleased.stderr).not.toContain('original config refusal');
    expect(readdirSync(scoped)).toEqual([]);
    expect(readdirSync(system)).toEqual(['foreign']);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
