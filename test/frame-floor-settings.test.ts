import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- execute the serialized Safari init in isolated storage contexts
import { runInNewContext } from 'node:vm';
import { frameFloorSettingsCode, resetFrameFloorDebug, assertFrameFloorFixture, frameFloorBootstrapHtml, frameFloorGameNavigationCode, traceFrameFloorFixtureWrites } from '../scripts/frame-floor-settings.mjs';
import { saveFixtureCode } from '../scripts/debug-settings.mjs';
import { validateFrameFloorArgs } from '../scripts/frame-floor-args.mjs';

test('quiet requires one explicit Simulator surface before any build', () => {
  expect(() => validateFrameFloorArgs(['--surface=sim', '--quiet'])).not.toThrow();
  for (const flags of [[], ['--surface=both'], ['--surface=desktop'],
    ['--surface=sim', '--surface=desktop'], ['--surface=sim', '--surface=sim']]) {
    expect(() => validateFrameFloorArgs([...flags, '--quiet'])).toThrow('require --surface=sim');
  }
  expect(() => validateFrameFloorArgs(['--surface=both'])).not.toThrow();
  expect(() => validateFrameFloorArgs(['--quiet=1', '--surface=sim'])).toThrow('Unknown');
});

test('raw WebKit capture requires an explicit Simulator surface', () => {
  expect(() => validateFrameFloorArgs(['--surface=sim', '--webkit-timeline=tmp/trace'])).not.toThrow();
  for (const surface of ['', '--surface=both', '--surface=desktop']) {
    expect(() => validateFrameFloorArgs([...(surface === '' ? [] : [surface]), '--webkit-timeline=tmp/trace']))
      .toThrow('require --surface=sim');
  }
});

function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}
function read(saved: Pick<Storage, 'getItem'>, scope: string): unknown {
  return JSON.parse(saved.getItem(`wildshard.save.v2.${scope}`) ?? '{}') as unknown;
}

test('isolates successive Safari picks and clears omitted core and shard Debug rows', () => {
  const localStorage = storage(), sessionStorage = storage();
  localStorage.setItem('wildshard.save.v2.global', JSON.stringify({ reset: 2, keys: {
    settings: { v: 1, data: { graphMaterials: 'on', weather: 'rain' } }, hints: { v: 1, data: ['keep'] },
  } }));
  localStorage.setItem('wildshard.save.v2.device', JSON.stringify({ keys: {
    'debug.gridBootPrograms': { v: 1, data: 'pine-hollow' },
    'debug.plugin.pine-hollow.ring': { v: 1, data: 'on' }, devMode: { v: 1, data: true },
  } }));
  sessionStorage.setItem('wildshard.save.v2.session', JSON.stringify({ keys: {
    'debug.future': { v: 1, data: 'on' }, continuation: { v: 1, data: { score: 42 } },
  } }));
  const context = { localStorage, sessionStorage };
  runInNewContext(frameFloorSettingsCode({ graphMaterials: 'on', tier: 'phone', fps: 'auto' }), context);
  runInNewContext(frameFloorSettingsCode({ fixedShadowSamples: 'off', tier: 'phone', fps: 'auto' }), context);
  expect(read(localStorage, 'global')).toEqual({ reset: 2, keys: {
    settings: { v: 1, data: { fixedShadowSamples: 'off', tier: 'phone', fps: 'auto' } }, hints: { v: 1, data: ['keep'] },
  } });
  expect(read(localStorage, 'device')).toEqual({ keys: { devMode: { v: 1, data: true } } });
  expect(read(sessionStorage, 'session')).toEqual({ keys: { continuation: { v: 1, data: { score: 42 } } } });
});

test('refuses a reset when Safari storage cannot be written', () => {
  const localStorage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
  expect(() => { runInNewContext(`(${resetFrameFloorDebug.toString()})()`, { localStorage }); }).toThrow('blocked');
});

test('cold Safari HTML prepares and verifies every fixture without booting the game', () => {
  const localStorage = storage(), sessionStorage = storage();
  const settings = { tier: 'phone', fps: 'auto' };
  const code = [frameFloorSettingsCode(settings),
    saveFixtureCode({ scope: 'device', key: 'devMode', data: true }),
    saveFixtureCode({ scope: 'device', key: 'floor.test', data: 'on' })].join(';');
  const check = `(${assertFrameFloorFixture.toString()})(${JSON.stringify(settings)},true,{"floor.test":"on"})`;
  const html = frameFloorBootstrapHtml(code, check);
  const script = /<script>([\s\S]*)<\/script>/u.exec(html)?.[1];
  if (script === undefined) throw new Error('Missing preparation script');
  const window: { __frameFloorBootstrapReady?: boolean } = {};
  runInNewContext(script, { localStorage, sessionStorage, window });
  expect(window.__frameFloorBootstrapReady).toBe(true);
  expect(read(localStorage, 'global')).toEqual({ keys: { settings: { v: 1, data: settings } } });
  expect(read(localStorage, 'device')).toEqual({ keys: {
    devMode: { v: 1, data: true }, 'floor.test': { v: 1, data: 'on' },
  } });
});

