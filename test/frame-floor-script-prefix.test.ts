import { expect, test, vi } from 'vitest';
import { startPrefixScriptProfile, type ScriptProfilePort } from '../scripts/frame-floor-script-profile.mjs';
import { validateFrameFloorArgs } from '../scripts/frame-floor-args.mjs';

function fixture(refuseStop = false) {
  const methods: string[] = [];
  const listeners = new Map<string, (value: unknown) => void>();
  const inspector: ScriptProfilePort = {
    send: method => {
      methods.push(method);
      if (method === 'ScriptProfiler.stopTracking') {
        if (refuseStop) return Promise.reject(new Error('Profile refused'));
        listeners.get('ScriptProfiler.trackingComplete')?.({ samples: 'bounded' });
      }
      return Promise.resolve({});
    },
    on: (method, listener) => { listeners.set(method, listener); return () => { listeners.delete(method); }; },
  };
  return { inspector, methods, listeners, evaluate: (): Promise<unknown> => Promise.resolve(Date.now()) };
}

test('stops at twenty seconds while the caller continues, then cleanup does not stop twice', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const saved: unknown[] = [];
    const f = fixture(), finish = await startPrefixScriptProfile(f.inspector, f.evaluate, capture => { saved.push(capture); });
    await vi.advanceTimersByTimeAsync(19999);
    expect(f.methods).not.toContain('ScriptProfiler.stopTracking');
    await vi.advanceTimersByTimeAsync(1);
    expect(f.methods.filter(method => method === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(saved).toEqual([{profile: {samples: 'bounded'}, pageRange: {startMs: 1000, endMs: 21000}}]);
    await vi.advanceTimersByTimeAsync(40000); // the unchanged drive can continue after recording ended
    const results = await Promise.all([finish(), finish()]);
    expect(results).toEqual([
      {profile: {samples: 'bounded'}, pageRange: {startMs: 1000, endMs: 21000}},
      {profile: {samples: 'bounded'}, pageRange: {startMs: 1000, endMs: 21000}},
    ]);
    expect(f.methods.filter(method => method === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('early cleanup stops once and retains its shorter window', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(), finish = await startPrefixScriptProfile(f.inspector, f.evaluate);
    await vi.advanceTimersByTimeAsync(230);
    expect((await finish()).pageRange).toEqual({startMs: 1000, endMs: 1230});
    expect(f.methods.filter(method => method === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('observes an auto-stop refusal immediately and rethrows it at original drive cleanup', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(true), finish = await startPrefixScriptProfile(f.inspector, f.evaluate);
    await vi.advanceTimersByTimeAsync(20000);
    await expect(finish()).rejects.toThrow('Profile refused');
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('an invalid page clock retires recording before installing a deadline', async () => {
  const f = fixture();
  await expect(startPrefixScriptProfile(f.inspector, () => Promise.resolve('unknown'))).rejects.toThrow('start clock');
  expect(f.methods.filter(method => method === 'ScriptProfiler.stopTracking')).toHaveLength(1);
  expect(f.listeners.size).toBe(0);
});

test('prefix selection requires its own Simulator grid profile window', () => {
  const args = ['--surface=sim', '--shards=grid', '--grid-scenario=runtime-travel', '--safari-profile=tmp/profile', '--safari-prefix=nalati-interior'];
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  expect(() => validateFrameFloorArgs(['--worker', ...args])).not.toThrow();
  expect(() => validateFrameFloorArgs([...args, '--safari-drive=nalati-interior'])).toThrow('prefix');
  expect(() => validateFrameFloorArgs([...args, '--quiet'])).toThrow('prefix');
  expect(() => validateFrameFloorArgs(['--surface=sim', '--safari-prefix=nalati-interior'])).toThrow('prefix');
  expect(() => validateFrameFloorArgs(['--surface=desktop', '--safari-prefix=nalati-interior'])).toThrow('prefix');
});
