import { expect, test } from 'vitest';
import { cellLoadingStep, type CellLoadingInput } from '../src/client/game/grid/cellLoading';
import { loadingPath } from '../src/client/game/boot/loadingPaths';

const base: CellLoadingInput = { instance: 'pine-hollow', slug: 'pine-hollow', name: 'Pine Hollow', refusal: null, product: false,
  claimedMB: 0, requested: true, runtime: false, colliders: false, sim: false, hooks: new Set(), hook: null, hybrid: true,
  entered: false, gameplayReady: false };
const key = (input: Partial<CellLoadingInput>): string => { const step = cellLoadingStep({ ...base, ...input }); return step.kind === 'step' ? step.key : step.kind; };

test('G555: a cell entry walks the retained path on its live readiness', () => {
  const steps = loadingPath('cell').steps.map(row => row.key);
  expect(steps).toEqual(['world', 'loadout', 'gameplay', 'warm', 'colliders', 'enter']);
  expect(key({})).toBe('world');
  expect(cellLoadingStep(base)).toEqual({kind:'step',key:'world',detail:'reading its region files'});
  expect(cellLoadingStep({...base,requested:false})).toEqual({kind:'step',key:'world',detail:'requested as you approach'});
  expect(key({ product: true, hook: 'world' })).toBe('world');
  expect(key({ product: true, hooks: new Set(['afterWorld']) })).toBe('loadout');
  expect(key({ product: true, hooks: new Set(['afterWorld', 'afterKit']) })).toBe('gameplay');
  const hooked = new Set(['afterWorld', 'afterKit', 'afterPlay']);
  expect(key({ product: true, hooks: hooked, runtime: true })).toBe('colliders');
  expect(key({ product: true, hooks: hooked, runtime: true, colliders: true, sim: true })).toBe('enter');
  expect(key({ product: true, hooks: hooked, runtime: true, colliders: true, sim: true, entered: true, hook: 'activate' })).toBe('enter');
  expect(key({ product: true, hooks: hooked, runtime: true, colliders: true, sim: true, entered: true, gameplayReady: true })).toBe('done');
  // a bodyless declared region has no hooks: its world, equipment and gameplay rows pass on its runtime fence
  expect(key({ product: true, hybrid: false, runtime: true })).toBe('colliders');
});

test('G555: a refused cell shows why on the same screen, never a short-form card', () => {
  const step = cellLoadingStep({ ...base, refusal: 'Too big for this device' });
  expect(step).toEqual({ kind: 'failed', reason: 'Too big for this device' });
});

test('entered warm-up reports its actual work while afterPlay has not returned', () => {
  const waiting = { ...base, product: true, hooks: new Set(['afterWorld', 'afterKit']), hook: 'afterPlay' };
  const warm = { completed: false, phase: 'shader-links', progress: { done: 12, total: 40, detail: '12 / 40 programs linked' } };
  expect(cellLoadingStep({ ...waiting, warm })).toEqual({ kind: 'step', key: 'warm', detail: 'Link shaders · 12 / 40 programs linked' });
  expect(cellLoadingStep({ ...waiting, warm: { ...warm, phase: 'parked-draws', progress: { done: 5, total: 18, detail: '5 / 18 scene draws warmed' } } }))
    .toEqual({ kind: 'step', key: 'warm', detail: 'Warm scene draws · 5 / 18 scene draws warmed' });
  expect(cellLoadingStep({ ...waiting, warm: { ...warm, completed: true } })).toEqual({ kind: 'step', key: 'warm', detail: 'Entry warm-up complete' });
  expect(key({ ...waiting, hook: 'world', hooks: new Set(), warm })).toBe('world');
  expect(key({ ...waiting, warm, refusal: 'Unavailable' })).toBe('failed');
  expect(key({ ...waiting, warm, entered: true, gameplayReady: true })).toBe('done');
});

test('QA 11-13 row 43: a cell not building shows its world step, never a past visit\'s hooks as saved state', () => {
  // Jake on staging: a return visit's hooks had all finished, the world was let go, and nothing was building it again:
  // the card read "Gameplay and saved state · saved state and its systems" with no progress for 11.6 s
  const visited = { ...base, product: true, requested: false, hooks: new Set(['afterWorld', 'afterKit', 'afterPlay']) };
  expect(cellLoadingStep(visited)).toEqual({ kind: 'step', key: 'world', detail: 'waiting for its world to start' });
  expect(key({ ...visited, hybrid: false })).toBe('world');
});
