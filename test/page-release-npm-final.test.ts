// @vitest-environment node
// QA 11-26 row 90 (J505): npm latest follows production. npmFinal dispatches npm-publish.yml publish_final when npm is behind.
import {expect, test} from 'vitest';
import {npmFinal, type NpmFinalDeps} from '../src/scripts/page-release/npm-final.mjs';

function rig(latest: (string | undefined)[], existing?: number, conclusion = 'success') {
  const calls: string[] = [];
  let clock = 0;
  const deps: NpmFinalDeps = {
    latest: () => { const value = latest.length > 1 ? latest.shift() : latest[0]; calls.push(`latest ${value}`); return Promise.resolve(value); },
    existingRun: tag => { calls.push(`existing ${tag}`); return Promise.resolve(existing); },
    dispatch: tag => { calls.push(`dispatch ${tag}`); return Promise.resolve(41); },
    watch: run => { calls.push(`watch ${run}`); return Promise.resolve(conclusion); },
    log: line => { calls.push(`log ${line}`); },
    sleep: ms => { clock += ms; return Promise.resolve(); },
    now: () => clock, waitMs: 60_000, pollMs: 15_000,
  };
  return {deps, calls};
}

test('npm latest already at the tag dispatches nothing', async () => {
  const {deps, calls} = rig(['0.1.102']);
  await expect(npmFinal('v0.1.102', deps)).resolves.toEqual({version: '0.1.102', already: true});
  expect(calls.some(call => call.startsWith('dispatch'))).toBe(false);
});

test('npm latest behind dispatches publish_final, waits for the run, then reads latest again', async () => {
  const {deps, calls} = rig(['0.1.100', '0.1.100', '0.1.102']);
  await expect(npmFinal('v0.1.102', deps)).resolves.toEqual({version: '0.1.102', run: 41, already: false});
  expect(calls.filter(call => !call.startsWith('log'))).toEqual(['latest 0.1.100', 'existing v0.1.102', 'dispatch v0.1.102', 'watch 41', 'latest 0.1.100', 'latest 0.1.102']);
});

test('an existing publish_final run is reused, never dispatched twice', async () => {
  const {deps, calls} = rig(['0.1.100', '0.1.102'], 7);
  await npmFinal('v0.1.102', deps);
  expect(calls).toContain('watch 7');
  expect(calls.some(call => call.startsWith('dispatch'))).toBe(false);
});

test('a failed run or a version npm never shows refuses', async () => {
  await expect(npmFinal('v0.1.102', rig(['0.1.100'], undefined, 'failure').deps)).rejects.toThrow(/run 41 for v0\.1\.102 ended failure/u);
  await expect(npmFinal('v0.1.102', rig(['0.1.100']).deps)).rejects.toThrow(/run 41 passed but npm latest is 0\.1\.100, not 0\.1\.102/u);
  await expect(npmFinal('0.1.102', rig(['0.1.100']).deps)).rejects.toThrow(/not a release tag/u);
});
