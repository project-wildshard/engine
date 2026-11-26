// @vitest-environment node
// Meta QA 11-25 row 88: v0.1.95's staging cook move rolled back. The box's root-owned wildshard-apply and rebuild.sh
// predate the lean move: the apply unpacks `scripts/vps` from a signed commit and the rebuild ran
// `scripts/assert-store-layout.mjs`, and a lean tag has neither. These hold the bridge an old box hardens through, and
// hold every repo path a box script names to the tree it ships in.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

const tracked = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);

// The box hardened from v0.1.96's lean tag on 2026-11-26 (its stamp names 48084eb2), so the bridge an old apply ran
// (scripts/vps/harden.sh, d14a43d7d) is gone and the pre-lean scripts/ folder holds nothing tracked again.
test('nothing is tracked under the pre-lean scripts/', () => {
  expect(tracked.filter(path => path.startsWith('scripts/'))).toEqual([]); // script-paths: proves the pre-lean folder stays empty
});

test('the lean wildshard-apply unpacks src/scripts/vps, which holds every script it runs', () => {
  const apply = readFileSync('src/scripts/vps/wildshard-apply.mjs', 'utf8');
  expect(apply).toContain('archive "$2" src/scripts/vps |');
  const scripts = /const SCRIPTS = (\{[^}]+\})/u.exec(apply)?.[1] ?? '';
  const names = [...scripts.matchAll(/'([\w.-]+\.sh)'/gu)].map(match => match[1]);
  expect(names).toEqual(['harden.sh', 'setup.sh', 'rebuild.sh']);
  for (const name of names) expect(existsSync(`src/scripts/vps/${name}`)).toBe(true);
});

// The box runs these scripts from a signed tag's tree and runs the paths they name in the cook's checkout of that tag.
test('every repo path a box script names exists at this tree, and none is pre-lean', () => {
  const path = /(?:^|[^\w./$-])((?:src|scripts|test|packages|pages|server|shared)\/[\w.-]+(?:\/[\w.*-]+)*)/gu;
  const named: string[] = [];
  for (const file of tracked.filter(file => file.startsWith('src/scripts/vps/'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(path)) named.push(`${file} ${(match[1] ?? '').replace(/\.$/u, '')}`);
  }
  expect(named.length).toBeGreaterThan(5);
  const at = (row: string) => row.split(' ')[1] ?? '';
  const missing = named.filter(row => !existsSync(at(row)));
  const preLean = named.filter(row => at(row).startsWith('scripts/')); // script-paths: finds pre-lean paths the box would run
  expect(missing).toEqual([]);
  expect(preLean).toEqual([]);
  expect(named).toContain('src/scripts/vps/rebuild.sh src/scripts/.kit/assert-store-layout.mjs');
});
