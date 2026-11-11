import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vitest/config';
import {PUSH_PROFILE} from './push-budget.mjs';
import type {startCpuBroker} from './cpu-broker.mjs';
import { temporaryRun as sharedRun, viteTmpRoot } from './vite-tmp.mjs';

/** Engine's janitor: repo-kit's shared sweeps plus engine's own test scratch. */
const janitor = fileURLToPath(new URL('temp-janitor.mjs', import.meta.url));

/**
 * Keep Vitest's module cache out of $TMPDIR (docs/process/MACHINE.md "Disk and boot").
 *
 * Vitest 5.0.1 writes every SSR-transformed module to `join(os.tmpdir(), nanoid())`, about 2,700 files a run, and
 * macOS empties $TMPDIR at boot before login. The redirect is repo-kit's shared plugin, copied byte for byte to
 * scripts/vite-tmp.mjs: TMPDIR and NODE_COMPILE_CACHE point at `./tmp/vitest/<pid>` (or `$VITEST_TMP_ROOT/<pid>`)
 * from config load until Vitest closes, with exit cleanup as a fallback (meta docs/plans/TEMP-HYGIENE-PLAN.md).
 */
function temporaryRun(env: NodeJS.ProcessEnv): { dir: string; cleanup: () => void } {
  return sharedRun(env, { janitor });
}

export function vitestTmpRoot(): Plugin {
  return viteTmpRoot({ janitor });
}

/** Scope the CLI before loading any config, including standalone configs without the root plugin. */
export async function runVitest(args: readonly string[]): Promise<number> {
  const run = temporaryRun(process.env);
  let broker: Awaited<ReturnType<typeof startCpuBroker>> | undefined;
  try {
    const { assertVitestLane,isFullVitest } = await import('./vitest-lane.ts');
    assertVitestLane(args);
    const {WS_PUSH_GATE_PROFILE:profile,WS_CPU_ADMISSION:admission}=process.env;
    if(profile===PUSH_PROFILE&&admission==='1'){
      const {assertHeavyLease}=await import('./heavy-lane-lease.mjs');
      assertHeavyLease('full-test');
      const {startCpuBroker}=await import('./cpu-broker.mjs');
      broker=await startCpuBroker();
    }
    // Each real file now owns CPU admission before collection. Performance and
    // uncapped encoder files reserve the whole budget, so their original clocks
    // remain alone while other native/ordinary work can share the available cores.
    const phases=profile===PUSH_PROFILE&&isFullVitest(args)&&!args.some(arg=>arg==='--config'||arg.startsWith('--config=')||arg.startsWith('--shard'))?['admitted']:[undefined];
    for(const phase of phases){
    const entry = fileURLToPath(new URL('vitest.mjs', import.meta.resolve('vitest/package.json')));
    const child = spawn(process.execPath, [entry, ...args,...(phase===undefined?[]:['--config','scripts/push-vitest.config.ts'])], {
      stdio: 'inherit', env: { ...process.env, VITEST_TMP_ROOT: run.dir,...(broker===undefined?{}:{WS_CPU_BROKER:broker.environment}),...(phase===undefined?{}:{WS_PUSH_TEST_PHASE:phase,WS_CPU_ADMISSION:'1'}) },
    });
    let brokerFailed=false;
    void (async()=>{try{await broker?.lost;}catch(error){brokerFailed=true;console.error(error);child.kill('SIGTERM');}})();
    const interrupt = (): void => { child.kill('SIGINT'); };
    const terminate = (): void => { child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      const code=await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (status, signal) => resolve(status ?? (signal === null ? 1 : 128 + constants.signals[signal])));
      });
      if(code!==0||brokerFailed)return code===0?1:code;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
    }
    return 0;
  } finally {
    try { await broker?.close(); }
    finally { run.cleanup(); }
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
