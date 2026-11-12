// oxlint-disable-next-line import/no-nodejs-modules -- Real CLI and file boundaries without sudo.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Disposable files owned by this test.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Repo-local disposable paths.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const helper = 'scripts/vps/setup-state.mjs';
const key = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
const host = 'wildshard.tailb41b20.ts.net';
function run(args: string[], input?: unknown): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', ...(input === undefined ? {} : { input: JSON.stringify(input) }), env: { ...process.env, RELEASE_PUBLIC_KEY: key } });
}
function root(): string { mkdirSync('tmp', { recursive: true }); return mkdtempSync(resolve('tmp/vps-phase2-')); }
function route(port: string): { Handlers: Record<string, { Proxy: string }> } { return { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } }; }

test('Serve inspection accepts absent and exactly owned tailnet-only routes, including a completed rerun', () => {
  expect(run(['network', host], {}).status).toBe(0);
  const owned = {
    TCP: { '443': { HTTPS: true }, '8443': { HTTPS: true }, '8790': { HTTP: true } },
    Web: { [`${host}:443`]: route('8790'), [`${host}:8443`]: route('8791'), [`${host}:8790`]: route('8790') },
  };
  const complete = run(['network', host, '--complete'], owned);
  expect(complete.status, String(complete.stderr)).toBe(0);
  expect(String(complete.stdout)).not.toContain('Funnel');
  expect(run(['network', host, '--complete'], { ...owned, AllowFunnel: { [`${host}:443`]: false, [`${host}:8443`]: false } }).status).toBe(0);
  expect(run(['network', host, '--complete'], {}).status).not.toBe(0);
});

test('MS8.2: a Funnel route is drift, named with the command that retires it', () => {
  const owned = {
    TCP: { '443': { HTTPS: true }, '8443': { HTTPS: true }, '8790': { HTTP: true } },
    Web: { [`${host}:443`]: route('8790'), [`${host}:8443`]: route('8791'), [`${host}:8790`]: route('8790') },
  };
  for (const port of ['443', '8443']) {
    for (const complete of [[], ['--complete']]) {
      const result = run(['network', host, ...complete], { ...owned, AllowFunnel: { [`${host}:${port}`]: true } });
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain(`tailscale funnel --https=${port} off`);
    }
  }
});

test('Funnel refuses foreign paths, forwarding, hosts and public ports without printing their private targets', () => {
  const privateTarget = 'http://127.0.0.1:1234/private-token';
  for (const config of [
    { TCP: { '443': { TCPForward: privateTarget } } },
    { Web: { [`${host}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:8790' }, '/claw': { Proxy: privateTarget } } } } },
    { Web: { [`${host}:443`]: { Handlers: { '/': { Proxy: privateTarget } } } } },
    { Web: { 'other.ts.net:8443': route('8791') } },
    { AllowFunnel: { [`${host}:10000`]: true } },
    { AllowFunnel: { [`${host}:10000`]: false } },
    { AllowFunnel: { [`${host}:8790`]: true } },
    { Foreground: { session: { TCP: { '443': { HTTPS: true } } } } },
  ]) {
    const result = run(['network', host], config);
    expect(result.status).not.toBe(0); expect(String(result.stderr)).not.toContain(privateTarget);
  }
});

test('prefill changes only exact blank rows, is atomic, preserves filled values and is read-only in check mode', () => {
  const directory = root(), path = join(directory, 'production.env');
  const original = '# unchanged\nPACK_ORIGIN=\nRELEASE_URL=https://keep.invalid/existing\nRELEASE_PUBLIC_KEY=\nSEAT_SECRET=owned-test-value\n\n';
  writeFileSync(path, original); chmodSync(path, 0o600);
  const args = ['prefill', path, 'production', key, '--check', String(process.getuid?.()), String(process.getgid?.())];
  try {
    const checked = run(args); expect(checked.status, String(checked.stderr)).toBe(0);
    expect(String(checked.stdout)).toContain('would fill RELEASE_PUBLIC_KEY');
    expect(String(checked.stdout)).not.toContain('owned-test-value');
    expect(readFileSync(path, 'utf8')).toBe(original); expect(lstatSync(path).mode & 0o777).toBe(0o600);
    const inode = lstatSync(path).ino;
    args[4] = '--apply'; const applied = run(args); expect(applied.status, String(applied.stderr)).toBe(0);
    const expected = original.replace('PACK_ORIGIN=\n', 'PACK_ORIGIN=https://packs.wildshard.io\n').replace('RELEASE_PUBLIC_KEY=\n', `RELEASE_PUBLIC_KEY=${key}\n`);
    expect(readFileSync(path, 'utf8')).toBe(expected); expect(lstatSync(path).ino).not.toBe(inode);
    expect(lstatSync(path).mode & 0o777).toBe(0o640);
    const appliedInode = lstatSync(path).ino;
    expect(run(args).status).toBe(0); expect(lstatSync(path).ino).toBe(appliedInode);
    const differentTrust = original.replace('RELEASE_PUBLIC_KEY=\n', 'RELEASE_PUBLIC_KEY=keep-this-filled-row\n');
    writeFileSync(path, differentTrust); expect(run(args).status).not.toBe(0); expect(readFileSync(path, 'utf8')).toBe(differentTrust);
    const target = join(directory, 'target'); writeFileSync(target, original);
    const link = join(directory, 'symlink.env'); symlinkSync(target, link); args[1] = link;
    expect(run(args).status).not.toBe(0); expect(readFileSync(target, 'utf8')).toBe(original);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the staged pin must match embedded trust and reject symlinks, wrong owners and writable files', () => {
  const directory = root(), path = join(directory, 'release-public-key.hex');
  writeFileSync(path, `${key}\n`); chmodSync(path, 0o644);
  try {
    const args = ['pin', path, key, String(process.getuid?.())];
    expect(run(args).status).toBe(0);
    args[3] = String((process.getuid?.() ?? 0) + 1); expect(run(args).status).not.toBe(0);
    args[3] = String(process.getuid?.()); chmodSync(path, 0o664); expect(run(args).status).not.toBe(0);
    chmodSync(path, 0o644); writeFileSync(path, key.replace('12e171', '22e171')); expect(run(args).status).not.toBe(0);
    const link = join(directory, 'link'); symlinkSync(path, link); args[1] = link; expect(run(args).status).not.toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
