import { expect, test } from 'vitest';
import { RangedAction, type RangedCycleEvent } from '../src/shared/engine/combat/Firearm';
import { LeverAction, type LeverHooks } from './fixtures/weapon-oracle/leverBridge';
import { LeverAction as OriginalAction } from './fixtures/weapon-oracle/leverAction';

type Action = Pick<OriginalAction, 'tube' | 'chambered' | 'caseInChamber' | 'hammerCocked' | 'phase' | 'phaseT' |
  'fed' | 'planned' | 'stopAfter' | 'dryAtStart' | 'reloadProgress' | 'store' | 'rounds' | 'cycleU' | 'wantsAutoReload' |
  'dropHammer' | 'throwLever' | 'triggerWhileReloading' | 'beginReload'>;
function saved(a: Action) {
  return { tube: a.tube, chambered: a.chambered, caseInChamber: a.caseInChamber, hammerCocked: a.hammerCocked,
    phase: a.phase, phaseT: a.phaseT, fed: a.fed, planned: a.planned, stopAfter: a.stopAfter, dryAtStart: a.dryAtStart,
    reloadProgress: a.reloadProgress, reserve: a.store.reserve };
}
function observer(a: Action, into: unknown[], interrupt: () => boolean): LeverHooks {
  const record = (event: RangedCycleEvent) => () => {
    into.push({ event, ...saved(a), rounds: a.rounds, cycleU: a.cycleU });
    if (event === 'round' && interrupt()) a.triggerWhileReloading();
  };
  return { cycle: record('cycle'), eject: record('eject'), chambered: record('chambered'), reloadStart: record('reloadStart'), round: record('round'), reloadEnd: record('reloadEnd') };
}

test('per-round host matches the old action, event-boundary observations, interruption and saved continuation', () => {
  let actual = new LeverAction({ reserve: 21 });
  const original = new OriginalAction({ reserve: 21 }), oldEvents: unknown[] = [], events: unknown[] = [];
  let interrupt = false;
  const oldHooks = observer(original, oldEvents, () => interrupt);
  let hooks = observer(actual, events, () => interrupt);
  const deltas = [1 / 60, 0.12, 0.56, 0.4, 0.05, 1.3, 0.001, 0.22];
  for (let frame = 0; frame < 2000; frame++) {
    interrupt = frame % 7 === 0;
    for (const action of [original, actual]) {
      if (frame % 11 === 0 && action.phase === 'idle' && action.chambered) action.dropHammer();
      if (frame % 17 === 0) action.beginReload();
      if (frame % 13 === 0) action.triggerWhileReloading();
      if (action.phase === 'idle' && !action.chambered && action.tube > 0) action.throwLever();
      if (frame % 101 === 0) action.store.reserve += 3;
    }
    const dt = deltas[frame % deltas.length];
    if (dt === undefined) throw new Error('Missing test delta');
    original.step(dt, original.wantsAutoReload, oldHooks);
    actual.step(dt, actual.wantsAutoReload, hooks);
    expect(saved(actual)).toEqual(saved(original));
    expect(actual.rounds).toBe(original.rounds);
    expect(actual.cycleU).toBe(original.cycleU);
    expect(events).toEqual(oldEvents); events.length = 0; oldEvents.length = 0;
    if (frame % 113 === 0) {
      const { reserve, ...wire } = saved(actual);
      actual = Object.assign(new LeverAction({ reserve }), structuredClone(wire));
      hooks = observer(actual, events, () => interrupt);
    }
  }
});

test('data-only cycle events suspend at the old callback phase and reject invalid coefficients', () => {
  const row = { magazine: 7, reload: 0.4, reloadIn: 0.22, cycleDelay: 0.12, cycleTime: 0.56, ejectAt: 1 / 3, cockAt: 0.2 };
  const action = new RangedAction.Cycle({ reserve: 21 }, row);
  action.tube = 0; action.chambered = false;
  expect(action.beginReload()).toBe(true);
  const step = action.events(2, false);
  expect(action.fed).toBe(0);
  expect(step.next().value).toBe('round');
  expect(action.fed).toBe(1);
  action.triggerWhileReloading();
  expect(step.next().value).toBe('reloadEnd');
  expect(action.phase).toBe('idle');
  expect(step.next().value).toBe('cycle');
  expect(action.phase).toBe('cycle');
  expect(step.next().done).toBe(true);
  expect(() => new RangedAction.Cycle({ reserve: 21 }, { ...row, reload: 86400 })).not.toThrow();
  for (const invalid of [{ ...row, reload: 0 }, { ...row, reload: 86401 }, { ...row, cycleTime: Number.NaN }, { ...row, cockAt: 2 }, { ...row, magazine: 1.5 }]) {
    expect(() => new RangedAction.Cycle({ reserve: 21 }, invalid)).toThrow('Invalid ranged cycle row');
  }
});
