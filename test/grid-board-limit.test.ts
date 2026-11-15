// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { CHUNK_HALF, CONTENT_CAPS, ROAD_WIDTH } from '@wildshard/engine/core/config';
import { createSimHost, type SimHost, type SimLevel } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { GridSimulation } from '../src/server/game/grid/simulation';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { findShard } from '../src/client/game/shard/registry';
import { gridBoardLimitAt } from '../src/shared/game/grid/rules';
import { hoverSpeed } from '../src/shared/engine/player/hoverSpeed';

// P1-E5.3-A10: the server's board reads the grid's cap as the page does, from world feet, wherever the seat's host keeps them.
const level: SimLevel = { ...SIM_LEVEL, entities: [], ground: { size: 3000, height: 0 } };
const STRIP = (CONTENT_CAPS.pitch - CHUNK_HALF * 2 - ROAD_WIDTH) / 2, disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

async function gridOn(): Promise<{ grid: GridSimulation; assembly: GridAssembly; highway: SimHost; instance: string }> {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cells.find(row => row.speedClass === undefined);
  if (cell === undefined) throw new Error('Missing cell');
  const highway = createSimHost(level, { rapier });
  const grid = new GridSimulation(assembly, { highway: { host: highway, dispose: () => { highway.dispose(); } },
    load: () => { const host = createSimHost(level, { rapier }); return Promise.resolve({ host, dispose: () => { host.dispose(); } }); } });
  disposers.push(() => { grid.dispose(); });
  return { grid, assembly, highway, instance: cell.instance };
}
const limitAt = (host: SimHost): number => {
  const read = leadPlayer(host).hoverSpeedLimit;
  if (read === null) throw new Error('No board limit');
  return read();
};

test('a seat on the highway takes the cap from where it stands in the world', async () => {
  const { grid, assembly, highway } = await gridOn(), cell = assembly.cells.find(row => row.speedClass === undefined), lead = leadPlayer(highway);
  if (cell === undefined) throw new Error('Missing cell');
  expect(lead.hoverSpeedLimit).toBeNull();
  grid.step();
  const stand = (x: number, y: number): void => { lead.position.set(cell.origin.x + x, y, cell.origin.z); };
  stand(0, 0); expect(limitAt(highway)).toBe(14);
  stand(CHUNK_HALF + STRIP + 1, 0); expect(limitAt(highway)).toBe(30);
  stand(CHUNK_HALF + STRIP + 1, 6); expect(limitAt(highway)).toBe(14); // over the deck, not on it
  stand(CHUNK_HALF + STRIP / 2, 0); expect(limitAt(highway)).toBeCloseTo(22, 5);
});

test('a resident seat finds its own cell from world feet: raw cell-local feet would name the cell at the origin', async () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), cell = assembly.cells.find(row => row.speedClass === 'road' && (row.cell[0] !== 0 || row.cell[1] !== 0));
  if (cell === undefined) throw new Error('Need a road cell away from the origin');
  const { grid } = await gridOn();
  await grid.enter(cell.instance);
  grid.step();
  const host = grid.host(), lead = leadPlayer(host);
  lead.position.set(0, 0, 0);
  expect(limitAt(host)).toBe(30);
});

test('a road-class cell keeps 30 m/s across its interior', async () => {
  const { grid, assembly, highway } = await gridOn(), cell = assembly.cells.find(row => row.speedClass === 'road'), lead = leadPlayer(highway);
  if (cell === undefined) throw new Error('Missing road cell');
  grid.step();
  lead.position.set(cell.origin.x, 0, cell.origin.z);
  expect(limitAt(highway)).toBe(30);
});

test('a placement says road exactly where its shard does: the server reads no manifest', async () => {
  await import('./fixtures/shardList');
  for (const cell of new GridAssembly({ developer: false, devserver: false }).cells) {
    const manifest = findShard(cell.slug);
    if (manifest === undefined) throw new Error(`No manifest for ${cell.slug}`);
    expect([cell.slug, cell.speedClass]).toEqual([cell.slug, manifest.hoverSpeedClass === 'road' ? 'road' : undefined]);
  }
});

test('QA 11-15 row 8: one world-feet read for every host, off the origin and in a road-class cell', () => {
  const pitch = CONTENT_CAPS.pitch, deck = CHUNK_HALF + STRIP + ROAD_WIDTH / 2;
  const grid = { pitch, cells: [{ cell: [0, 0] as const }, { cell: [-1, 0] as const }, { cell: [2, 1] as const, speedClass: 'road' as const }] };
  expect(gridBoardLimitAt(grid, { x: -pitch + 100, y: 1, z: 30 })).toBe(14); // inside [-1, 0]
  expect(gridBoardLimitAt(grid, { x: -deck, y: 0.5, z: 120 })).toBe(30); // the deck between [0, 0] and [-1, 0]
  expect(gridBoardLimitAt(grid, { x: -deck, y: 6, z: 120 })).toBe(14); // over the deck, off it
  expect(gridBoardLimitAt(grid, { x: 2 * pitch + 10, y: 1, z: pitch - 40 })).toBe(30); // a road-class cell's interior
  const strip = gridBoardLimitAt(grid, { x: -pitch + CHUNK_HALF + STRIP / 2, y: 1, z: 0 }); // [-1, 0]'s east strip
  expect(strip).toBeGreaterThan(14); expect(strip).toBeLessThan(30);
  expect(hoverSpeed(14, true)).toBe(56); expect(hoverSpeed(30, true)).toBe(120); // G540, road 4x (Jake 11-15)
});

test('QA 11-15 row 8: a room stepping its own world (the in-page server\'s road) caps the board as stepAll does', async () => {
  const { grid, assembly, highway } = await gridOn(), cell = assembly.cells.find(row => row.speedClass === undefined), lead = leadPlayer(highway);
  if (cell === undefined) throw new Error('Missing cell');
  expect(lead.hoverSpeedLimit).toBeNull();
  grid.stepSite(null, new Map());
  lead.position.set(cell.origin.x + CHUNK_HALF + STRIP + 1, 0, cell.origin.z);
  expect(limitAt(highway), 'the deck: 30 m/s, not the uncapped 14').toBe(30);
});
