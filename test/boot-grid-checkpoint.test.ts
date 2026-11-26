// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { bootSignalRoadPlan, bootStoredSave, bootCellCheckpoint, bootCellRoadPlans, verifyBootCellRoad } from '../src/scripts/parity/boot-smoke.mjs';
import type { FloorGridState, FloorGridWitness, FloorGridPlan } from '../src/scripts/frame-floor-grid.mjs';

test('smoke road entries follow the observed lattice without changing local entry points', () => {
  const state = { pitch: 562.5, cells: [
    { instance: 'brasscap', slug: 'brasscap-mesa', cell: [-1, -1] },
    { instance: 'signal', slug: 'sunscar-dunes', cell: [-1, 0] },
  ] };
  const plans = bootCellRoadPlans(state);
  expect(plans.entry.start).toEqual({ x: -843.75, z: -562.5 });
  expect(plans.entry.waypoints).toEqual([{ x: -792.5, z: -562.5 }]);
  expect(plans.exit.waypoints).toEqual([plans.entry.start]);
  expect(bootSignalRoadPlan(state)).toMatchObject({ start: { x: -562.5, z: 281.25 },
    waypoints: [{ x: -562.5, z: 245 }] });
  expect(() => bootCellRoadPlans({ ...state, pitch: 500 })).toThrow('Invalid grid pitch');
  expect(() => bootSignalRoadPlan({ ...state, pitch: Infinity })).toThrow('Invalid grid pitch');
});

const cells = [{ instance: 'home', slug: 'driftwood-isle', cell: [0, 0] as const },
  { instance: 'blender-template', slug: 'brasscap-mesa', cell: [1, 1] as const }];
const key = 'wildshard.save.v2@2.blender-template';
afterEach(() => { localStorage.removeItem(key); });

test('the short Brasscap roundtrip enters from the road and returns by held input without a second pose', () => {
  const { entry, exit } = bootCellRoadPlans({ cells });
  expect(entry).toMatchObject({ from: null, to: 'blender-template', start: { x: 277.5, z: 555 }, requiredResidents: ['blender-template'] });
  expect(exit).toMatchObject({ from: 'blender-template', to: null, waypoints: [entry.start] });
  expect(exit.start).toBeUndefined();
  for (const plan of [entry, exit]) expect(plan.movement).toBe('road-hover');
});

test.each([null, {}, { cells: [] }, { cells: [{ ...cells[1], cell: [1.5, 0] }] },
  { cells: [{ instance: '', slug: 'brasscap-mesa', cell: [0, 1] }] }])('missing or malformed Brasscap inventory refuses: %j', state => {
  expect(() => bootCellRoadPlans(state)).toThrow();
});

function save(data: unknown) { localStorage.setItem(key, JSON.stringify({ keys: { 'platform.region': { v: 1, data } } })); }
const exact = { revision: 1, integrity: 123, mode: 'exact', snapshot: '{"version":4}', logical: null };
test('durable Brasscap evidence requires the real namespace and a complete checkpoint envelope', () => {
  expect(() => bootCellCheckpoint('blender-template')).toThrow('no durable checkpoint');
  for (const data of [null, {}, { ...exact, integrity: -1 }, { ...exact, snapshot: '' }, { ...exact, revision: 0 }]) {
    save(data); expect(() => bootCellCheckpoint('blender-template')).toThrow('invalid durable checkpoint');
  }
  save(exact);
  expect(bootCellCheckpoint('blender-template')).toMatchObject({ instance: 'blender-template', mode: 'exact', revision: 1, integrity: 123, snapshotCharacters: 13 });
});

test("a server's own document is durable Brasscap evidence too", () => {
  const document = (data: unknown): string => JSON.stringify({ keys: { continuation: { v: 1, data } } });
  expect(bootCellCheckpoint('blender-template', document({ tick: 40, snapshot: '{"version":4}' }))).toMatchObject({ instance: 'blender-template', mode: 'exact', revision: 40, snapshotCharacters: 13 });
  for (const data of [null, {}, { tick: -1, snapshot: 'x' }, { tick: 1, snapshot: '' }]) expect(() => bootCellCheckpoint('blender-template', document(data))).toThrow('invalid durable checkpoint');
  expect(() => bootCellCheckpoint('blender-template', null)).toThrow('no durable checkpoint');
});

