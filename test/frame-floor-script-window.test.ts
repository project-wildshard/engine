import { expect, test, vi } from 'vitest';
import { startDriveWindowScriptProfile, type ScriptProfilePort } from '../scripts/frame-floor-script-profile.mjs';
import { parseSafariWindow, validateFrameFloorArgs } from '../scripts/frame-floor-args.mjs';

function fixture(refuseStop = false) {
  const methods: string[] = [], listeners = new Map<string, (value: unknown) => void>();
  const inspector: ScriptProfilePort = {
    send: method => {
      methods.push(method);
      if (method === 'ScriptProfiler.stopTracking') {
        if (refuseStop) return Promise.reject(new Error('Stop refused'));
        listeners.get('ScriptProfiler.trackingComplete')?.({ samples: 'window' });
      }
      return Promise.resolve({});
    },
    on: (method, listener) => { listeners.set(method, listener); return () => { listeners.delete(method); }; },
  };
  return { inspector, methods, listeners, evaluate: (): Promise<unknown> => Promise.resolve(Date.now()) };
}

test('records only seconds fourteen through sixteen and persists before the drive finishes', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(), saved: unknown[] = [];
    const finish = await startDriveWindowScriptProfile(f.inspector, f.evaluate, 1000, 14000, 16000, capture => { saved.push(capture); });
    await vi.advanceTimersByTimeAsync(13999);
    expect(f.methods).not.toContain('ScriptProfiler.startTracking');
    await vi.advanceTimersByTimeAsync(1);
    expect(f.methods.filter(m => m === 'ScriptProfiler.startTracking')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.methods).not.toContain('ScriptProfiler.stopTracking');
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ profile: { samples: 'window' }, pageRange: { startMs: 15000, endMs: 17000 } }]);
    await vi.advanceTimersByTimeAsync(40000);
    expect(await finish()).toEqual(saved[0]);
    expect(await finish()).toEqual(saved[0]);
    expect(f.methods.filter(m => m === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('early drive cleanup cancels an unstarted window without opening a recorder', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(), finish = await startDriveWindowScriptProfile(f.inspector, f.evaluate, 1000, 14000, 16000);
    await vi.advanceTimersByTimeAsync(500);
    expect(await finish()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.methods).not.toContain('ScriptProfiler.startTracking');
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('cleanup during the selected window stops once with its shorter actual range', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(), finish = await startDriveWindowScriptProfile(f.inspector, f.evaluate, 1000, 14000, 16000);
    await vi.advanceTimersByTimeAsync(14500);
    expect((await finish())?.pageRange).toEqual({ startMs: 15000, endMs: 15500 });
    expect(f.methods.filter(m => m === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('slow protocol startup shortens sampling without moving the absolute end', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(), saved: unknown[] = [];
    const inspector: ScriptProfilePort = { ...f.inspector, send: async (method, params) => {
      if (method === 'ScriptProfiler.startTracking') await new Promise(resolve => { setTimeout(resolve, 500); });
      return f.inspector.send(method, params);
    } };
    const finish = await startDriveWindowScriptProfile(inspector, f.evaluate, 1000, 14000, 16000, capture => { saved.push(capture); });
    await vi.advanceTimersByTimeAsync(16000);
    expect(saved).toEqual([{ profile: { samples: 'window' }, pageRange: { startMs: 15500, endMs: 17000 } }]);
    expect(await finish()).toEqual(saved[0]);
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('a stop refusal is observed at the bounded deadline and propagated on cleanup', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture(true), finish = await startDriveWindowScriptProfile(f.inspector, f.evaluate, 1000, 14000, 16000);
    await vi.advanceTimersByTimeAsync(16000);
    await expect(finish()).rejects.toThrow('Stop refused');
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('startup after the end deadline retires tracking and refuses the late window', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  try {
    const f = fixture();
    const inspector: ScriptProfilePort = { ...f.inspector, send: async (method, params) => {
      if (method === 'ScriptProfiler.startTracking') await new Promise(resolve => { setTimeout(resolve, 3000); });
      return f.inspector.send(method, params);
    } };
    const finish = await startDriveWindowScriptProfile(inspector, f.evaluate, 1000, 14000, 16000);
    await vi.advanceTimersByTimeAsync(17000);
    await expect(finish()).rejects.toThrow('missed its end clock');
    expect(f.methods.filter(m => m === 'ScriptProfiler.stopTracking')).toHaveLength(1);
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('refuses an expired window rather than starting a later sample', async () => {
  const f = fixture();
  await expect(startDriveWindowScriptProfile(f.inspector, () => Promise.resolve(18000), 1000, 14000, 16000)).rejects.toThrow('live drive clock');
  expect(f.methods).not.toContain('ScriptProfiler.startTracking');
});

test('admits one quiet floor window and refuses ambiguous or unbounded selections', () => {
  const args = ['--surface=sim', '--quiet', '--shards=grid', '--grid-scenario=all', '--safari-profile=tmp/profile', '--safari-window=nalati-interior:14:16'];
  expect(parseSafariWindow('nalati-interior:14:16')).toEqual({ route: 'nalati-interior', fromMs: 14000, toMs: 16000 });
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  expect(() => validateFrameFloorArgs(['--worker', ...args])).not.toThrow();
  for (const value of ['nalati-interior:16:14', 'nalati-interior:0:121', 'nalati-interior:1:22', 'nalati-interior:NaN:16', 'nalati-interior']) {
    expect(parseSafariWindow(value)).toBeNull();
    expect(() => validateFrameFloorArgs([...args.slice(0, -1), `--safari-window=${value}`])).toThrow('window');
  }
  for (const extra of ['--safari-prefix=nalati-interior', '--safari-steady=grid-nalati-interior', '--safari-drive=nalati-interior', '--wasm-constructors=tmp/native', '--webkit-timeline=tmp/timeline', '--safari-window=pine-interior:14:16'])
    expect(() => validateFrameFloorArgs([...args, extra])).toThrow('window');
});
