/* oxlint-disable import/no-nodejs-modules -- The real entry points must refuse before any Git work. */
// Meta QA 11-25 row 43: main-push and land refuse to run without WS_LANE_NAME, naming the variable, instead of calling
// themselves `main-push` or `land` (row 37's HOLD guard once stopped the HOLD's own named lander that way).
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {laneName} from '../scripts/lane-name.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

it('a lane name is a plain lowercase word; anything else is refused with the variable to set', () => {
  expect(laneName({WS_LANE_NAME: 'opus-ma'}, 'main-push')).toEqual({lane: 'opus-ma'});
  for (const env of [{}, {WS_LANE_NAME: ''}, {WS_LANE_NAME: 'Opus MA'}, {WS_LANE_NAME: ' opus-ma'}]) {
    const named = laneName(env, 'land');
    expect('refusal' in named ? named.refusal : '').toContain('set WS_LANE_NAME=');
  }
});

it.each(['main-push', 'land'])('%s.mjs stops before any work without WS_LANE_NAME, and never calls itself by its name', script => {
  mkdirSync('tmp/lane-name-tests', {recursive: true});
  const root = mkdtempSync(resolve('tmp/lane-name-tests/tree-')); roots.push(root);
  expect(spawnSync('git', ['init', '--quiet', '--initial-branch=main', root]).status).toBe(0);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'WS_LANE_NAME'));
  const args = script === 'main-push' ? ['-m', 'fix: a', 'a.txt'] : [];
  const result = spawnSync(process.execPath, [resolve(`scripts/${script}.mjs`), ...args],
    {cwd: root, env: {...env, CI: '', WS_MAIN_PUSH_RECEIPT: '0', WS_MAIN_PUSH_PREGATE: '0'}, encoding: 'utf8', timeout: 20_000});
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain(`${script} runs only under a lane name: set WS_LANE_NAME=`);
  expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {cwd: root}).status).not.toBe(0);
});
