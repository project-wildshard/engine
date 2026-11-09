// oxlint-disable-next-line import/no-nodejs-modules -- Read the script without invoking its root entry.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative test files, never privileged paths.
import { resolve, join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated checks use fake commands and never need root.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const source = readFileSync(process.env['WS_SETUP_SCRIPT'] ?? 'scripts/vps/setup.sh', 'utf8');
function definition(name: string): string {
  const start = source.indexOf(`${name}() {`);
  if (start === -1) throw new Error(`Missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('listener checks positively allow loopback and the intended tailnet endpoint', () => {
  const check = (endpoint: string, failure = false): number | null => spawnSync('bash', ['-c', `PROD_PORT=8790 STAGING_PORT=8791; ss() { ${failure ? 'return 1' : `printf 'LISTEN 0 128 %s *:*\\n' '${endpoint}'`}; }; tailscale() { if [ "$2" = -4 ]; then printf '100.64.0.1'; else printf 'fd7a:115c:a1e0::1'; fi; }; ${definition('check_listeners')}\ncheck_listeners`]).status;
  for (const endpoint of ['0.0.0.0:5432', '[::]:5432', '203.0.113.10:5432', '[2001:db8::10]:8790', '100.64.0.1:5432', '127.0.0.1:5432', '*:8791']) expect(check(endpoint), endpoint).not.toBe(0);
  for (const endpoint of ['127.0.0.1:8790', '[::1]:8791', '100.64.0.1:8790', '[fd7a:115c:a1e0::1]:8790', '0.0.0.0:22']) expect(check(endpoint), endpoint).toBe(0);
  expect(check('127.0.0.1:8790', true)).not.toBe(0);
});

test('actual VPS ss device-scoped rows match every tailnet address and reject foreign zones', () => {
  const listeners = readFileSync('test/fixtures/vps-ss-2026-11-09.txt', 'utf8');
  const check = (rows: string): number | null => spawnSync('bash', ['-c', `PROD_PORT=8790 STAGING_PORT=8791; ss() { cat; }; tailscale() { if [ "$2" = -4 ]; then printf '100.64.0.1\\n100.86.54.106\\n'; else printf 'fd7a:115c:a1e0::1\\nfd7a:115c:a1e0::1a01:36d9\\n'; fi; }; ${definition('check_listeners')}\ncheck_listeners`], { input: rows }).status;
  expect(check(listeners)).toBe(0);
  expect(check(listeners.replaceAll('%tailscale0', '%eth0'))).not.toBe(0);
  expect(check(listeners.replace('[fd7a:115c:a1e0::1a01:36d9]%tailscale0:8790', '[fd7a:115c:a1e0::1a01:36d9%tailscale0]:8790'))).toBe(0);
  for (const endpoint of ['[::]%tailscale0:8790', '203.0.113.10%tailscale0:8790', '100.86.54.106%tailscale0:5432']) {
    expect(check(`LISTEN 0 4096 ${endpoint} *:*\n`), endpoint).not.toBe(0);
  }
});

test('an unchanged file in check mode still reports unsafe metadata', () => {
  const checked = spawnSync('bash', ['-c', `CHECK=1; say() { printf '%s %s\\n' "$1" "$2"; }; stat() { printf '644 root:root\\n'; }; cat() { printf 'same\\n'; }; ${definition('metadata_ok')}\n${definition('repair_metadata')}\n${definition('put')}\nput /dev/null 600 root:root <<<'same'\n:`], { encoding: 'utf8' });
  expect(checked.stdout).toContain('would repair metadata /dev/null');
});

test('an interrupted postgres restart is reconciled when files are unchanged', () => {
  const bringUp = source.slice(source.indexOf('# --- Bring it up'), source.indexOf('systemctl enable --now wildshard-tunnel'));
  const checked = spawnSync('bash', ['-c', `set -e; PG_CHANGED=0 PG_VERSION=16; LIVE='*'; say() { :; }; pg() { case "$1" in *listen_addresses*) printf '%s' "$LIVE";; *) printf f;; esac; }; systemctl() { printf '%s\\n' "$*"; case "$1" in restart) LIVE='';; esac; }; check_listeners() { return 0; }; ${bringUp}`], { encoding: 'utf8' });
  expect(checked.status).toBe(0); expect(checked.stdout).toContain('restart postgresql@16-main');
});

test('preflight checks the exact service runtime instead of PATH node', () => {
  const start = source.indexOf('if ! "$NODE" --version');
  expect(start).toBeGreaterThan(0);
  const preflight = source.slice(start, source.indexOf('# --- Tailscale'));
  const checked = spawnSync('bash', ['-c', `NODE=/no/such/service/node; node() { printf 'v24.0.0\\n'; }; say() { :; }; ${preflight}`]);
  expect(checked.status).not.toBe(0);
});

test('a restart that leaves PostgreSQL exposed stops before the tunnel', () => {
  const bringUp = source.slice(source.indexOf('# --- Bring it up'), source.indexOf('systemctl enable --now wildshard-tunnel'));
  const checked = spawnSync('bash', ['-c', `set -e; PG_CHANGED=1 PG_VERSION=16; say() { :; }; pg() { case "$1" in *listen_addresses*) printf '*';; *) printf f;; esac; }; systemctl() { :; }; check_listeners() { return 0; }; ${bringUp}\nprintf 'tunnel-started'`], { encoding: 'utf8' });
  expect(checked.status).not.toBe(0); expect(checked.stdout).not.toContain('tunnel-started');
});

test('existing settings retain their values but still request metadata repair', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/setup-env-'));
  try {
    writeFileSync(join(root, 'production.env'), 'filled-in-settings');
    const checked = spawnSync('bash', ['-c', `ETC=$1 CHECK=1; say() { :; }; repair_metadata() { printf 'metadata %s %s %s\n' "$1" "$2" "$3"; }; ${definition('env_file')}\nenv_file production 8790 4 32`, 'setup-env', root], { encoding: 'utf8' });
    expect(checked.status).toBe(0); expect(checked.stdout).toContain(`metadata ${root}/production.env 640 root:wildshard`);
    expect(readFileSync(join(root, 'production.env'), 'utf8')).toBe('filled-in-settings');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failure to publish settings preserves the complete previous file', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/setup-atomic-')), file = join(root, 'settings');
  writeFileSync(file, 'previous'); chmodSync(file, 0o600); chmodSync(root, 0o500);
  try {
    const checked = spawnSync('bash', ['-c', `CHECK=0; say() { :; }; repair_metadata() { :; }; chown() { :; }; ${definition('put')}\nif put "$1/settings" 600 root:root <<<'replacement'; then :; fi`, 'setup-put', root], { encoding: 'utf8' });
    expect(checked.status).not.toBe(0); expect(readFileSync(file, 'utf8')).toBe('previous');
  } finally { chmodSync(root, 0o700); rmSync(root, { recursive: true, force: true }); }
});

test('service units and health stub execute the exact checked runtime', () => {
  const units = source.slice(source.indexOf('# --- Units'), source.indexOf('if [ "$CHECK" = 1 ]; then\n  say check'));
  const stub = source.split('\n').find(line => line.includes('systemd-run --quiet --unit=wildshard-health-stub'));
  if (stub === undefined) throw new Error('Missing stub');
  const checked = spawnSync('bash', ['-c', `NODE=/proof/checked-node HOME_DIR=/data LIB=/lib ETC=/etc/example PROD_PORT=8790; unit() { cat; }; systemd-run() { printf '%s\n' "$@"; }; ${units}\n${stub}`], { encoding: 'utf8' });
  expect(checked.status).toBe(0);
  expect(checked.stdout).toContain('ExecStartPre=/proof/checked-node /lib/pull.mjs');
  expect(checked.stdout).toContain('ExecStart=/proof/checked-node /data/%i/current/main.mjs');
  expect(checked.stdout).not.toContain('/usr/bin/node'); expect(checked.stdout).toContain('\n/proof/checked-node\n-e\n');
});