test('refuses a silent fixture write failure before admitting the game document', () => {
  const localStorage = storage(), sessionStorage = storage();
  const settings = { tier: 'phone', fps: 'auto' };
  runInNewContext(frameFloorSettingsCode(settings), { localStorage, sessionStorage });
  const check = `(${assertFrameFloorFixture.toString()})(${JSON.stringify(settings)},true,{})`;
  expect(() => { runInNewContext(check, { localStorage }); }).toThrow('did not retain');
  runInNewContext(saveFixtureCode({ scope: 'device', key: 'devMode', data: true }), { localStorage });
  expect(() => { runInNewContext(check, { localStorage }); }).not.toThrow();
  expect(() => { runInNewContext(`(${assertFrameFloorFixture.toString()})(${JSON.stringify(settings)},true,{"missing":"on"})`, { localStorage }); }).toThrow('did not retain');
});

test('acknowledges Safari preparation before navigating its existing context', () => {
  vi.useFakeTimers();
  const saved = storage(), destinations: string[] = [];
  const settings = { tier: 'phone', fps: 'auto' };
  const context = { localStorage: saved, sessionStorage: storage(),
    location: { replace: (url: string) => { destinations.push(url); } }, setTimeout };
  try {
    runInNewContext(frameFloorSettingsCode(settings), context);
    runInNewContext(saveFixtureCode({ scope: 'device', key: 'devMode', data: true }), context);
    const url = 'http://127.0.0.1:4456/frame-floor-safari.html?chunk=open-plot-clockwork-canyon&mute=1';
    // The Inspector evaluator serializes one expression, not a statement list.
    expect(runInNewContext(`JSON.stringify((${frameFloorGameNavigationCode(url)}))`, context)).toBe('true');
    expect(destinations).toEqual([]);
    vi.advanceTimersByTime(99);
    expect(destinations).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(destinations).toEqual([url]);
    expect(read(saved, 'global')).toEqual({ keys: { settings: { v: 1, data: settings } } });
    expect(read(saved, 'device')).toEqual({ keys: { devMode: { v: 1, data: true } } });
  } finally { vi.useRealTimers(); }
});

test('fixture provenance identifies deletion, bounds records and restores native methods', () => {
  class MemoryStorage {
    private readonly data = new Map<string, string>();
    getItem(key: string): string | null { return this.data.get(key) ?? null; }
    setItem(key: string, value: string): void { this.data.set(key, value); }
    removeItem(key: string): void { this.data.delete(key); }
    externalRemove(key: string): void { this.data.delete(key); }
    clear(): void { this.data.clear(); }
  }
  const localStorage = new MemoryStorage(), nativeSet = Object.getOwnPropertyDescriptor(MemoryStorage.prototype, 'setItem')?.value;
  const window = new EventTarget(), context = { Storage: MemoryStorage, localStorage, window, URL, performance: { now: () => 7 } };
  runInNewContext(`(${traceFrameFloorFixtureWrites.toString()})()`, context);
  localStorage.setItem('wildshard.save.v2.global', JSON.stringify({ keys: { settings: { v: 1, data: { tier: 'phone' } } } }));
  localStorage.setItem('player.secret', 'never retained');
  localStorage.removeItem('wildshard.save.v2.global');
  localStorage.setItem('wildshard.save.v2.global', '{"keys":{"settings":{"v":1,"data":{}}}}');
  localStorage.externalRemove('wildshard.save.v2.global');
  expect(localStorage.getItem('wildshard.save.v2.global')).toBeNull();
  window.dispatchEvent(Object.assign(new Event('storage'), { storageArea: localStorage,
    key: 'wildshard.save.v2.global', url: 'http://localhost/other.html?private=never-retained' }));
  for (let i = 0; i < 80; i++) localStorage.setItem('wildshard.save.v2.device', '{"keys":{}}');
  const result: unknown = runInNewContext('window.__frameFloorFixtureWrites.finish()', context);
  expect(result).toMatchObject({ final: { settings: false }, restored: true });
  expect(runInNewContext('window.__frameFloorFixtureWrites.finish().rows', context)).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'getItem-transition', state: expect.objectContaining({ settings: false }) }),
    expect.objectContaining({ operation: 'storage-event', sourcePath: '/other.html' }),
  ]));
  expect(runInNewContext('window.__frameFloorFixtureWrites.finish().rows.slice(0,3)', context)).toMatchObject([
    { operation: 'before-fixture', state: { settings: false } },
    { operation: 'setItem', state: { settings: true } },
    { operation: 'removeItem', state: { settings: false } },
  ]);
  expect(JSON.stringify(result)).not.toContain('player.secret');
  expect(JSON.stringify(result)).not.toContain('never retained');
  expect(JSON.stringify(result)).not.toContain('never-retained');
  expect(runInNewContext('window.__frameFloorFixtureWrites.finish().rows.length', context)).toBe(64);
  expect(Object.getOwnPropertyDescriptor(MemoryStorage.prototype, 'setItem')?.value).toBe(nativeSet);
  expect(localStorage.getItem('player.secret')).toBe('never retained');
});
