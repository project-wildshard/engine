// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CellLoading, type CellLoadingInput } from './cellLoading';
import { CellLoadingCard } from './cellScreens';

// QA 2026-11-13 (Jake: "make it look the same as the one for Shard Select"): a neighbour cell's preparation mounts SHARD
// SELECT's loading card, inset over the live world; entering the cell completes and removes it, leaving removes it at once.
const base: CellLoadingInput = { instance: 'plot-1', slug: 'open-plots', name: 'Open Plot', refusal: null, product: true, claimedMB: 40,
  requested: true, runtime: true, colliders: false, sim: false, hooks: new Set(['afterWorld', 'afterKit', 'afterPlay']), hook: null,
  hybrid: true, entered: false, gameplayReady: false };
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.ws-load')];
let loading: CellLoading;
beforeEach(() => {
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport here */ }
    disconnect(): void { /* no observer work */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
  loading = new CellLoading(new CellLoadingCard(), () => true);
});
afterEach(() => { loading.close(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('mounts the Shard Select card, inset, on preparation start and steps it', () => {
  expect(cards()).toEqual([]);
  loading.step(base);
  const [card] = cards();
  if (card === undefined) throw new Error('No card mounted');
  expect(cards()).toHaveLength(1);
  expect(card.dataset['inset']).toBe('');
  expect(card.querySelector('.ws-load-panel')).not.toBeNull();
  expect(card.querySelector('[data-el="slug"]')?.textContent).toBe('Open Plot');
  expect(card.dataset['path']).toBe('cell');
  expect(card.dataset['step']).toBe('colliders');
  // it draws over the live world: the page is not marked covered (the world keeps drawing, the HUD stays)
  expect(document.documentElement.dataset['wsCovered']).toBeUndefined();
  loading.step({ ...base, colliders: true, sim: true });
  expect(cards()).toHaveLength(1); expect(card.dataset['step']).toBe('enter');
});

it('unmounts when the cell is entered', async () => {
  loading.step(base);
  loading.step({ ...base, colliders: true, sim: true, entered: true, gameplayReady: true });
  expect(loading.open).toBe(null);
  await vi.waitFor(() => { expect(cards()).toEqual([]); }, { timeout: 3000 });
});

it('a new cell card ends the last card fade at once', () => {
  loading.step(base);
  loading.step({ ...base, colliders: true, sim: true, entered: true, gameplayReady: true });
  loading.step({ ...base, instance: 'plot-2', name: 'Second Plot' });
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.querySelector('[data-el="slug"]')?.textContent).toBe('Second Plot');
});

it('unmounts at once when the traveller leaves or the preparation is cancelled', () => {
  loading.step(base);
  loading.step(null);
  expect(cards()).toEqual([]);
  loading.step(base);
  loading.close();
  expect(cards()).toEqual([]);
});

it('a refused cell keeps its reason on the card', () => {
  loading.step({ ...base, refusal: 'Too big for this device' });
  expect(cards()[0]?.dataset['failed']).toBe('true');
  expect(cards()[0]?.querySelector('[data-el="foot"]')?.textContent).toBe('Too big for this device');
});
