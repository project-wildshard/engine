// oxlint-disable-next-line import/no-nodejs-modules -- An installed engine is files under node_modules and a fresh Node.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Lays out the installed copy.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

// Mini QA 2026-11-16 row 41 (NB18): a shard repo cooking with the npm engine died in the 6x6 encoder's flush. Its worker
// threads import astc6Wasm.ts, Node strips types under node_modules only through scripts/format-hook.mjs, and module
// hooks are per thread, so every worker refused with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.

test('the cook\'s ASTC 6x6 flush runs its worker lanes from an installed engine', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/cook-astc6-installed-'));
  try {
    const engine = join(root, 'node_modules/@wildshard/engine');
    mkdirSync(join(engine, 'src/cook/game'), { recursive: true });
    mkdirSync(join(engine, 'scripts/vendor'), { recursive: true });
    cpSync('src/cook/game/astc6Wasm.ts', join(engine, 'src/cook/game/astc6Wasm.ts'));
    cpSync('scripts/format-hook.mjs', join(engine, 'scripts/format-hook.mjs'));
    symlinkSync(resolve('scripts/vendor/basisu'), join(engine, 'scripts/vendor/basisu'), 'dir');
    // What a shard repo's cook does: the hook on its own thread, then the engine's encoder, one lane, one input.
    writeFileSync(join(root, 'cook.mjs'), [
      "const {wasmAstc6} = await import('./node_modules/@wildshard/engine/src/cook/game/astc6Wasm.ts');",
      'const astc6 = await wasmAstc6({lanes: 1});',
      "astc6.record(new Uint8Array([1, 2, 3, 4]), 'albedo');",
      "await astc6.flush();",
      "console.log('flushed');",
    ].join('\n'));
    const run = spawnSync(process.execPath, ['--import', './node_modules/@wildshard/engine/scripts/format-hook.mjs', 'cook.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    expect(run.stderr).not.toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
    expect(run.stdout.trim(), run.stderr).toBe('flushed');
    expect(run.status).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 90_000);

// QA41's remaining package boundary: npm packs the real candidate and installs it with its declared dependencies.
// The full cook uses a valid UASTC master and the default tiers, so an invalid input cannot hide encoder failures.
test('a freshly installed engine tarball completes a full ASTC phone cook', () => {
  mkdirSync('tmp/codex-shards', { recursive: true });
  const root = mkdtempSync(resolve('tmp/codex-shards/cook-package-'));
  const run = (command: string, args: string[], cwd: string) => spawnSync(command, args, {
    cwd, env: { ...process.env, COOK_CPU_SLOTS: '2' }, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
  });
  try {
    const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd());
    expect(packed.status, packed.stderr).toBe(0);
    const rows = JSON.parse(packed.stdout) as {filename: string}[];
    const archive = rows[0]?.filename;
    if (archive === undefined) throw new Error('npm pack returned no archive');
    const project = join(root, 'project'); mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'installed-cook-proof', private: true, type: 'module', dependencies: { '@wildshard/engine': `file:../${archive}` } }));
    const installed = run('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false'], project);
    expect(installed.status, installed.stderr).toBe(0);
    cpSync('test/fixtures/installedCook.mjs', join(project, 'proof.mjs'));
    const worker = join(project, 'node_modules/@wildshard/engine/src/cook/game/astc6Wasm.ts');
    const fixed = readFileSync(worker, 'utf8');
    const old = fixed.replace('import(workerData.hook).then(() => import(workerData.module))', 'import(workerData.module)');
    expect(old).not.toBe(fixed);
    const args = ['--import', './node_modules/@wildshard/engine/scripts/bake-loader.mjs', 'proof.mjs'];
    // Only this owned installed fixture loses the hook. Reproduce the exact pre-fix failure, then heal it.
    writeFileSync(worker, old);
    const broken = run(process.execPath, args, project);
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING');
    writeFileSync(worker, fixed);
    const cooked = run(process.execPath, args, project);
    expect(cooked.status, cooked.stderr).toBe(0);
    expect(JSON.parse(cooked.stdout)).toMatchObject({ slug: 'installed-cook', manifests: 4, phoneEncoded: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
