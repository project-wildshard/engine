import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the defining recovery installer with native event ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Only erase types from the actual installer, never copy its state machine.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolate navigation and GPU ports without constructing a renderer.
import { runInNewContext } from 'node:vm';
import { Scope } from '../../../shared/engine/app/scope';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let finish = (): void => { throw new Error('Missing completion'); };
  let fail = (_error: Error): void => { throw new Error('Missing completion'); };
  const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}
const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); });

function fixture(stored = false, leaveSaved: (go: () => void) => void = go => { go(); }) {
  const source = readFileSync(new URL('GpuRecovery.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export function installGpuRecovery('), end = source.indexOf('\n/**', start);
  if (start === -1 || end < start) throw new Error('Missing recovery installer');
  const owner = new Scope('gpu-test'); owners.push(owner);
  let wiped = false, contextLost = false;
  const canvas = new EventTarget(), win = new EventTarget(), doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible', createElement: () => ({ width: 0, height: 0, getContext: () => ({
      fillStyle: '', fillRect: (): void => undefined,
      getImageData: () => ({ data: wiped ? [0, 0, 0, 0] : [255, 0, 255, 255] }),
    }) }),
  });
  const compile = deferred(), firstFrame = deferred();
  const storage = new Map<string, string>(stored ? [['boot.selfReload', '1']] : []);
  const navigations: string[] = [], faults: unknown[] = [], restores: Promise<void>[] = [];
  const rebuild = vi.fn(), beforeReload = vi.fn(() => true);
  const game = { levelScope: owner, canvas, hold: false,
    renderer: { domElement: canvas, getContext: () => ({ isContextLost: () => contextLost }) },
    firstFrame: () => firstFrame.promise, kickLoop: vi.fn(),
  };
  // Observe only the event callback's returned promise; its actual state machine
  // and every native failure/retirement check execute unchanged.
  const installer = source.slice(start, end).replace('export function', 'function')
    .replace('void restore();', 'observeRestore(restore());');
  const install: unknown = runInNewContext(stripTypeScriptTypes(`${installer}\ninstallGpuRecovery`), {
    URL, Event, document: doc, window: win, RELOAD_KEY: 'boot.selfReload', RELOAD_PARAM: 'glreload',
    savedStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
    location: { origin: 'https://example.test', href: 'https://example.test/?shard=test&v=old', replace: (url: string) => { navigations.push(url); } },
    performance: { now: () => 0 }, console: { warn: (): void => undefined },
    precompileLevel: () => compile.promise, gpuOnlyContent: () => [], rebakeGpuContent: vi.fn(), terrainDatum: () => 4,
    observeRestore: (promise: Promise<void>) => { restores.push(promise); },
    recordGpuRecovery: vi.fn(), markReload: vi.fn(), leaveSaved, emitFault: (fault: unknown) => { faults.push(fault); }, repaint: vi.fn(),
  });
  if (typeof install !== 'function') throw new Error('Recovery installer is not callable');
  Reflect.apply(install, undefined, [{ game, rebuild, beforeReload, pose: () => ({ x: 1, y: 6, z: 3, yaw: 0, pitch: 0 }) }]);
  const lose = (): void => { contextLost = true; canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); };
  const restore = (): Promise<void> => {
    contextLost = false; canvas.dispatchEvent(new Event('webglcontextrestored'));
    const running = restores.at(-1); if (running === undefined) throw new Error('Restore not started');
    return running;
  };
  return { owner, game, compile, firstFrame, storage, navigations, faults, rebuild, beforeReload, lose, restore,
    wipe: () => { wiped = true; },
    hide: () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('time cannot reload a lost context or reveal a pending real restore', async () => {
  vi.useFakeTimers(); const f = fixture();
  f.lose(); expect(f.game.hold).toBe(true);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(f.navigations).toEqual([]); expect(f.owner.census.timers).toBe(0);
  const restored = f.restore(); await vi.advanceTimersByTimeAsync(600_000);
  expect(f.game.hold).toBe(true); expect(f.rebuild).not.toHaveBeenCalled();
  f.compile.resolve(); await vi.advanceTimersByTimeAsync(600_000); expect(f.rebuild).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(600_000); expect(f.game.hold).toBe(true);
  f.firstFrame.resolve(); await restored; expect(f.game.hold).toBe(false);
  expect(f.navigations).toEqual([]); expect(f.owner.census.timers).toBe(0);
});

test('confirmed restore failure spends the shared session retry and preserves the saved pose', async () => {
  const f = fixture(); f.lose(); const restored = f.restore();
  f.compile.reject(new Error('Native link failed')); await restored;
  expect(f.navigations).toHaveLength(1); expect(f.storage.get('boot.selfReload')).toBe('1');
  const url = new URL(f.navigations[0] ?? '');
  expect(url.searchParams.get('at')).toBe('1,2,3,0,0'); expect(url.searchParams.get('glreload')).toBe('1');
  expect(url.searchParams.has('v')).toBe(false); expect(f.beforeReload).toHaveBeenCalledWith('gpu');
  await f.restore(); expect(f.navigations).toHaveLength(1);
});

test('a recovery reload waits for a held session\'s save', async () => {
  let left = (): void => undefined;
  const f = fixture(false, go => { left = go; }); f.lose(); const restored = f.restore();
  f.compile.reject(new Error('Native link failed')); await restored;
  expect(f.navigations, 'the save is out').toEqual([]);
  left(); expect(f.navigations).toHaveLength(1);
});

test('a wiped canvas after the shared retry reports the real fault without another automatic navigation', () => {
  const f = fixture(true); f.wipe(); f.lose();
  expect(f.navigations).toEqual([]); expect(f.game.hold).toBe(true);
  // the loss itself is reported (QA 2026-11-13 row 6), then the one fatal fault that opens the card
  expect(f.faults.map(fault => String(Reflect.get(fault as object, 'verdict')))).toEqual(['retry', 'fatal']);
});

test('a context lost in front of the player reaches Sentry; one lost behind a hidden page does not (QA 2026-11-13 row 6)', () => {
  const shown = fixture(); shown.lose();
  expect(shown.faults).toHaveLength(1);
  expect(String(Reflect.get(Reflect.get(shown.faults[0] as object, 'error') as object, 'message'))).toMatch(/^WebGL context lost \(context lost\)/u);
  const behind = fixture(); behind.hide(); behind.lose();
  expect(behind.faults).toEqual([]);
});

test('retiring an in-flight restore prevents rebuild and publication', async () => {
  const f = fixture(); f.lose(); const restored = f.restore(); f.owner.dispose();
  f.compile.resolve(); await restored;
  expect(f.rebuild).not.toHaveBeenCalled(); expect(f.navigations).toEqual([]);
  expect(f.owner.census.listeners).toBe(0); expect(f.owner.census.timers).toBe(0);
});
