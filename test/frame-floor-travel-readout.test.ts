import {afterEach, expect, test, vi} from 'vitest';
import {driveFloorGrid, gridFloorWitnessFailures, type FloorGridPlan, type FloorGridState} from '../scripts/frame-floor-grid.mjs';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Reflect.defineProperty(globalThis, 'window', originalWindow);
});

function fixture(compact: boolean) {
  let frame: (() => void) | null = null, stopped = 0, fullReads = 0, travelReads = 0;
  let current: string | null = 'home', inside: string | null = 'home', ready = true;
  let phase = 'idle', issue: string | null = null;
  const input = {clear: vi.fn(), setHeld: vi.fn()}, limit = () => 20;
  const player = {hover: false, hoverSpeedLimit: limit, setHover(value: boolean): void { this.hover = value; }};
  const live = () => ({live: {current, worldFeet: {x: 0, y: 0, z: current === 'pine' ? 562.5 : current === null ? 281.25 : 0}, crossings: current === 'home' ? 0 : current === null ? 1 : 2,
    transitions: current === 'home' ? [] : current === null ? [{from: 'home', to: null}] : [{from: 'home', to: null}, {from: null, to: 'pine'}],
    residents: ['home', 'pine'], gameplayReady: ready, pending: ready ? [] : ['pine']}, crossing: {phase, issue}});
  const state = (): FloorGridState => {
    fullReads++;
    return {home: 'home', inside, pitch: 562.5, cells: [{instance: 'home', slug: 'home', cell: [0, 0]},
      {instance: 'pine', slug: 'pine', cell: [0, 1]}], live: live()};
  };
  const travelState = () => { travelReads++; return {inside, live: live()}; };
  const grid = {state, residency: () => ({claims: []}), ...(compact ? {travelState} : {})};
  const game = {app: {input}, camera: {position: {y: 1.7}}, watchFrames: (read: () => void) => {
    frame = read; return () => { frame = null; stopped++; };
  }};
  const api = {world: {game, player}, shard: {grid}};
  vi.stubGlobal('window', {__wildshard: api});
  const plan: FloorGridPlan = {name: 'same-original-route', from: 'home', to: 'pine', waypoints: [], requiredResidents: ['home', 'pine']};
  return {plan, player, limit, api, input, counts: () => ({fullReads, travelReads, stopped}),
    step(next: {current?: string | null; inside?: string | null; ready?: boolean; phase?: string; issue?: string} = {}): void {
      if ('current' in next) current = next.current ?? null;
      if ('inside' in next) inside = next.inside ?? null;
      if (next.ready !== undefined) ready = next.ready;
      if (next.phase !== undefined) phase = next.phase;
      if (next.issue !== undefined) issue = next.issue;
      if (frame === null) throw new Error('Route observer is not active');
      frame();
    }};
}

for (const compact of [false, true]) {
  test(`${compact ? 'compact' : 'historical'} readout preserves readiness, inside and full final witnesses`, async () => {
    const f = fixture(compact), result = driveFloorGrid(f.plan, performance.timeOrigin);
    let finished = false; void result.then(() => { finished = true; return undefined; });
    f.step({current: null, inside: null, ready: false});
    f.step({current: 'pine', inside: 'pine', ready: false}); await Promise.resolve(); expect(finished).toBe(false);
    f.step({inside: null, ready: true}); await Promise.resolve(); expect(finished).toBe(false);
    f.step({inside: 'pine'});
    const witness = await result;
    expect(gridFloorWitnessFailures(witness)).toEqual([]);
    expect(witness.before.cells).toHaveLength(2); expect(witness.after.cells).toHaveLength(2);
    expect(f.counts()).toEqual({fullReads: compact ? 3 : 7, travelReads: compact ? 4 : 0, stopped: 1});
    expect(f.player.hoverSpeedLimit).toBe(f.limit); expect(f.player.hover).toBe(false);
  });
}

for (const phase of ['blocked', 'save-failed']) {
  test(`compact readout still refuses ${phase} and restores input/hover`, async () => {
    const f = fixture(true), result = driveFloorGrid(f.plan, performance.timeOrigin);
    f.step({phase, issue: 'original refusal'});
    await expect(result).rejects.toThrow('Grid floor crossing blocked: original refusal');
    expect(f.counts().stopped).toBe(1); expect(f.player.hoverSpeedLimit).toBe(f.limit); expect(f.player.hover).toBe(false);
    expect(f.input.clear).toHaveBeenCalled();
  });
}

test('compact readout cannot mask replaced document/API identity', async () => {
  const f = fixture(true), result = driveFloorGrid(f.plan, performance.timeOrigin);
  vi.stubGlobal('window', {__wildshard: {...f.api}});
  f.step();
  await expect(result).rejects.toThrow('Grid floor document or API changed during travel');
  expect(f.counts().travelReads).toBe(0); expect(f.player.hoverSpeedLimit).toBe(f.limit);
});

test('malformed compact telemetry refuses instead of falling back to a full view', async () => {
  const f = fixture(true), result = driveFloorGrid(f.plan, performance.timeOrigin);
  Reflect.set(f.api.shard.grid, 'travelState', () => null);
  f.step();
  await expect(result).rejects.toThrow('Grid live telemetry missing');
  expect(f.counts().fullReads).toBe(2); expect(f.player.hoverSpeedLimit).toBe(f.limit);
});
