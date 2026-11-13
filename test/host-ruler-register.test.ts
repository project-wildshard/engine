// HOST-RULER HR5 (meta docs/plans/HOST-RULER-PLAN.md): the one host register and its reader.
// oxlint-disable-next-line import/no-nodejs-modules -- Reads the committed register as text.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { formatRegister, hostRegisterProblems, readHostRegister, RECHECK, REGISTER, type HostRegister, type RegisterRow } from '../scripts/host-ruler/register.mjs';

const register = readHostRegister();
const from = (line: number) => [{ source: 'list', line, selector: `x${line}` }];
const row = (key: string, extra: Partial<RegisterRow> = {}): RegisterRow => ({ key, verdict: 'game', decision: 'G1', users: [], from: from(1), ...extra });
const fixture = (rows: RegisterRow[], extra: Partial<HostRegister> = {}): HostRegister => ({
  schema: 'wildshard.host-register/1', about: 'fixture',
  decisions: { G: { source: 'fixture', ids: ['G1', 'G2'] }, J: { source: 'fixture', ids: ['J1'] } },
  sources: { list: { file: 'fixture', rows: rows.reduce((sum, entry) => sum + entry.from.length, 0) } },
  merged: [], dropped: [], rows, ...extra,
});
const clientPlan = 'src/client/game/shardfile/clientPlan.ts';
const format = '@wildshard/format/src/format/clientPlan.ts';

describe('the committed register', () => {
  test('every row passes the reader: module there, binding named, decision pinned, recheck placed, counts add up', () => {
    expect(hostRegisterProblems(JSON.parse(readFileSync(REGISTER, 'utf8')))).toEqual([]);
    expect(register.rows.length).toBeGreaterThan(400);
  });
  test('it carries all five sources, every verdict, and the one Q4 recheck date on migrated pending rows', () => {
    expect(Object.keys(register.sources).sort()).toEqual(['chargebacks', 'host-bar', 'host-reviews', 'listed-view', 'pending-users']);
    expect(new Set(register.rows.map(entry => entry.verdict))).toEqual(new Set(['engine', 'game', 'pending', 'borderline', 'silly']));
    expect(register.rows.filter(entry => entry.verdict === 'pending').every(entry => entry.recheck === RECHECK)).toBe(true);
  });
  test('it is written in its committed layout, one row per line', () => {
    expect(formatRegister(register)).toBe(readFileSync(REGISTER, 'utf8'));
  });
});

describe('the reader refuses', () => {
  test('nothing on a valid fixture, a format module and a binding row included', () => {
    expect(hostRegisterProblems(fixture([row(clientPlan), row(`${clientPlan}#CLIENT_FEATURES`), row(format, { verdict: 'pending', recheck: RECHECK })]))).toEqual([]);
  });
  test('a missing module, an unnamed binding and an old unsided path', () => {
    expect(hostRegisterProblems(fixture([row('src/client/game/shardfile/gone.ts'), row(`${clientPlan}#neverNamedHere`)])))
      .toEqual(['src/client/game/shardfile/gone.ts: no such module', `${clientPlan}#neverNamedHere: ${clientPlan} never names neverNamedHere`]);
    expect(hostRegisterProblems(fixture([row('src/game/shardfile/clientPlan.ts')]))[0]).toMatch(/^shape: rows\.0\.key/u);
    expect(hostRegisterProblems(fixture([row('src/client/game/shard/page-mode-boot.test.ts')]))[0]).toMatch(/^shape: rows\.0\.key/u);
  });
  test('a decision outside the pinned lists, and a recheck missing or misplaced', () => {
    expect(hostRegisterProblems(fixture([row(clientPlan, { decision: 'G9' })]))).toEqual([`${clientPlan}: decision G9 is in neither fixture nor fixture`]);
    expect(hostRegisterProblems(fixture([row(clientPlan, { verdict: 'pending' })]))).toEqual([`${clientPlan}: pending needs recheck date`]);
    expect(hostRegisterProblems(fixture([row(clientPlan, { recheck: RECHECK })]))).toEqual([`${clientPlan}: game takes no recheck date`]);
    expect(hostRegisterProblems(fixture([row(clientPlan, { verdict: 'silly' })]))).toEqual([`${clientPlan}: silly is charged to its users, and names none`]);
  });
  test('a duplicate key, and counts that do not add up to the sources minus the listed dedupe', () => {
    expect(hostRegisterProblems(fixture([row(clientPlan), row(clientPlan, { from: from(2) })]))).toEqual([`${clientPlan}: duplicate row`]);
    const merged = row(clientPlan, { from: [...from(1), ...from(2)] });
    expect(hostRegisterProblems(fixture([merged]))).toEqual([`${clientPlan}: 1 merged source rows, the dedupe list says 0`]);
    expect(hostRegisterProblems(fixture([merged], { merged: [{ key: clientPlan, kept: 'game G1', merged: ['pending G2 (list:2)'] }] }))).toEqual([]);
    expect(hostRegisterProblems(fixture([row(clientPlan)], { sources: { list: { file: 'fixture', rows: 2 } } })))
      .toEqual(['count: sources list 2 rows, the register holds 1 source lines and 0 dropped', 'count: source list lists 2 rows, the register holds 1']);
    expect(hostRegisterProblems(fixture([row(clientPlan)], { sources: { list: { file: 'fixture', rows: 2 } }, dropped: [{ key: 'x', from: from(2)[0]!, reason: 'gone' }] }))).toEqual([]);
  });
});
