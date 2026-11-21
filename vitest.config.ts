import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { rapierAlias } from './vite/rapier';
import { assertVitestLane, vitestMaxWorkers, vitestNodeExecArgv } from './scripts/vitest-lane';
import { viteTmpRoot } from './scripts/vite-tmp.mjs';
import { vitestModuleCache } from './scripts/vitest-module-cache';
import { setPriority } from 'node:os';
import { resolve } from 'node:path';
import { activeQuarantineFiles } from './scripts/test-quarantine.mjs';
import { withTestEnvironments } from './scripts/vitest-environments';
import { NATIVE_CONTENTION_SUITES } from './scripts/vitest-ci-files.ts';
import { WORKTREE_GLOB, worktreeWatchIgnored } from './scripts/worktree-ignore.mjs';

assertVitestLane();
const maxWorkers = vitestMaxWorkers();
const { CI: ci, GITHUB_ACTIONS: githubActions, WS_PUSH_GATE_PROFILE: pushProfile, WS_TEST_QUARANTINE: quarantine } = process.env;
const { WS_NIGHTLY_TEST_PHASE: nightlyPhase } = process.env;
// CI-JOB-PACKING: every packed job of one run judges quarantine at the run's start (WS_CI_EXCLUSION_AT),
// so shares that start minutes apart still plan the same suite and no file falls between them.
const exclusionAt = /^\d{13}$/u.test(process.env.WS_CI_EXCLUSION_AT ?? '') ? Number(process.env.WS_CI_EXCLUSION_AT) : Date.now();
const quarantined = (ci || githubActions) && quarantine === 'blocking' ? activeQuarantineFiles(exclusionAt) : [];
// BUILD-SPEED 1.2: lane test runs yield CPU to the measurement lane and the Simulator; workers inherit the nice value.
if (!ci && !githubActions && pushProfile !== 'full-v1') setPriority(10);
export default defineConfig(withTestEnvironments({
  define: { __TITLE_ASSET_URLS__: readFileSync('scripts/title-assets.generated.json', 'utf8') },
  plugins: [viteTmpRoot({ janitor: resolve('scripts/temp-janitor.mjs') }), vitestModuleCache()],
  resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
  // DS11: watch mode never follows the plan worktrees under .worktrees/; include globs are root-anchored, exclude is belt and braces
  server: { watch: { ignored: worktreeWatchIgnored() } },
  // Reuse transformed code in CI; each test still executes in its isolated worker.
  test: { execArgv: [...vitestNodeExecArgv(), '--import', resolve('scripts/format-hook.mjs')], fsModuleCache: true, ...(maxWorkers === undefined ? {} : { maxWorkers }), testTimeout: 30_000, environment: 'node',
    // Native product/hash readers own filesystem URLs, even in DOM suites.
    // Vite's browser query injection must not rewrite the hash CLI's hashbang.
    // Format ships raw .ts from the shardfile repo (J42): Vite transforms it, because Node will not under node_modules.
    server: { deps: { external: [/\/scripts\/(?:built-folder|bake-input-hashes)\.mjs$/u], inline: [/@wildshard\/format/u] } },
    include: nightlyPhase === 'serial' ? [...NATIVE_CONTENTION_SUITES] : ['src/{client,shared,server,cook}/{engine,game,host}/**/*.test.ts', 'src/client/app/**/*.test.ts', 'src/test/{engine,game}/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs', ...['test/e7-owned-effects.proof.ts', 'test/roster-owners.proof.ts', 'test/dedicated-critical-reconnect.proof.ts', 'test/net-hover-admission.proof.ts', 'test/dedicated-crossing-churn.proof.ts'].filter(path => process.argv.includes(path))],
    exclude: ['**/node_modules/**', WORKTREE_GLOB, ...quarantined, ...(nightlyPhase === 'parallel' ? NATIVE_CONTENTION_SUITES : []), ...(process.env.WILDSHARD_RING === '1' ? JSON.parse(readFileSync('test/pins/ring-2-tests.json', 'utf8')) as string[] : [])],
    setupFiles: ['scripts/vitest-cpu.ts','test/setup.ts'], restoreMocks: true },
}));