/** The two calls `bootStoredSave` makes of IndexedDB, over a row table. */
function serverRows(rows: Readonly<Record<string, string>>) {
  const answer = <T>(result: T, then: (request: { result: T; onsuccess: (() => void) | null }) => void = () => undefined) => {
    const request = { result, onsuccess: null as (() => void) | null };
    then(request); queueMicrotask(() => { request.onsuccess?.(); });
    return request;
  };
  const database = { objectStoreNames: { contains: (name: string) => name === 'saves' }, close: () => undefined,
    transaction: () => ({ objectStore: () => ({ get: (name: string) => answer(rows[name]) }) }) };
  // WR8b: the checkpoint reader opens the current epoch's database by name, never an earlier one.
  vi.stubGlobal('indexedDB', { databases: () => Promise.resolve([{ name: 'wildshard-saves@2' }]), open: (name: string) => { if (name !== 'wildshard-saves@2') throw new Error(`opened ${name}`); return answer(database); } });
}

test("a page's location document never hides the server's checkpoint", async () => {
  const served = (tick: number): string => JSON.stringify({ keys: { continuation: { v: 1, data: { tick, snapshot: '{"version":4}' } } } });
  localStorage.setItem(key, JSON.stringify({ keys: { 'platform.grid-position': { v: 1, data: { instance: 'blender-template' } } } }));
  serverRows({ 'wildshard.save.v2@2.standalone-blender-template': served(40), 'wildshard.save.v2@2.standalonealt-blender-template': served(60) });
  try {
    expect(bootCellCheckpoint('blender-template', await bootStoredSave('blender-template'))).toMatchObject({ mode: 'exact', revision: 60 });
    serverRows({}); // No server wrote yet: the page's document answers, and is no checkpoint.
    expect(() => { bootCellCheckpoint('blender-template'); }).toThrow('invalid durable checkpoint');
    expect(await bootStoredSave('blender-template')).toBe(localStorage.getItem(key));
  } finally { vi.unstubAllGlobals(); }
});

function witness(plan: FloorGridPlan, beforeCount: number): FloorGridWitness {
  const at = (current: string | null, count: number): FloorGridState => ({ home: 'home', inside: current, cells,
    live: { crossing: { phase: 'settled', issue: null }, live: { current, crossings: count, gameplayReady: true,
      residents: current === null ? [] : [current], worldFeet: { x: current === null ? 277.5 : 310, y: 0.5, z: 555 },
      transitions: [{ from: plan.from, to: plan.to }] } } });
  return { plan, before: at(plan.from, beforeCount), after: at(plan.to, beforeCount + 1), elapsedSeconds: 1,
    trace: [{ seconds: 0.5, x: 290, y: 0.5, z: 555, current: plan.from, gameplayReady: true }] };
}
test('prepared-only, uncommitted, wrong-owner or missing durable Brasscap proof cannot pass', () => {
  const plans = bootCellRoadPlans({ cells }); save(exact);
  const entry = witness(plans.entry, 0), exit = witness(plans.exit, 1), checkpoint = bootCellCheckpoint('blender-template');
  expect(() => verifyBootCellRoad({ entry, exit, checkpoint })).not.toThrow();
  expect(() => verifyBootCellRoad({ entry, exit, checkpoint: { ...checkpoint, instance: 'other' } })).toThrow('does not match');
  const noCommit = { ...exit, after: { ...exit.after, live: { ...exit.after.live, live: { ...exit.after.live.live, crossings: 1 } } } };
  expect(() => verifyBootCellRoad({ entry, exit: noCommit, checkpoint })).toThrow('frame commits');
  const prepared = { ...entry, after: entry.before };
  expect(() => verifyBootCellRoad({ entry: prepared, exit, checkpoint })).toThrow('Destination interior');
});
