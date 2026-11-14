import { expect, test } from 'vitest';
import { CellLoading, type CellLoadingInput, type CellLoadingView } from './cellLoading';

test('an actual hook corrects an inferred row and warm-up names its own work', () => {
  const shown: CellLoadingView[] = [];
  const screen = new CellLoading({ show: (view) => { shown.push(view); }, hide: () => undefined }, () => true);
  const initial: CellLoadingInput = { instance: 'target', slug: 'far-reach', name: 'Sky Reach', refusal: null,
    product: true, claimedMB: 226, requested: true, runtime: false, colliders: false, sim: false,
    hooks: new Set(), hook: null, hybrid: false, entered: false, gameplayReady: false };
  const now = (): string | undefined => shown.at(-1)?.rows.find(row => row.state === 'now')?.label;
  screen.step(initial);
  screen.step({ ...initial, hybrid: true, hook: 'world' });
  expect(now()).toBe('Region world');
  expect(screen.stage).toBe('Region world'); // NET-LAG NL7: what a proof times
  screen.step({ ...initial, hybrid: true, hook: 'kit', hooks: new Set(['afterWorld']) });
  expect(now()).toBe('Equipment and HUD');
  screen.step({ ...initial, hybrid: true, hook: 'afterPlay', hooks: new Set(['afterWorld', 'afterKit']),
    warm: { phase: 'parked-draws', completed: false, progress: { done: 12, total: 458, detail: '12 / 458 scene draws warmed' } } });
  expect(now()).toBe('Entry warm-up'); expect(shown.at(-1)?.detail).toBe('Warm scene draws · 12 / 458 scene draws warmed');
  expect(shown.at(-1)?.rows.find(row => row.label === 'Colliders and simulation')?.state).toBe('next');
  screen.step({ ...initial, hybrid: true, runtime: true, hooks: new Set(['afterWorld', 'afterKit', 'afterPlay']) });
  expect(now()).toBe('Colliders and simulation');
  screen.step({ ...initial, hybrid: true, runtime: true, colliders: true, sim: true,
    hooks: new Set(['afterWorld', 'afterKit', 'afterPlay']) });
  expect(now()).toBe('Enter the cell');
  expect(screen.stage).toBe('Enter the cell');
  screen.step({ ...initial, hybrid: true, runtime: true, colliders: true, sim: true, entered: true, gameplayReady: true,
    hooks: new Set(['afterWorld', 'afterKit', 'afterPlay']) });
  expect(screen.stage).toBeNull();
});

test('GC8: the step the screen shows is readable while it is open, and null once it closes', () => {
  const screen = new CellLoading({ show: () => undefined, hide: () => undefined }, () => true);
  const input: CellLoadingInput = { instance: 'target', slug: 'pine-hollow', name: 'Pine Hollow', refusal: null,
    product: true, claimedMB: 120, requested: true, runtime: true, colliders: false, sim: true,
    hooks: new Set(), hook: null, hybrid: false, entered: false, gameplayReady: false };
  expect(screen.now).toBeNull();
  screen.step(input);
  expect(screen.now).toEqual({ step: 'colliders', detail: 'colliders · simulation ready' });
  screen.step({ ...input, colliders: true, entered: true, gameplayReady: true });
  expect(screen.now).toBeNull();
});
