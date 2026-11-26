/* oxlint-disable import/no-nodejs-modules -- Real publishing entry points must stop before Git/network mutations. */
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {assertNoLocalCandidates, clearLocalCandidates, LOCAL_CANDIDATES, recordLocalCandidate} from '../src/scripts/local-candidates.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
/** main-push and land are the kit's; release-check is the engine's own. */
const entry = (script: string): string => resolve(script === 'release-check.mjs' ? 'src/scripts' : 'src/scripts/.kit', script);
function fixture(): string {
  mkdirSync('tmp/codex-pins-ll5-tests', {recursive: true});
  const root = mkdtempSync(resolve('tmp/codex-pins-ll5-tests/tree-')); roots.push(root);
  const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main', root]);
  if (init.status !== 0) throw new Error('Could not create fixture');
  mkdirSync(join(root, 'out'), {recursive: true});
  writeFileSync(join(root, 'package.json'), '{}');
  return root;
}

test.each(['main-push.mjs', 'land.mjs', 'release-check.mjs'])('%s names local slug and clear command before doing work', script => {
  const root = fixture();
  recordLocalCandidate(root, {slug: 'brasscap-mesa', path: '/canonical/shard/out/brasscap-mesa', indexHash: 'a'.repeat(64)});
  const original = readFileSync(join(root, LOCAL_CANDIDATES), 'utf8');
  const result = spawnSync(process.execPath, [entry(script), ...(script === 'release-check.mjs' ? ['--probe'] : [])],
    {cwd: root, env: {...process.env, CI: ''}, encoding: 'utf8', timeout: 10_000});
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('brasscap-mesa');
  expect(result.stdout + result.stderr).toContain('node src/scripts/pins.ts install');
  expect(readFileSync(join(root, LOCAL_CANDIDATES), 'utf8')).toBe(original);
  clearLocalCandidates(root);
  expect(() => assertNoLocalCandidates(root)).not.toThrow();
  const next = spawnSync(process.execPath, [entry(script), ...(script === 'release-check.mjs' ? ['--probe'] : script === 'main-push.mjs' ? ['--tries', '1', '--wait', '0'] : [])],
    {cwd: root, env: {...process.env, CI: '', WS_MAIN_PUSH_PREGATE: '0'}, encoding: 'utf8', timeout: 10_000});
  expect(next.error).toBeUndefined();
  expect(next.stdout + next.stderr).not.toContain('Local shard installed');
});

test('the native pre-push hook also refuses before its clean-copy gate', () => {
  const root = fixture();
  mkdirSync(join(root, 'src'));
  symlinkSync(resolve('src/scripts'), join(root, 'src/scripts'), 'dir');
  recordLocalCandidate(root, {slug: 'sunscar-dunes', path: '/canonical/shard/out/sunscar-dunes', indexHash: 'b'.repeat(64)});
  const result = spawnSync('bash', [resolve('.githooks/pre-push')], {cwd: root, input: '', env: {...process.env, CI: ''}, encoding: 'utf8', timeout: 10_000});
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('sunscar-dunes');
  expect(result.stderr).toContain('node src/scripts/pins.ts install');
});

test('CI refuses planted provenance without parsing its contents; a pinned tree passes', () => {
  const root = fixture();
  expect(() => assertNoLocalCandidates(root, {CI: 'true'})).not.toThrow();
  writeFileSync(join(root, LOCAL_CANDIDATES), 'not JSON');
  expect(() => assertNoLocalCandidates(root, {CI: 'true'})).toThrow('local provenance in CI');
});
