import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise approval parsing against an isolated authored ledger.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the test's owned repository scratch root.
import { join } from 'node:path';
import { pendingPlatformUsers, partitionPendingPlatformUsers, type PendingPlatformUser } from '../scripts/shard-platform.mjs';

test('reports a named pending export without waiving helpers or later-wave custom code',()=>{
  const module='src/game/feature.ts';
  const allowance:PendingPlatformUser={module,export:'feature',shard:'driftwood-isle',
    plan:{path:'docs/plans/feature.md',row:'F1'},documentation:'docs/API.md','rechecked-by':'end of W3'};
  const rows=[{path:module,name:'feature',exported:true,lines:1},{path:module,name:'helper',exported:true,lines:1}];
  const report=partitionPendingPlatformUsers('sunscar-dunes',[],rows,[allowance]);
  expect(report.exports).toEqual(expect.arrayContaining([expect.objectContaining({name:'helper'})]));
  expect(report.exports).not.toEqual(expect.arrayContaining([expect.objectContaining({name:'feature'})]));
  expect(report.pending).toEqual(expect.arrayContaining([expect.objectContaining({name:'feature',status:'pending second user',users:[allowance]})]));
  expect(partitionPendingPlatformUsers('driftwood-isle',[],rows,[allowance]).exports).toEqual(rows);
  expect(partitionPendingPlatformUsers('sunscar-dunes',[],rows,[]).exports).toEqual(rows);
  expect(partitionPendingPlatformUsers('sunscar-dunes',[{path:module,lines:4}],[],[allowance]).modules)
    .toEqual(expect.arrayContaining([expect.objectContaining({path:module})]));
});

test('approved feature receipts survive a next-wave switch without waiving unrelated declarations',()=>{
  const module='src/game/feature.ts';
  const ordinary:PendingPlatformUser={module,export:'feature',shard:'nalati-grasslands',
    plan:{path:'docs/plans/feature.md',row:'F1'},documentation:'docs/API.md','rechecked-by':'end of W3'};
  const approved:PendingPlatformUser={...ordinary,approvedFeature:{name:'quest-step-runner',
    decision:{path:'docs/plans/decisions.md',row:'G474'}}};
  const rows=[{path:module,name:'feature',exported:true,lines:8},{path:module,name:'helper',exported:true,lines:3}];
  expect(partitionPendingPlatformUsers('pine-hollow',[],rows,[ordinary]).exports).toEqual(rows);
  const result=partitionPendingPlatformUsers('pine-hollow',[],rows,[approved]);
  expect(result.exports).toEqual([rows[1]]);
  expect(result.pending).toEqual([{...rows[0],status:'pending second user',users:[approved]}]);
  expect(partitionPendingPlatformUsers('pine-hollow',[{path:module,lines:20}],[],[approved]).modules).toEqual([{path:module,lines:20}]);
  const invalid:PendingPlatformUser={...approved,approvedFeature:{name:'not-an-approved-feature',
    decision:{path:'docs/plans/decisions.md',row:'G474'}}};
  expect(partitionPendingPlatformUsers('pine-hollow',[],rows,[invalid]).exports).toEqual(rows);
  const wrongDecision:PendingPlatformUser={...approved,approvedFeature:{name:'quest-step-runner',
    decision:{path:'docs/plans/decisions.md',row:'G475'}}};
  expect(partitionPendingPlatformUsers('pine-hollow',[],rows,[wrongDecision]).exports).toEqual(rows);
});

test('G473 contracts and elites keep their approved credit across waves', () => {
  const module = 'src/shared/game/quest/contracts.ts';
  const allowance: PendingPlatformUser = { module, shard: 'nalati-grasslands',
    plan: { path: 'docs/plans/decisions.md', row: 'G484' },
    documentation: 'docs/ENGINE.md', 'rechecked-by': 'end of W3',
    approvedFeature: { name: 'contracts + elites', decision: { path: 'docs/plans/decisions.md', row: 'G473' } } };
  const rows = [{ path: module, name: 'draw', exported: true, lines: 8 }];
  expect(partitionPendingPlatformUsers('pine-hollow', [], rows, [allowance]).exports).toEqual([]);
  expect(partitionPendingPlatformUsers('pine-hollow', [], rows, [allowance]).pending).toHaveLength(1);
  expect(partitionPendingPlatformUsers('pine-hollow', [], rows, []).exports).toEqual(rows);
});

