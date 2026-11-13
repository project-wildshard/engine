import { expect, it } from 'vitest';
import { CellLoading, type CellLoadingInput, type CellLoadingView } from '../src/client/game/grid/cellLoading';
import { loadingPath } from '../src/client/game/boot/loadingPaths';

// G578, QA 2026-11-13: a waiting grid cell's loading steps show on the loading card inset over the live world
const base: CellLoadingInput = { instance: 'sky-1', slug: 'far-reach', name: 'Sky Reach', refusal: null, product: true, claimedMB: 120,
  requested: true, runtime: true, colliders: false, sim: false, hooks: new Set(['afterWorld', 'afterKit']), hook: 'play', hybrid: true,
  entered: false, gameplayReady: false };
const known = (instance: string): boolean => instance === 'sky-1';

it('draws the waiting cell on its card, rows never stepping back, and hides when it is ready', () => {
  const shown: CellLoadingView[] = [], hidden: boolean[] = [];
  const loading = new CellLoading({ show: (view) => { shown.push(view); }, hide: (entered) => { hidden.push(entered); } }, known);
  loading.step(base);
  const first = shown.at(-1);
  if (first === undefined) throw new Error('The screen did not draw');
  expect(first.name).toBe('Sky Reach'); expect(first.step).toBe('gameplay');
  expect(first.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  expect(first.rows.slice(0, first.rows.findIndex(row => row.state === 'now')).every(row => row.state === 'done')).toBe(true);
  loading.step({ ...base, hooks: new Set(), hook: null }); // a region learns its hooks late: the row holds
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  expect(loading.open).toBe('sky-1');
  loading.step({ ...base, entered: true, gameplayReady: true });
  expect(loading.open).toBe(null); expect(hidden).toEqual([true]);
});

it('shows a refusal instead of the rows, and hides when no cell waits', () => {
  const shown: CellLoadingView[] = [], hidden: boolean[] = [];
  const loading = new CellLoading({ show: (view) => { shown.push(view); }, hide: (entered) => { hidden.push(entered); } }, known);
  loading.step({ ...base, refusal: 'Too big for this device' });
  expect(shown.at(-1)?.failed).toBe('Too big for this device');
  loading.step(null);
  expect(loading.open).toBe(null); expect(hidden).toEqual([false]);
});

it('shows no card for a cell that is not a neighbour, and leaving one is not entering it', () => {
  const shown: CellLoadingView[] = [], hidden: boolean[] = [];
  const loading = new CellLoading({ show: (view) => { shown.push(view); }, hide: (entered) => { hidden.push(entered); } }, known);
  loading.step({ ...base, instance: 'elsewhere' });
  expect(shown).toEqual([]); expect(loading.open).toBe(null);
  loading.step(base); loading.step({ ...base, instance: 'elsewhere' });
  expect(loading.open).toBe(null); expect(hidden).toEqual([false]);
});

it('shows the running hook truthfully once hooks start, even after an earlier guess went further', () => {
  const shown: CellLoadingView[] = [];
  const loading = new CellLoading({ show: (view) => { shown.push(view); }, hide: () => undefined }, known);
  loading.step({ ...base, hybrid: false, runtime: false, hooks: new Set(), hook: null }); // no hooks known yet: reads as gameplay
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe('Gameplay and saved state');
  loading.step({ ...base, hybrid: true, runtime: false, hooks: new Set(), hook: 'world' });
  const world = loadingPath('cell').steps.find(row => row.key === 'world')?.label;
  expect(shown.at(-1)?.rows.find(row => row.state === 'now')?.label).toBe(world);
});
