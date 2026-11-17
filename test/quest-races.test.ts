// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { DeclaredQuests } from '../src/shared/game/quest/declared';
import { raceStartLine } from '../src/shared/game/quest/raceWire';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const CAP = 2;
const data = { flags: ['run.go', 'run.end'], quests: [], triggers: [], dialogue: [],
  races: [{ id: 'arch', start: 'run.go', stop: 'run.end', fact: 'arch.time', cap: CAP }] };
const steps = (host: ReturnType<typeof createSimHost>, n: number): void => { for (let i = 0; i < n; i++) host.step(); };
const owned = (host: ReturnType<typeof createSimHost>, player: string): Map<string, number> => {
  const out = new Map<string, number>(); shardRows(host).owned.get('quest.races')?.(player, out); return out;
};

test('a race files its fact with the time between its flags, keeps the best and runs again', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier }), filed: [string, string][] = [];
  try {
    const quests = new DeclaredQuests(host, data, { fact: (name, entity) => { filed.push([name, entity]); } });
    const { flags, player: lead } = questBooks(host).lead;
    flags.set('run.go'); const started = host.state.tick;
    expect(owned(host, lead).get('race:arch')).toBe(raceStartLine(started)); // the wire carries the running start tick
    steps(host, 30); flags.set('run.end');
    expect(filed).toEqual([['arch.time', 'arch']]);
    expect(quests.race('arch', lead)).toEqual({ running: null, last: 30 * FIXED_STEP, best: 30 * FIXED_STEP, runs: 1 });
    expect(owned(host, lead).has('race:arch')).toBe(false);
    expect(owned(host, lead).get('race:arch.best')).toBe(Math.round(30 * FIXED_STEP * 1000));
    expect(owned(host, lead).get('race:arch.runs')).toBe(1);
    // the finish lowers both flags, so the run can be run again; a slower run keeps the best
    expect(flags.has('run.go') || flags.has('run.end')).toBe(false);
    flags.set('run.go'); steps(host, 50); flags.set('run.end');
    expect(quests.race('arch', lead)).toEqual({ running: null, last: 50 * FIXED_STEP, best: 30 * FIXED_STEP, runs: 2 });
    flags.set('run.go'); steps(host, 10); flags.set('run.end');
    expect(quests.race('arch', lead)?.best).toBe(10 * FIXED_STEP);
  } finally { host.dispose(); }
});

test('a run past its cap lapses and files nothing; each player runs their own', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier }), filed: [string, string][] = [];
  try {
    host.addPlayer('other', { x: 0, y: 0, z: 0 });
    const quests = new DeclaredQuests(host, data, { fact: (name, entity) => { filed.push([name, entity]); } });
    const { flags: lead, player: leadId } = questBooks(host).lead, other = questBooks(host).of('other').flags;
    lead.set('run.go'); other.set('run.go');
    steps(host, Math.ceil(CAP / FIXED_STEP) + 2);
    expect(quests.race('arch', leadId)?.running).toBeNull();
    expect(lead.has('run.go')).toBe(false); // a lapse lowers the start so the run can begin again
    lead.set('run.end');
    expect(filed).toEqual([]);
    expect(quests.race('arch', leadId)).toEqual({ running: null, last: null, best: null, runs: 0 });
    other.set('run.go'); steps(host, 5); other.set('run.end');
    expect(filed).toEqual([['arch.time', 'other:arch']]);
    expect(quests.race('arch', 'other')?.best).toBe(5 * FIXED_STEP);
    expect(quests.race('arch', leadId)?.best).toBeNull();
  } finally { host.dispose(); }
});

test('a running race and its best ride the save', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  try {
    host.addPlayer('other', { x: 0, y: 0, z: 0 });
    const quests = new DeclaredQuests(host, data, { fact: () => undefined });
    const books = questBooks(host), other = books.of('other').flags;
    other.set('run.go'); steps(host, 4); other.set('run.end'); other.set('run.go');
    const saved = books.exportOf('other'), running = quests.race('arch', 'other')?.running;
    other.set('run.end');
    books.importOf('other', saved);
    expect(quests.race('arch', 'other')).toEqual({ running, last: 4 * FIXED_STEP, best: 4 * FIXED_STEP, runs: 1 });
  } finally { host.dispose(); }
});

test('the lead\'s running race rides a region save and finishes after the restore, as an unbroken run does', async () => {
  const loaded = await rapier, host = createSimHost(SIM_LEVEL, { rapier: loaded }), filed: [string, string][] = [];
  let restored: ReturnType<typeof createSimHost> | undefined;
  try {
    new DeclaredQuests(host, data, { fact: () => undefined });
    questBooks(host).lead.flags.set('run.go'); const started = host.state.tick; steps(host, 6);
    const saved = decodeSimSnapshot(JSON.parse(serializeSimSnapshot(snapshotSimHost(host))));
    let again: DeclaredQuests | undefined;
    restored = restoreSimHost(SIM_LEVEL, { rapier: loaded }, saved, fresh => { again = new DeclaredQuests(fresh, data, { fact: (name, entity) => { filed.push([name, entity]); } }); });
    const { flags, player } = questBooks(restored).lead;
    expect(again?.race('arch', player)?.running).toBe(started);
    steps(restored, 4); flags.set('run.end');
    expect(filed).toEqual([['arch.time', 'arch']]);
    expect(again?.race('arch', player)).toEqual({ running: null, last: 10 * FIXED_STEP, best: 10 * FIXED_STEP, runs: 1 });
    expect(flags.has('run.go')).toBe(false);
  } finally { restored?.dispose(); host.dispose(); }
});

test('a run carried to a younger room keeps its elapsed time, not the old room\'s tick', async () => {
  const loaded = await rapier, old = createSimHost(SIM_LEVEL, { rapier: loaded }), young = createSimHost(SIM_LEVEL, { rapier: loaded });
  try {
    for (const host of [old, young]) host.addPlayer('other', { x: 0, y: 0, z: 0 });
    new DeclaredQuests(old, data, { fact: () => undefined });
    const filed: [string, string][] = [], quests = new DeclaredQuests(young, data, { fact: (name, entity) => { filed.push([name, entity]); } });
    steps(old, 500); questBooks(old).of('other').flags.set('run.go'); steps(old, 20);
    const saved = questBooks(old).exportOf('other');
    questBooks(young).importOf('other', saved);
    steps(young, 10); questBooks(young).of('other').flags.set('run.end');
    expect(quests.race('arch', 'other')).toEqual({ running: null, last: 30 * FIXED_STEP, best: 30 * FIXED_STEP, runs: 1 });
    expect(filed).toEqual([['arch.time', 'other:arch']]);
    questBooks(young).importOf('other', questBooks(young).exportOf('other')); // the save reads back
  } finally { young.dispose(); old.dispose(); }
});
