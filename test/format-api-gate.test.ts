import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRelease, formatApiFailures, refsFailures } from '../src/scripts/format-api-gate.mjs';

// SHARD-COMPAT CP3 (J486 Q46): engine's push gate refuses a shard-format pin newer than the API's.
const lock = (version: string): string => `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@wildshard/format':
        specifier: npm:@wildshard/shard-format@${version}
        version: '@wildshard/shard-format@${version}(typescript@6.0.3)'

packages:

  '@wildshard/shard-format@${version}':
    resolution: {integrity: sha512-HbNtrUnsBQHq+q0y95b298kf4w3sQQ1Yef==}
    engines: {node: '>=24.18.0'}

snapshots:
`;
const api = (version: string) => (): Promise<string> => Promise.resolve(version);
// Row 143's floor check reads the API's pointers on a pin move; these cases judge CP3 alone.
const noFloor = () => Promise.resolve({ floor: '0.1.0.1', below: [] });
const quiet = { warn: (): void => undefined, env: {}, floor: noFloor };

test('a pin bump above the API is refused, naming both versions', async () => {
  const failures = await formatApiFailures(lock('0.65.0'), lock('0.66.0'), { ...quiet, observe: api('0.65.0') });
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain('shard-format 0.66.0 is newer than the API\'s 0.65.0');
});

test('a bump to the API\'s version, or below it, passes', async () => {
  expect(await formatApiFailures(lock('0.65.0'), lock('0.66.0'), { ...quiet, observe: api('0.66.0') })).toEqual([]);
  expect(await formatApiFailures(lock('0.66.0'), lock('0.65.1'), { ...quiet, observe: api('0.66.0') })).toEqual([]);
});

test('a lock whose format did not move is never refused for the state it inherited', async () => {
  const observe = (): Promise<string> => Promise.reject(new Error('must not be read'));
  expect(await formatApiFailures(lock('0.66.0'), lock('0.66.0'), { ...quiet, observe })).toEqual([]);
});

test('an unreachable API warns and passes', async () => {
  const lines: string[] = [];
  const failures = await formatApiFailures(lock('0.65.0'), lock('0.66.0'), {
    env: {}, warn: line => { lines.push(line); }, observe: () => Promise.reject(new Error('offline')), floor: noFloor,
  });
  expect(failures).toEqual([]);
  expect(lines.join('\n')).toContain('offline');
});

test('ALLOW_FORMAT_AHEAD=1 is the named escape hatch', async () => {
  const lines: string[] = [];
  const failures = await formatApiFailures(lock('0.65.0'), lock('0.66.0'), {
    env: { ALLOW_FORMAT_AHEAD: '1' }, warn: line => { lines.push(line); }, observe: api('0.65.0'), floor: noFloor,
  });
  expect(failures).toEqual([]);
  expect(lines.join('\n')).toContain('ALLOW_FORMAT_AHEAD=1');
});

test('releases compare numerically', () => {
  expect(compareRelease('0.66.0', '0.65.9')).toBe(1);
  expect(compareRelease('0.9.0', '0.10.0')).toBe(-1);
  expect(compareRelease('1.2.3', '1.2.3')).toBe(0);
});

// 11-21: engine 675819e90 moved the pin 0.66.0 -> 0.67.0 through land while the API served 0.66.0; the gate sat in a
// phase no push ran. Land and main-push both push main through .githooks/pre-push, which now runs refsFailures.
test('a main push moving the pin above the API is refused from git\'s pre-push ref lines', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'format-api-gate-'));
  try {
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'pnpm-lock.yaml'), lock('0.66.0')); git('add', '.'); git('commit', '-qm', 'base', '--no-verify');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'pnpm-lock.yaml'), lock('0.67.0')); git('commit', '-qam', 'pin 0.67.0', '--no-verify');
    const tip = git('rev-parse', 'HEAD');
    const line = (remote: string): string => `refs/heads/main ${tip} refs/heads/main ${remote}`;
    const refused = await refsFailures(line(base), repo, { ...quiet, observe: api('0.66.0') });
    expect(refused[0]).toContain('shard-format 0.67.0 is newer than the API\'s 0.66.0');
    // A remote tip this clone lacks: compared from the first parent, so still refused.
    expect(await refsFailures(line('f'.repeat(40)), repo, { ...quiet, observe: api('0.66.0') })).toHaveLength(1);
    expect(await refsFailures(line(base), repo, { ...quiet, observe: api('0.67.0') })).toEqual([]);
    expect(await refsFailures(`refs/heads/plan/x ${tip} refs/heads/plan/x ${base}`, repo, { ...quiet, observe: api('0.66.0') })).toEqual([]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('the pre-push hook every main push runs (land and main-push alike) calls the gate', () => {
  expect(readFileSync('.githooks/pre-push', 'utf8')).toContain('node src/scripts/format-api-gate.mjs refs');
});
