import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import { KEYCHAIN_ARGS } from '../../scripts/chromium-keychain.mjs'

import type { PlaywrightTestConfig } from '@playwright/test'

// A port apart from the default 4402, so e2e runs beside a live `engine serve`.
const E2E_PORT = 4502
const BASE_URL = `http://127.0.0.1:${String(E2E_PORT)}`

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  // Beside this config, not in the cwd (the repo root).
  outputDir: fileURLToPath(new URL('test-results', import.meta.url)),
  forbidOnly: process.env['CI'] !== undefined,
  reporter: process.env['CI'] === undefined ? 'list' : 'github',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  // The status page first (0.1 s), then the Template 2 smoke (T2E-2): one worker, one page, headless.
  workers: 1,
  projects: [
    {
      name: 'chromium',
      testMatch: 'status.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: [...KEYCHAIN_ARGS] },
      },
    },
    {
      name: 'template-2',
      testDir: 'smoke',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 402, height: 874 },
        trace: 'retain-on-failure',
        launchOptions: {
          args: [
            ...KEYCHAIN_ARGS,
            '--mute-audio',
            '--ignore-gpu-blocklist',
            // The real GPU on the Mac, SwiftShader on hosted Linux (as ring-1's boot-smoke, scripts/parity/lane-browser.mjs)
            `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm build && node src/cli/main.ts serve --port ${String(E2E_PORT)}`,
    // The package root (the repo root), where package.json lives.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

export default config
