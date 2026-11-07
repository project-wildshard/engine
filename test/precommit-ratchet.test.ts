// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns tiny Git trees and real checker children.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the committed checker supplied to the fixture.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { ratchetApprovalFailures } from '../scripts/ratchet-approval.mjs';

test('staged ratchet compares missing entries to HEAD and honors new staged entries', () => {
  expect(execFileSync('python3', ['test/fixtures/precommit-ratchet.py', resolve('scripts/precommit-checks.mjs')],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).toContain('9 staged ratchet regressions passed');
});

test('approval trailers match every exact increase once in the footer', () => {
  const before = { 'wildshard/generator-imports': { 'src/old.ts': 7 } };
  const after = { 'wildshard/generator-imports': { 'src/old.ts': 8, 'src/new.ts': 2 } };
  const one = 'Ratchet-Approved: wildshard-new wildshard/generator-imports src/old.ts +1';
  const two = 'Ratchet-Approved: wildshard-new wildshard/generator-imports src/new.ts +2';
  const approved = `fix(test): approve policy\n\n${one}\n${two}\n\nAssisted-by: sp-x2:gpt-6.1-sol`;
  expect(ratchetApprovalFailures(before, after, approved)).toEqual([]);
  expect(ratchetApprovalFailures(before, after, approved.replaceAll(' src/', '\n src/'))).toEqual([]);
  for (const bad of ['', approved.replace(two, ''), approved.replace('+2', '+3'),
    approved.replace('wildshard-new', 'someone-else'), `${approved}\n${one}`,
    approved.replace(one, `${one}\n\nbody`), `${approved}\nRatchet-Approved: wildshard-new wildshard/other src/new.ts +2`]) {
    expect(ratchetApprovalFailures(before, after, bad).length).toBeGreaterThan(0);
  }
  expect(ratchetApprovalFailures(after, before, 'fix(test): lower debt')).toEqual([]);
});

test('one removed row can move to one new key at the same or lower count', () => {
  const rule = 'wildshard/generator-imports', before = {[rule]:{'src/old.ts':11}};
  const prose = 'fix(policy): move the source\n\nRatchet-Approved: wildshard-new (row renamed, net zero)';
  expect(ratchetApprovalFailures(before,{[rule]:{'src/new.ts':11}},prose)).toEqual([]);
  expect(ratchetApprovalFailures(before,{[rule]:{'src/new.ts':10}},prose)).toEqual([]);
  for (const rows of [{'src/old.ts':11,'src/new.ts':11},{'src/new.ts':12},{'src/a.ts':6,'src/b.ts':5}])
    expect(ratchetApprovalFailures(before,{[rule]:rows},prose).join('\n')).toContain('Missing ratchet approval');
  expect(ratchetApprovalFailures(before,{'wildshard/no-runtime-in-build':{'src/new.ts':11}},prose).join('\n')).toContain('Missing ratchet approval');
  expect(ratchetApprovalFailures({'wildshard/tile-bake':{'old':11}},{'wildshard/tile-bake':{'new':11}},prose,'tiles').join('\n')).toContain('Missing ratchet approval');
});
