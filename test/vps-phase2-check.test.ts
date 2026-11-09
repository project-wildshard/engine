// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the complete Bash CLI without privileges.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own disposable settings and fake OS executables.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Repository-local scratch paths.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('complete unprivileged check reports all probes after a conflict and changes no protected settings', () => {
  mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolve('tmp/vps-check-'));
  const scripts = join(directory, 'scripts'), bin = join(directory, 'bin'), etc = join(directory, 'etc'), calls = join(directory, 'calls');
  for (const path of [scripts, bin, etc]) mkdirSync(path);
  const key = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
  const keyFile = join(directory, 'public-key'); writeFileSync(keyFile, `${key}\n`); chmodSync(keyFile, 0o644);
  const env = 'PACK_ORIGIN=\nRELEASE_URL=\nRELEASE_PUBLIC_KEY=\nSEAT_SECRET=check-only-value\n';
  for (const channel of ['production', 'staging']) writeFileSync(join(etc, `${channel}.env`), env);
  for (const name of ['setup-state.mjs', 'pull.mjs', 'dump.sh', 'restore-check.sh', 'uptime.sh', 'health-stub.mjs']) copyFileSync(join('scripts/vps', name), join(scripts, name));
  const executable = (name: string, body: string): void => { const path = join(bin, name); writeFileSync(path, `#!/bin/bash\n${body}\n`); chmodSync(path, 0o755); };
  executable('id', `if [ "$#" = 1 ]; then printf 1000; else printf '${process.getuid?.()}'; fi`);
  executable('getent', `printf 'wildshard:x:${process.getgid?.()}:\\n'`);
  executable('ss', 'cat "$WS_CHECK_SS"');
  executable('tailscale', `if [ "$1" = status ]; then printf '%s' '{"Self":{"DNSName":"wildshard.tailb41b20.ts.net."}}'; elif [ "$1" = serve ] && [ "$2" = status ]; then cat "$WS_CHECK_SERVE"; elif [ "$1" = ip ]; then if [ "$2" = -4 ]; then printf '100.86.54.106'; else printf 'fd7a:115c:a1e0::1a01:36d9'; fi; else printf 'MUTATION tailscale %s\\n' "$*" >> "$WS_CHECK_CALLS"; exit 90; fi`);
  executable('systemctl', `printf 'systemctl %s\\n' "$*" >> "$WS_CHECK_CALLS"; if [ "$1" = is-active ]; then exit 3; else printf 'MUTATION\\n' >> "$WS_CHECK_CALLS"; exit 90; fi`);
  for (const name of ['pg_lsclusters', 'runuser', 'curl', 'install', 'chown', 'chmod', 'apt-get', 'useradd']) executable(name, `printf 'MUTATION ${name}\\n' >> "$WS_CHECK_CALLS"; exit 90`);
  const ss = join(directory, 'ss.txt'); copyFileSync('test/fixtures/vps-ss-2026-11-09.txt', ss);
  const serve = join(directory, 'serve.json'); writeFileSync(serve, JSON.stringify({ TCP: { '443': { TCPForward: '127.0.0.1:1234' } } }));
  const script = readFileSync('scripts/vps/setup.sh', 'utf8').replace('ETC=/etc/wildshard HOME_DIR=/var/lib/wildshard', `ETC=${etc} HOME_DIR=${join(directory, 'data')}`).replace('NODE=/usr/bin/node', `NODE=${process.execPath}`).replace('KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex', `KEY_FILE=${keyFile}`);
  const entry = join(scripts, 'setup.sh'); writeFileSync(entry, script);
  chmodSync(etc, 0o000);
  try {
    const checked = spawnSync('bash', [entry, '--check'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, WS_CHECK_SS: ss, WS_CHECK_SERVE: serve, WS_CHECK_CALLS: calls, RELEASE_PUBLIC_KEY: key } });
    expect(checked.status).not.toBe(0); expect(checked.stdout).toContain('Serve/Funnel ownership conflict');
    expect(checked.stdout).toContain('no public game or database TCP listener');
    expect(checked.stdout).toContain('trusted release public key');
    expect(checked.stdout).toContain('cannot verify production env'); expect(checked.stdout).toContain('cannot verify staging env');
    expect(checked.stdout).toContain('PostgreSQL role, saves databases, hardening');
    expect(checked.stdout).toContain('All read-only probes completed'); expect(checked.stdout).not.toContain('would create');
    expect(checked.stdout).not.toContain('check-only-value'); expect(readFileSync(calls, 'utf8')).not.toContain('MUTATION');
  } finally {
    chmodSync(etc, 0o700);
    expect(readFileSync(join(etc, 'production.env'), 'utf8')).toBe(env); expect(readFileSync(join(etc, 'staging.env'), 'utf8')).toBe(env);
    rmSync(directory, { recursive: true, force: true });
  }
});
