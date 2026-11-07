// oxlint-disable-next-line import/no-nodejs-modules -- Ask the tree itself.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

// P1-E5.3-H2: a step has one command, on the wire and off it.
test('nothing brings back a second command type', () => {
  const name = ['Player', 'Command'].join(''), found = spawnSync('git', ['grep', '-lw', name, '--', 'src', 'test', 'scripts'], { encoding: 'utf8' });
  expect(found.stdout.trim()).toBe('');
});
