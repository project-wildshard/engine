import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

import { KEYCHAIN_ARGS } from '../../../scripts/chromium-keychain.mjs'

const E2E_PORT = Number(process.env['WS_T1_PORT'])
if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1) {
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
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: { args: [...KEYCHAIN_ARGS, '--mute-audio'] },
  },
  webServer: {
    command: `node scripts/preview-server.mjs --port ${String(E2E_PORT)} --outDir "${process.env['WS_T1_BUILD_DIR'] ?? 'dist'}" --telemetry-dir tmp/${process.env['WS_LANE_NAME'] ?? 't1-e2e'}/t1/telemetry`,
    cwd: process.cwd(),
    url: `${BASE_URL}/version.json`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