test('G483 declared runtime entry retains its explicit approved feature credit', () => {
  const module = 'src/client/game/shardfile/clientPlan.ts';
  const allowance: PendingPlatformUser = { module, shard: 'nalati-grasslands',
    plan: { path: 'docs/plans/decisions.md', row: 'G483' },
    documentation: 'docs/ENGINE.md', 'rechecked-by': 'end of W3',
    approvedFeature: { name: 'declared runtime entry', decision: { path: 'docs/plans/decisions.md', row: 'G483' } } };
  const rows = [{ path: module, name: 'installClientPhase', exported: true, lines: 8 }];
  expect(partitionPendingPlatformUsers('pine-hollow', [], rows, [allowance]).exports).toEqual([]);
});


test('day-one hosts carry their exact approval without a fictional future user', () => {
  for (const [name, row] of [['streamed cover', 'G475'], ['toon look host', 'G475'], ['light emitters', 'G478'],
    ['eased fields', 'G484']] as const) {
    const module = 'src/game/looks/fixture.ts';
    const allowance: PendingPlatformUser = { module, documentation: 'docs/ENGINE.md',
      approvedFeature: { name, decision: { path: 'docs/plans/decisions.md', row } } };
    const rows = [{ path: module, lines: 200 }];
    expect(partitionPendingPlatformUsers('driftwood-isle', rows, [], [allowance]).modules).toEqual([]);
    const noDecision: PendingPlatformUser = { module, documentation: 'docs/ENGINE.md' };
    expect(partitionPendingPlatformUsers('driftwood-isle', rows, [], [noDecision]).modules).toEqual(rows);
    const wrongDecision: PendingPlatformUser = { ...allowance,
      approvedFeature: { name, decision: { path: 'docs/plans/decisions.md', row: 'G474' } } };
    expect(partitionPendingPlatformUsers('driftwood-isle', rows, [], [wrongDecision]).modules).toEqual(rows);
  }
});


test('approval-only ledger entries require the exact decision and complete ordinary plans', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync('tmp/approved-host-test-');
  try {
    for (const dir of ['lint', 'src/client/game/looks', 'src/shared/game/looks', 'docs/plans']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'src/client/game/looks/fixture.ts'), 'export const feature = 1;');
    writeFileSync(join(root, 'docs/ENGINE.md'), 'game/looks/fixture');
    writeFileSync(join(root, 'docs/plans/decisions.md'), '| G475 | approved toon |');
    const entry: PendingPlatformUser = { module: 'src/client/game/looks/fixture.ts', documentation: 'docs/ENGINE.md',
      approvedFeature: { name: 'toon look host', decision: { path: 'docs/plans/decisions.md', row: 'G475' } } };
    const put = (value: unknown) => { writeFileSync(join(root, 'lint/platform-pending-users.json'), JSON.stringify({ schema: 'platform-pending-users/1', entries: [value] })); };
    put(entry); expect(pendingPlatformUsers(root)).toEqual([entry]);
    put({ ...entry, approvedFeature: undefined }); expect(() => pendingPlatformUsers(root)).toThrow('pending user');
    put({ ...entry, shard: 'nalati-grasslands' }); expect(() => pendingPlatformUsers(root)).toThrow('pending user');
    put({ ...entry, approvedFeature: { ...entry.approvedFeature, name: 'made-up-host' } }); expect(() => pendingPlatformUsers(root)).toThrow('Unapproved');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('current pending receipts name live exports and missing exports still refuse', () => {
  expect(pendingPlatformUsers(process.cwd()).length).toBeGreaterThan(0);
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync('tmp/pending-export-test-');
  try {
    for (const dir of ['lint', 'src/game', 'docs/plans']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'src/game/fixture.ts'), 'export const kept = 1;');
    writeFileSync(join(root, 'docs/API.md'), 'game/fixture');
    writeFileSync(join(root, 'docs/plans/feature.md'), '| F1 | Nalati |');
    const entry: PendingPlatformUser = { module: 'src/game/fixture.ts', export: 'removed', shard: 'nalati-grasslands',
      plan: { path: 'docs/plans/feature.md', row: 'F1' }, documentation: 'docs/API.md', 'rechecked-by': 'end of W3' };
    writeFileSync(join(root, 'lint/platform-pending-users.json'), JSON.stringify({ schema: 'platform-pending-users/1', entries: [entry] }));
    expect(() => pendingPlatformUsers(root)).toThrow('Missing pending platform export: src/game/fixture.ts#removed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
