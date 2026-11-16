// oxlint-disable-next-line import/no-nodejs-modules -- An installed engine is files under node_modules and a fresh Node.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Lays out the installed copy.
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
