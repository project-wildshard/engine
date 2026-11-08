import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { rapierAlias } from './vite/rapier';
import { assertVitestLane, vitestMaxWorkers, vitestNodeExecArgv } from './scripts/vitest-lane';
import { vitestTmpRoot } from './scripts/vitest-tmp';
import { vitestModuleCache } from './scripts/vitest-module-cache';
import { setPriority } from 'node:os';
import { resolve } from 'node:path';
import { activeQuarantineFiles } from './scripts/test-quarantine.mjs';
import { withTestEnvironments } from './scripts/vitest-environments';
import {PUSH_BUDGET,PUSH_PROFILE} from './scripts/push-budget.mjs';

assertVitestLane();
const maxWorkers = vitestMaxWorkers();
const { CI: ci, GITHUB_ACTIONS: githubActions, WS_PUSH_GATE_PROFILE: pushProfile, WS_TEST_QUARANTINE: quarantine } = process.env;
const quarantined = (ci || githubActions) && quarantine === 'blocking' ? activeQuarantineFiles() : [];
// BUILD-SPEED 1.2: lane test runs yield CPU to the measurement lane and the Simulator; workers inherit the nice value.
if (!ci && !githubActions && pushProfile !== 'full-v1') setPriority(10);
export default defineConfig(withTestEnvironments({
  define: { __TITLE_ASSET_URLS__: readFileSync('scripts/title-assets.generated.json', 'utf8') },
  plugins: [vitestTmpRoot(), vitestModuleCache()],
  resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
  // Reuse transformed code in CI; each test still executes in its isolated worker.
  test: { execArgv: [...vitestNodeExecArgv(), ...(pushProfile===PUSH_PROFILE&&process.env['WS_CPU_ADMISSION']==='1'?[`--v8-pool-size=${PUSH_BUDGET.v8Threads}`]:[]), '--import', resolve('scripts/format-hook.mjs')], fsModuleCache: true, ...(maxWorkers === undefined ? {} : { maxWorkers }), testTimeout: 30_000, environment: 'node',
    // Native product/hash readers own filesystem URLs, even in DOM suites.
    // Vite's browser query injection must not rewrite the hash CLI's hashbang.
    // Format ships raw .ts from the shardfile repo (J42): Vite transforms it, because Node will not under node_modules.
    server: { deps: { external: [/\/scripts\/(?:built-product|bake-input-hashes)\.mjs$/u], inline: [/@wildshard\/format/u] } },
    include: ['src/{client,shared,server,cook}/{engine,game,host}/**/*.test.ts', 'src/client/app/**/*.test.ts', 'src/test/{engine,game}/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
    exclude: ['**/node_modules/**', ...quarantined, ...(existsSync('test/lift-pending.json') ? JSON.parse(readFileSync('test/lift-pending.json', 'utf8')) as string[] : []), ...(process.env.WILDSHARD_RING === '1' ? JSON.parse(readFileSync('test/pins/ring-2-tests.json', 'utf8')) as string[] : [])],
    setupFiles: ['scripts/vitest-cpu.ts','test/setup.ts'], restoreMocks: true },
}));
