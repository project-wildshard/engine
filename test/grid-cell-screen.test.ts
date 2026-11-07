import { expect, it } from 'vitest';
import { CellLoading, type CellLoadingInput, type CellScreenPlace } from '../src/client/game/grid/cellLoading';
import { facingEdge, type CellScreenView } from '../src/client/game/grid/cellScreens';
import { loadingPath } from '../src/client/game/boot/loadingPaths';

// G578: a waiting grid cell's loading steps show on its in-world screen, never the full-screen loader
const base: CellLoadingInput = { instance: 'sky-1', slug: 'far-reach', name: 'Sky Reach', refusal: null, product: true, claimedMB: 120,
  requested: true, runtime: true, colliders: false, sim: false, hooks: new Set(['afterWorld', 'afterKit']), hook: 'play', hybrid: true,
  entered: false, gameplayReady: false };
const place: CellScreenPlace = { edge: { instance: 'sky-1', x: 255, z: 0, axis: 'x', halfLength: 256 }, cell: { x: 0, z: 0 }, ground: 0 };

it('draws the waiting cell on its edge screen, rows never stepping back, and hides when it is ready', () => {
  const shown: CellScreenView[] = []; let hidden = 0;
  const loading = new CellLoading({ show: (_edge, _cell, _ground, view) => { shown.push(view); }, hide: () => { hidden++; } }, () => place);
  loading.step(base);
  const first = shown.at(-1);
  if (first === undefined) throw new Error('The screen did not draw');
  expect(first.name).toBe('Sky Reach');
  expect(first.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  expect(first.rows.slice(0, first.rows.findIndex(row => row.state === 'now')).every(row => row.state === 'done')).toBe(true);
  loading.step({ ...base, hooks: new Set(), hook: null }); // a region learns its hooks late: the row holds
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  expect(loading.open).toBe('sky-1');
  loading.step({ ...base, entered: true, gameplayReady: true });
  expect(loading.open).toBe(null); expect(hidden).toBeGreaterThan(0);
});

it('shows a refusal instead of the rows, and hides when no cell waits', () => {
  const shown: CellScreenView[] = []; let hidden = 0;
  const loading = new CellLoading({ show: (_edge, _cell, _ground, view) => { shown.push(view); }, hide: () => { hidden++; } }, () => place);
  loading.step({ ...base, refusal: 'Too big for this device' });
  expect(shown.at(-1)?.failed).toBe('Too big for this device');
  loading.step(null);
  expect(loading.open).toBe(null); expect(hidden).toBeGreaterThan(0);
});

it('faces the traveller from the side they stand on, and the +x side from the very centre', () => {
  const centre = { x: 512, z: 0 }, sides = [{ x: 773, z: 0, axis: 'x' as const }, { x: 251, z: 0, axis: 'x' as const },
    { x: 512, z: 261, axis: 'z' as const }, { x: 512, z: -261, axis: 'z' as const }];
  expect(facingEdge(sides, centre, -300, 20)).toBe(sides[1]);
  expect(facingEdge(sides, centre, 10, 300)).toBe(sides[2]);
  expect(facingEdge(sides, centre, 0, -5)).toBe(sides[3]);
  expect(facingEdge(sides, centre, 0, 0)).toBe(sides[0]); // entered but not ready: the screen still stands
});

it('shows the running hook truthfully once hooks start, even after an earlier guess went further', () => {
  const shown: CellScreenView[] = [];
  const loading = new CellLoading({ show: (_edge, _cell, _ground, view) => { shown.push(view); }, hide: () => undefined }, () => place);
  loading.step({ ...base, hybrid: false, runtime: false, hooks: new Set(), hook: null }); // no hooks known yet: reads as gameplay
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  loading.step({ ...base, hybrid: true, runtime: false, hooks: new Set(), hook: 'world' });
  const world = loadingPath('cell').steps.find(row => row.key === 'world')?.label;
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe(world);
});
