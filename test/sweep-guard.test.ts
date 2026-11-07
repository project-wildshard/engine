// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real shell safety guard without mutating Git.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('the single safety guard requires commit.sh and refuses whole-tree staging', () => {
  const check = (command: string): number | null => spawnSync('bash', ['.claude/hooks/guard-bash-safety.sh'], {
    input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
  }).status;
  expect(check('scripts/commit.sh "fix: fixture" -- src/a.ts')).toBe(0);
  expect(check('git diff -- src/a.ts')).toBe(0);
  for (const command of ['git commit -m "fix: fixture" -- src/a.ts', 'git commit-tree deadbeef',
    'git add -A', 'git add .', 'git add -u']) expect(check(command)).toBe(2);
});
