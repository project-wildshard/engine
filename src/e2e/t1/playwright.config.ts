import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { KEYCHAIN_ARGS } from '../../../scripts/chromium-keychain.mjs'
import { T1_SHARDS } from '../../../scripts/t1-shards.mjs'

const E2E_PORT = Number(process.env['WS_T1_PORT'])
if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65_535) {
  throw new Error('Run pnpm test:t1 to allocate a port')
}
const BASE_URL = `http://127.0.0.1:${String(E2E_PORT)}`
export default defineConfig({
  testDir: '.',
  outputDir: path.resolve(
    'tmp',
    process.env['WS_LANE_NAME'] ?? 't1-e2e',
    't1/results',
  ),
  projects: [
    { name: 'A', testMatch: T1_SHARDS.A },
    { name: 'B', testMatch: T1_SHARDS.B },
    { name: 'C', testMatch: T1_SHARDS.C },
    { name: 'D', testMatch: T1_SHARDS.D },
  ],
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        ...KEYCHAIN_ARGS,
        '--mute-audio',
        ...(process.platform === 'darwin'
          ? ['--use-angle=metal', '--ignore-gpu-blocklist']
          : []),
      ],
    },
  },
  webServer:
    process.env['WS_T1_PREVIEW_OWNED'] === '1'
      ? []
      : {
          command: `node scripts/preview-server.mjs --port ${String(E2E_PORT)} --outDir "${process.env['WS_T1_BUILD_DIR'] ?? 'dist'}" --telemetry-dir tmp/${process.env['WS_LANE_NAME'] ?? 't1-e2e'}/t1/telemetry`,
          cwd: process.cwd(),
          url: `${BASE_URL}/version.json`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
})
