// oxlint-disable-next-line import/no-nodejs-modules -- Execute the maintained Actions shell with an isolated fake installer.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own each fixture and inspect its install receipt.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only job-owned fixture paths.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import workflow from '../.github/workflows/deploy.yml?raw';

const journeys = workflow.split('\n  journeys:\n')[1]?.split(/\n {2}[a-z][a-z0-9-]*:\n/u)[0] ?? '';
const installStep = journeys.split('      - name: Install exact dependencies from a fresh store\n')[1]?.split('\n      - ')[0];
const install = installStep?.split('        run: |\n')[1]?.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');

function execute(exit: number, attempts = 1, temporary = true) {
  if (install === undefined) throw new Error('Missing actual isolated journey install');
  const directory = resolve(mkdtempSync('tmp/journey-install-'));
  try {
    const bin = resolve(directory, 'bin'), runner = resolve(directory, 'runner temp'), store = resolve(directory, 'poisoned-store');
    mkdirSync(bin); mkdirSync(runner); mkdirSync(store);
    writeFileSync(resolve(store, 'package.json'), '\0'.repeat(64));
    writeFileSync(resolve(bin, 'pnpm'), `#!/bin/sh
printf '%s\\n' "$@" >> "$INSTALL_RECEIPT"
printf 'CALL\\n' >> "$INSTALL_RECEIPT"
exit "$INSTALL_EXIT"
`, { mode: 0o755 });
    const receipt = resolve(directory, 'receipt');
    const statuses: (number | null)[] = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', install], {
        cwd: directory, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, RUNNER_TEMP: temporary ? runner : '',
          npm_config_store_dir: store, INSTALL_EXIT: String(exit), INSTALL_RECEIPT: receipt },
      });
      expect(result.error).toBeUndefined();
      statuses.push(result.status);
    }
    return { statuses, runner, directories: readdirSync(runner),
      receipt: existsSync(receipt) ? readFileSync(receipt, 'utf8') : '',
      poisoned: readFileSync(resolve(store, 'package.json'), 'utf8') };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('the actual SIX install bypasses a poisoned default store with a unique job-local copy store', () => {
  const result = execute(0, 2);
  expect(result.statuses).toEqual([0, 0]);
  expect(result.poisoned).toBe('\0'.repeat(64));
  expect(result.directories).toHaveLength(2);
  const calls = result.receipt.trim().split('\nCALL').filter(value => value.trim() !== '');
  expect(calls).toHaveLength(2);
  const stores: string[] = [];
  for (const call of calls) {
    const args = call.trim().split('\n');
    expect(args.slice(0, 5)).toEqual(['install', '--frozen-lockfile', '--package-import-method=copy', '--verify-store-integrity', '--store-dir']);
    expect(args).toHaveLength(6);
    stores.push(args[5] ?? 'missing');
  }
  expect(new Set(stores)).toEqual(new Set(result.directories.map(name => resolve(result.runner, name))));
});

test('a native install failure propagates once without a retry or fallback', () => {
  for (const exit of [1, 23, 75]) {
    const result = execute(exit);
    expect(result.statuses).toEqual([exit]);
    expect(result.receipt.match(/^CALL$/gmu)).toHaveLength(1);
  }
});

test('missing job temporary storage fails before invoking the installer', () => {
  const result = execute(0, 1, false);
  expect(result.statuses[0]).not.toBe(0);
  expect(result.receipt).toBe('');
});

test('only dependency storage changes while source, browser cache and all SIX gates remain', () => {
  const before = journeys.split('      - name: Install exact dependencies from a fresh store')[0] ?? '';
  expect(before).toContain('clean: true');
  expect(before).toContain(`ref: \${{ github.sha }}`);
  expect(before).not.toContain('cache: pnpm');
  expect(before).not.toContain('actions/cache');
  expect(journeys).toContain('path: ~/Library/Caches/ms-playwright');
  expect(journeys).toContain('pnpm exec playwright install chromium webkit');
  expect(journeys).toContain('timeout-minutes: 20');
  expect(journeys).toContain('max-parallel: 4');
  expect(journeys).toContain('needs: prepare');
  expect(journeys).toContain('name: Verify the exact push manifest');
  expect(journeys).toContain(`run-id: \${{ github.run_id }}`);
});
