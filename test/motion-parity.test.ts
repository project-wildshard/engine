// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-unassigned-import -- The bits these files pin are the portable ones.
import '../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The ratchet is a file.
import { readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The ratchet's update switch.
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { loadCourseRapier, runScenario, TOLERANCE, type ParityResult } from './fixtures/motion-trace/parity';
import { MOTION_SCENARIOS } from './fixtures/motion-trace/scenarios';

// P1-E5.3 B2: how far the server's law is from the page's, scenario by scenario. `ratchet.json` lists each scenario still
// failing and its failing ticks: a tick over 2 cm or with unequal flags. It only falls. An A row lands with its scenarios
// at 0, gone from the file, and the rest no higher. `MOTION_PARITY_UPDATE=1` lowers it and refuses to raise it.

const RATCHET = 'test/fixtures/motion-trace/ratchet.json', UPDATE = process.env['MOTION_PARITY_UPDATE'] === '1';
const parseRatchet = (text: string): Record<string, number> => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) throw new Error('Bad motion ratchet');
  return Object.fromEntries(Object.entries(value).map(([id, debt]: [string, unknown]) => {
    if (typeof debt !== 'number') throw new Error(`Bad motion ratchet row ${id}`);
    return [id, debt];
  }));
};
const ratchet = parseRatchet(readFileSync(RATCHET, 'utf8'));
const measured = new Map<string, ParityResult>();

const say = (r: ParityResult): string => {
  const first = r.first === null ? '' : `, first at ${r.first.tick}: page ${r.first.page} host ${r.first.host}`;
  return `${r.id}: ${r.failing}/${r.ticks} ticks (${r.overTolerance} over ${TOLERANCE * 100} cm, ${r.flagTicks} flags), worst ${(r.worst * 100).toFixed(1)} cm at ${r.worstTick}${first}`;
};

describe('the server against the page', () => {
  let R: Rapier;
  beforeAll(async () => { R = await loadCourseRapier(); });
  test('every ratchet row is a scenario', () => {
    const ids = new Set(MOTION_SCENARIOS.map(scenario => scenario.id));
    expect(ids.size).toBe(MOTION_SCENARIOS.length);
    expect(Object.keys(ratchet).filter(id => !ids.has(id))).toEqual([]);
  });
  test.each(MOTION_SCENARIOS.map(scenario => [scenario.id, scenario] as const))('%s', (_id, scenario) => {
    const result = runScenario(R, scenario), debt = ratchet[scenario.id] ?? 0;
    measured.set(scenario.id, result);
    expect((scenario.reaches ?? []).filter(what => !result.reached.has(what))).toEqual([]);
    if (UPDATE) return;
    if (result.failing > debt) throw new Error(`Rose from ${debt}. ${say(result)}`);
    if (result.failing < debt) throw new Error(`Fell from ${debt}: lower it with MOTION_PARITY_UPDATE=1. ${say(result)}`);
  });
  afterAll(() => {
    if (!UPDATE) return;
    // a scenario that threw has no row: without this, a crash reads as its debt paid and empties the ratchet
    if (measured.size !== MOTION_SCENARIOS.length) throw new Error(`Measured ${measured.size} of ${MOTION_SCENARIOS.length}: the ratchet stays`);
    const rows = [...measured.values()].filter(r => r.failing > 0).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    process.stderr.write(`${rows.map(say).join('\n')}\n`);
    const rose = rows.filter(r => r.failing > (ratchet[r.id] ?? 0));
    if (rose.length > 0) throw new Error(`The ratchet only falls:\n${rose.map(say).join('\n')}`);
    writeFileSync(RATCHET, `${JSON.stringify(Object.fromEntries(rows.map(r => [r.id, r.failing])), null, 2)}\n`);
  });
});
