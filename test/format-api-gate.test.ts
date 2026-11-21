import { expect, test } from 'vitest';
import { compareRelease, formatApiFailures } from '../scripts/format-api-gate.mjs';

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
const quiet = { warn: (): void => undefined, env: {} };

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
    env: {}, warn: line => { lines.push(line); }, observe: () => Promise.reject(new Error('offline')),
  });
  expect(failures).toEqual([]);
  expect(lines.join('\n')).toContain('offline');
});

test('ALLOW_FORMAT_AHEAD=1 is the named escape hatch', async () => {
  const lines: string[] = [];
  const failures = await formatApiFailures(lock('0.65.0'), lock('0.66.0'), {
    env: { ALLOW_FORMAT_AHEAD: '1' }, warn: line => { lines.push(line); }, observe: api('0.65.0'),
  });
  expect(failures).toEqual([]);
  expect(lines.join('\n')).toContain('ALLOW_FORMAT_AHEAD=1');
});

test('releases compare numerically', () => {
  expect(compareRelease('0.66.0', '0.65.9')).toBe(1);
  expect(compareRelease('0.9.0', '0.10.0')).toBe(-1);
  expect(compareRelease('1.2.3', '1.2.3')).toBe(0);
});
