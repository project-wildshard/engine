import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vitest/config';

interface VitestTempEnvironment extends NodeJS.ProcessEnv {
  TMPDIR?: string;
  NODE_COMPILE_CACHE?: string;
  VITEST_TMP_ROOT?: string;
  WS_VITEST_TMP_DIR?: string;
}

/**
 * Keep Vitest's module cache out of $TMPDIR (docs/process/MACHINE.md "Disk and boot").
 *
 * Vitest 5.0.1 writes every SSR-transformed module to `join(os.tmpdir(), nanoid())`: once for the run (`Vitest._tmpDir`,
 * never removed) and once per project (`TestProject.tmpDir`, removed only on a clean close). That leaked ~2,700 files
 * into $TMPDIR per run, and macOS empties $TMPDIR at boot before login. Vitest 5 resolves this config before it
 * constructs either object, so pointing TMPDIR at `./tmp/vitest/<pid>` here roots both dirs there. Workers and their
 * children inherit that directory until Vitest closes its worker pool. Then the caller's environment is restored and
 * the whole `<pid>` dir is removed, with exit cleanup as a fallback for an early failure.
 */
function temporaryRun(env: VitestTempEnvironment): { dir: string; cleanup: () => void } {
  const original = env.TMPDIR;
  const originalCompileCache = env.NODE_COMPILE_CACHE;
  const root = env.VITEST_TMP_ROOT ?? fileURLToPath(new URL('../tmp/vitest', import.meta.url));
  const dir = join(root, String(process.pid));
  mkdirSync(dir, { recursive: true });
  env.TMPDIR = dir;
  // Workers import those cache files by their per-run path, so a compile cache would gain an entry per module per run:
  // keep it inside the run's dir too (an inherited NODE_COMPILE_CACHE pointed at $TMPDIR filled it with 284k files).
  const compileCache = join(dir, 'node-compile-cache');
  env.NODE_COMPILE_CACHE = compileCache;
  const cleanup = (): void => {
    rmSync(dir, { recursive: true, force: true });
    if (env.TMPDIR === dir) {
      if (original === undefined) Reflect.deleteProperty(env, 'TMPDIR');
      else env.TMPDIR = original;
    }
    if (env.NODE_COMPILE_CACHE === compileCache) {
      if (originalCompileCache === undefined) Reflect.deleteProperty(env, 'NODE_COMPILE_CACHE');
      else env.NODE_COMPILE_CACHE = originalCompileCache;
    }
  };
  if (env.WS_VITEST_TMP_DIR !== dir) {
    env.WS_VITEST_TMP_DIR = dir;
    process.once('exit', cleanup);
  }
  return { dir, cleanup };
}

export function vitestTmpRoot(env: VitestTempEnvironment = process.env): Plugin {
  const { cleanup } = temporaryRun(env);
  return {
    name: 'wildshard:vitest-tmp-root',
    configureVitest({ vitest }) {
      vitest.onClose(cleanup);
    },
  };
}

/** Scope the CLI before loading any config, including standalone configs without the root plugin. */
export async function runVitest(args: readonly string[]): Promise<number> {
  const run = temporaryRun(process.env);
  try {
    const { assertVitestLane } = await import('./vitest-lane.ts');
    assertVitestLane(args);
    const entry = fileURLToPath(new URL('vitest.mjs', import.meta.resolve('vitest/package.json')));
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: 'inherit', env: { ...process.env, VITEST_TMP_ROOT: run.dir },
    });
    const interrupt = (): void => { child.kill('SIGINT'); };
    const terminate = (): void => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal === null ? 1 : 128 + constants.signals[signal])));
      });
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally {
    run.cleanup();
  }
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await runVitest(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
