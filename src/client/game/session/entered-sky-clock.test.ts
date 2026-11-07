import { expect, test, vi } from 'vitest';
import { App } from '@wildshard/engine/app/app';
import { Scope } from '@wildshard/engine/app/scope';
import { DayCycle } from '@wildshard/engine/world/dayCycle';
import { createSettings, overrideSetting } from '@wildshard/engine/ui/Settings';
import { enterSkyClock, publishSkyClock, skyClockOf } from './clockSettings';

const clock = (): DayCycle => new DayCycle({ units: 'hour', start: 13, sun: { maxElevation: 60, azimuthOffset: 0 },
  schedule: [{ phase: 'day', from: 0, to: 24, minutes: 12 }],
  fixed: { midday: 12, golden: 17, sunset: 18, night: 22 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 22 } });

/** A page level with its own clock and one grid cell: the cell's runtime holds its region's world, where its sky publishes. */
function page() {
  const app = new App(), level = new Scope('level'), cell = level.child('grid.runtime:cell'), world = cell.child('grid.world:cell');
  const runtime = cell.child('runtime:cell'), pageClock = clock(), skyClock = clock();
  app.levelScope = level; app.registerDayCycle(pageClock, level);
  return { app, level, cell, world, runtime, pageClock, skyClock };
}

test('an entered runtime\'s sky clock is the day cycle until it leaves; re-entry finds it again, unreset', async () => {
  const p = page();
  try {
    publishSkyClock(p.world, p.skyClock);
    expect(p.app.dayCycle).toBe(p.pageClock);
    const first = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime, p.cell], first);
    expect(p.app.dayCycle).toBe(p.skyClock);
    await p.skyClock.set(7.5); const held = p.skyClock.snapshot();
    first.dispose();
    expect(p.app.dayCycle).toBe(p.pageClock);
    const second = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime, p.cell], second);
    expect(p.app.dayCycle).toBe(p.skyClock); expect(p.skyClock.snapshot()).toEqual(held);
    second.dispose();
    expect(p.app.dayCycle).toBe(p.pageClock);
  } finally { p.level.dispose(); }
});

test('Settings > Time turns the entered sky only while entered, and each re-entry binds it again once', () => {
  const p = page(), time = vi.spyOn(p.skyClock, 'setTime');
  try {
    publishSkyClock(p.runtime, p.skyClock);
    const entered = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime], entered);
    expect(time).not.toHaveBeenCalled();
    overrideSetting('time', 'golden'); expect(time).toHaveBeenCalledOnce();
    entered.dispose();
    overrideSetting('time', 'night'); expect(time).toHaveBeenCalledOnce();
    const again = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime], again);
    overrideSetting('time', 'midday'); expect(time).toHaveBeenCalledTimes(2);
    again.dispose();
    overrideSetting('time', 'golden'); expect(time).toHaveBeenCalledTimes(2);
  } finally { time.mockRestore(); overrideSetting('time', null); p.level.dispose(); }
});

test('a runtime with no sky of its own leaves the level clock as the day cycle', () => {
  const p = page();
  try {
    const entered = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime, p.cell], entered);
    expect(p.app.dayCycle).toBe(p.pageClock);
    // a sky built after the entry is read when it is published
    publishSkyClock(p.world, p.skyClock);
    expect(p.app.dayCycle).toBe(p.skyClock);
    p.world.dispose();
    expect(p.app.dayCycle).toBe(p.pageClock); expect(skyClockOf([p.cell])).toBeNull();
  } finally { p.level.dispose(); }
});

test('the nearest sky wins: a runtime\'s own over an ancestor\'s, never a sibling cell\'s', () => {
  const p = page(), other = p.level.child('grid.runtime:other'), otherClock = clock(), levelSky = clock();
  try {
    publishSkyClock(other, otherClock);
    expect(skyClockOf([p.runtime, p.cell])).toBeNull();
    publishSkyClock(p.level, levelSky);
    expect(skyClockOf([p.runtime])).toBe(levelSky);
    publishSkyClock(p.runtime, p.skyClock);
    expect(skyClockOf([p.runtime])).toBe(p.skyClock);
  } finally { p.level.dispose(); }
});


test('a late sky receives the selected time once on first use without resetting its continuation', async () => {
  const p = page(), time = vi.spyOn(p.skyClock, 'setTime');
  const settings = createSettings({ getItem: () => null, setItem: () => undefined }, () => '');
  settings.overrideSetting('time', 'night');
  try {
    const entered = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime, p.cell], entered, settings);
    expect(p.app.dayCycle).toBe(p.pageClock); expect(time).not.toHaveBeenCalled();
    publishSkyClock(p.world, p.skyClock);
    expect(p.app.dayCycle).toBe(p.skyClock); expect(time).toHaveBeenCalledExactlyOnceWith('night');
    await p.skyClock.set(7.5); const held = p.skyClock.snapshot();
    expect(p.app.dayCycle).toBe(p.skyClock); expect(p.skyClock.snapshot()).toEqual(held); expect(time).toHaveBeenCalledOnce();
    entered.dispose(); expect(p.app.dayCycle).toBe(p.pageClock);
  } finally { time.mockRestore(); overrideSetting('time', null); p.level.dispose(); }
});

test('a Developer time picked before a sky is built reaches it when it is published after the entry', () => {
  const p = page(), time = vi.spyOn(p.skyClock, 'setTime');
  const settings = { setting: () => 'night' as const, onSettingChange: () => () => undefined };
  try {
    const entered = p.runtime.child('runtime.entered');
    enterSkyClock(p.app, [p.runtime, p.cell], entered, settings);
    expect(time).not.toHaveBeenCalled();
    publishSkyClock(p.runtime, p.skyClock);
    expect(time).toHaveBeenCalledExactlyOnceWith('night');
    expect(p.app.dayCycle).toBe(p.skyClock);
    entered.dispose();
    const later = clock(), lateTime = vi.spyOn(later, 'setTime');
    publishSkyClock(p.world, later);
    expect(lateTime).not.toHaveBeenCalled();
  } finally { time.mockRestore(); p.level.dispose(); }
});
