// .agents/hooks/gh-poll-guard.mjs (MINI-FLOW MF12): a GitHub poll faster than once a minute is refused, with the way through.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fastPoll } from '../gh-poll-guard.mjs';

const HOOK = fileURLToPath(new URL('../gh-poll-guard.mjs', import.meta.url));
const run = (payload) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });

test('gh run watch and gh pr checks --watch need an interval of 60 s or more', () => {
  assert.match(fastPoll('gh run watch 123 -R o/r --exit-status') ?? '', /no --interval polls every 3 s/u);
  assert.match(fastPoll('cd x && gh run watch 123 -i 10') ?? '', /--interval 10` polls faster/u);
  assert.match(fastPoll('gh pr checks 5 --watch') ?? '', /every 10 s/u);
  for (const command of ['gh run watch 123 -R o/r --exit-status --interval 120', 'gh run watch 1 -i 60', 'gh run watch 1 --interval=90',
    'gh pr checks 5 --watch --interval 60', 'gh pr checks 5', 'gh run view 1 --json status', 'echo gh run watch is banned']) {
    assert.equal(fastPoll(command), null, command);
  }
});

test('a loop that calls gh and sleeps under 60 s is refused; 60 s or more, or no gh, passes', () => {
  for (const command of ['while true; do gh run view 1 --json status; sleep 20; done',
    'until [ "$(gh api repos/o/r/actions/runs/1 --jq .status)" = completed ]; do sleep 30; done',
    'for i in $(seq 100); do gh run list -R o/r -L 1; sleep 0.5m; done']) {
    assert.match(fastPoll(command) ?? '', /a loop calls gh and sleeps .*under 60 s/u, command);
  }
  for (const command of ['while true; do gh run view 1; sleep 60; done', 'while true; do gh run list; sleep 2m; done',
    'until curl -fs x; do sleep 5; done', 'for f in a b; do gh api repos/o/r/contents/$f; done']) {
    assert.equal(fastPoll(command), null, command);
  }
});

test('ALLOW_FAST_GH_POLL=1 is the escape hatch', () => {
  assert.equal(fastPoll('ALLOW_FAST_GH_POLL=1 gh run watch 1'), null);
});

test('the hook exits 2 with the way through and the escape hatch; other commands and tools pass silently', () => {
  const blocked = run({ tool_name: 'Bash', tool_input: { command: 'gh run watch 42' } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /BLOCKED by \.agents\/hooks\/gh-poll-guard\.mjs: `gh run watch` with no --interval/u);
  assert.match(blocked.stderr, /--exit-status --interval 60/u);
  assert.match(blocked.stderr, /ALLOW_FAST_GH_POLL=1/u);
  for (const payload of [{ tool_name: 'Bash', tool_input: { command: 'gh run watch 42 -i 60' } }, { tool_name: 'Edit', tool_input: { file_path: 'x' } }, {}]) {
    const passed = run(payload);
    assert.equal(passed.status, 0);
    assert.equal(passed.stderr, '');
  }
  assert.equal(spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' }).status, 0);
});
