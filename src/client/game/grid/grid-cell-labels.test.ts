import { expect, test } from 'vitest';
import { CellLoading, type CellLoadingInput } from './cellLoading';
import type { CellScreenView } from './cellScreens';

test('an actual hook corrects an inferred row and warm-up names its own work', () => {
  const shown: CellScreenView[] = [];
  const screen = new CellLoading({ show: (_edge, _cell, _ground, view) => { shown.push(view); }, hide: () => undefined },
    () => ({ edge: { instance: 'target', x: 256, z: 0, axis: 'x', halfLength: 256 }, cell: { x: 0, z: 0 }, ground: 0 }));
  const initial: CellLoadingInput = { instance: 'target', slug: 'far-reach', name: 'Sky Reach', refusal: null,
    product: true, claimedMB: 226, requested: true, runtime: false, colliders: false, sim: false,
    hooks: new Set(), hook: null, hybrid: false, entered: false, gameplayReady: false };
  const now = (): string | undefined => shown.at(-1)?.rows.find(row => row.state === 'now')?.label;
  screen.step(initial);
  screen.step({ ...initial, hybrid: true, hook: 'world' });
  expect(now()).toBe('Region world');
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
});
