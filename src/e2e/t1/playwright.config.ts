import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { KEYCHAIN_ARGS } from '../../scripts/.kit/chromium-keychain.mjs'
import { T1_SHARDS } from '../../scripts/t1-shards.mjs'

const E2E_PORT = Number(process.env['WS_T1_PORT'])
if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65_535) {
  throw new Error('Run pnpm test:t1 to allocate a port')
}
const BASE_URL = `http://127.0.0.1:${String(E2E_PORT)}`
/** WS_T1_ANGLE=swiftshader replays the hosted runners' software GL on a Mac (their stalls, their boot times). */
function glArgs(): readonly string[] {
  if (process.env['WS_T1_ANGLE'] === 'swiftshader') {
    return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  }
  return process.platform === 'darwin'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : []
}
const explore = process.env['WS_T1_EXPLORE'] === '1'
const suites = explore ? { Explore: /explore\.spec\.ts$/u } : T1_SHARDS
export default defineConfig({
  // Explore builds its own viewer client. The root specs use the shared Template build.
  testDir: explore ? 'explore' : '.',
  outputDir: path.resolve(
    'tmp',
    process.env['WS_LANE_NAME'] ?? 't1-e2e',
    't1/results',
    process.env['WS_T1_SHARD'] ?? 'all',
  ),
  projects: Object.entries(suites).map(
    ([name, testMatch]: readonly [string, Readonly<RegExp>]): {
      name: string
      testMatch: RegExp
    } => ({ name, testMatch }),
  ),
  workers: 1,
  // Per-test lines and durations on CI too (its default dot reporter loses a killed suite's partial line).
  reporter: 'list',
  forbidOnly: process.env['CI'] !== undefined,
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [...KEYCHAIN_ARGS, '--mute-audio', ...glArgs()],
    },
  },
  webServer:
    process.env['WS_T1_PREVIEW_OWNED'] === '1'
      ? []
      : {
          command: `node src/scripts/preview-server.mjs --port ${String(E2E_PORT)} --outDir "${process.env['WS_T1_BUILD_DIR'] ?? 'dist'}" --telemetry-dir tmp/${process.env['WS_LANE_NAME'] ?? 't1-e2e'}/t1/telemetry`,
          cwd: process.cwd(),
          url: `${BASE_URL}/version.json`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
})
