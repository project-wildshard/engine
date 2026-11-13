import { expect, test, vi } from 'vitest';
import { cleanDevice, DEVICE_WORD_MAX_BYTES, deviceBrowser, deviceLine, deviceTags, encodeDeviceWord, readDeviceWord, worldReadsDevice } from '../../../shared/engine/net/deviceWord';
import { applySentryDevice, collectDevice, gpuFacts } from './deviceSnapshot';

// DEVICE-TELEMETRY DT1 to DT4 (meta docs/plans/DEVICE-TELEMETRY-PLAN.md): the snapshot, its bounds, its Sentry tags and the door's line.
const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const encode = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer;

test('no browser APIs at all: the build alone, and no throw', async () => {
  expect(await collectDevice({ build: 'b1' })).toEqual({ build: 'b1' });
  expect(await collectDevice({})).toEqual({});
});

test('getters that throw and a hint request that rejects give partial data, never a throw', async () => {
  const hostile = new Proxy({}, { get: () => { throw new Error('nope'); } });
  const nav = { userAgent: PIXEL_UA, get hardwareConcurrency(): number { throw new Error('denied'); },
    userAgentData: { brands: [{ brand: 'Chromium', version: '141' }], mobile: true, platform: 'Android', getHighEntropyValues: () => Promise.reject(new Error('refused')) } };
  const device = await collectDevice({ navigator: nav, screen: hostile, matchMedia: () => { throw new Error('no media'); }, timeZone: () => { throw new RangeError('tz'); } });
  expect(device).toEqual({ ua: PIXEL_UA, brands: ['Chromium 141'], mobile: true, platform: 'Android' });
});

test('an Android Chrome page names its model through the high-entropy Client Hints', async () => {
  const nav = {
    userAgent: PIXEL_UA, hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 5, language: 'es-MX', languages: ['es-MX', 'en'],
    connection: { effectiveType: '4g', downlink: 9.5, saveData: false },
    userAgentData: { brands: [{ brand: 'Google Chrome', version: '141' }], mobile: true, platform: 'Android',
      getHighEntropyValues: vi.fn(() => Promise.resolve({ model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', architecture: '', bitness: '64', wow64: false,
        formFactors: ['Mobile'], fullVersionList: [{ brand: 'Google Chrome', version: '141.0.7390.122' }] })) },
  };
  const screen = { width: 384, height: 832, availWidth: 384, availHeight: 832, orientation: { type: 'portrait-primary' } };
  const device = await collectDevice({ navigator: nav, screen, devicePixelRatio: 2.8125, matchMedia: query => ({ matches: query === '(pointer: coarse)' || query === '(display-mode: standalone)' }), timeZone: () => 'America/Cancun', build: 'b2' });
  expect(nav.userAgentData.getHighEntropyValues).toHaveBeenCalledWith(['model', 'platform', 'platformVersion', 'architecture', 'bitness', 'fullVersionList', 'formFactors', 'wow64']);
  expect(device).toMatchObject({ model: 'SM-S918B', platformVersion: '14.0.0', bitness: '64', mobile: true, cores: 8, memory: 8, touch: 5, screenW: 384, screenH: 832,
    dpr: 2.813, orientation: 'portrait-primary', pointer: 'coarse', hover: false, display: 'standalone', timeZone: 'America/Cancun', net: '4g', saveData: false,
    fullVersionList: ['Google Chrome 141.0.7390.122'], languages: ['es-MX', 'en'], build: 'b2' });
  expect(device).not.toHaveProperty('architecture'); // an empty hint is no hint
});

test('the GPU from the game\'s own context: unmasked names, max texture and the compressed forms', () => {
  const ext: Record<string, unknown> = { WEBGL_debug_renderer_info: { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 }, WEBGL_compressed_texture_astc: {}, WEBGL_compressed_texture_etc: {} };
  const params: Record<number, unknown> = { 1: 'Mali-G715-Immortalis MC11', 2: 'ARM', 3: 4096 };
  const gl = { RENDERER: 10, VENDOR: 11, MAX_TEXTURE_SIZE: 3, getExtension: (name: string) => ext[name] ?? null, getParameter: (p: number) => params[p] };
  expect(gpuFacts(gl as never)).toEqual({ gpu: 'Mali-G715-Immortalis MC11', gpuVendor: 'ARM', maxTexture: 4096, astc: true, etc2: true, bptc: false });
  expect(gpuFacts({ getExtension: () => { throw new Error('lost'); }, getParameter: () => { throw new Error('lost'); } } as never)).toEqual({});
});

test('untrusted words: junk, wrong types and unknown fields drop; an oversized word is refused whole', () => {
  expect(readDeviceWord(new ArrayBuffer(0))).toBeNull();
  expect(readDeviceWord(new TextEncoder().encode('not json').buffer)).toBeNull();
  expect(readDeviceWord(encode([1, 2]))).toBeNull();
  expect(readDeviceWord(new Uint8Array([0xff, 0xfe]).buffer)).toBeNull();
  expect(readDeviceWord(encode({ model: 'x'.repeat(DEVICE_WORD_MAX_BYTES) }))).toBeNull();
  expect(readDeviceWord(encode({ model: 'Pixel\u202E 8\u0000\u00AD\uE000', memory: 'lots', cores: Infinity, mobile: 'yes', brands: [1, 'a'.repeat(80), 'B'], ip: '10.0.0.1', __proto__: { x: 1 } })))
    .toEqual({ model: 'Pixel 8', brands: ['a'.repeat(48), 'B'] });
  expect(cleanDevice(null)).toEqual({});
  expect(cleanDevice({ languages: Array.from({ length: 40 }, (_, i) => `l${String(i)}`) }).languages).toHaveLength(6);
});

test('a client\'s word always fits the room\'s message cap, keeping the model and GPU', () => {
  const huge = { model: 'Pixel 8', gpu: 'Mali-G715', ua: 'u'.repeat(900), fullVersionList: Array.from({ length: 12 }, () => 'v'.repeat(60)), languages: Array.from({ length: 12 }, () => 'l'.repeat(60)), brands: Array.from({ length: 12 }, () => 'b'.repeat(60)) };
  const bytes = encodeDeviceWord(huge);
  expect(bytes.byteLength).toBeLessThanOrEqual(DEVICE_WORD_MAX_BYTES);
  expect(readDeviceWord(bytes)).toMatchObject({ model: 'Pixel 8', gpu: 'Mali-G715' });
});

test('the door\'s journal line and the Sentry tags', () => {
  const device = { model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', gpu: 'g'.repeat(96), screenW: 384, screenH: 832, dpr: 2.8, memory: 8, cores: 8, astc: true, etc2: true, bptc: false, fullVersionList: ['Not)A;Brand 99', 'Google Chrome 141.0.7390.122'], build: 'b3' };
  expect(deviceLine({ name: 'Friend', body: 'p.abc' }, device)).toMatchObject({ at: 'client.device', name: 'Friend', body: 'p.abc', model: 'SM-S918B', browser: 'Google Chrome 141.0.7390.122', screen: '384x832', dpr: 2.8, memory: 8, cores: 8, textures: 'astc,etc2', clientBuild: 'b3' });
  expect(deviceLine({ name: 'Friend', body: 'p.abc' }, device)).not.toHaveProperty('player');
  expect(deviceTags(device)).toEqual({ 'device.model': 'SM-S918B', 'device.gpu': 'g'.repeat(96), 'device.platform': 'Android', 'device.platform_version': '14.0.0', 'device.memory': '8' });
  expect(deviceBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' })).toBe('Safari 18');
  expect(deviceBrowser({ ua: PIXEL_UA })).toBe('Chrome 141');
});

test('Sentry gets the device context and tags only with a DSN built in', () => {
  const sink = { setContext: vi.fn(), setTags: vi.fn() }, device = { model: 'Pixel 8', gpu: 'Adreno (TM) 740' };
  expect(applySentryDevice(sink, device, '')).toBe(false);
  expect(sink.setContext).not.toHaveBeenCalled(); expect(sink.setTags).not.toHaveBeenCalled();
  expect(applySentryDevice(sink, device, 'https://key@example.invalid/1')).toBe(true);
  expect(sink.setContext).toHaveBeenCalledWith('device', device);
  expect(sink.setTags).toHaveBeenCalledWith({ 'device.model': 'Pixel 8', 'device.gpu': 'Adreno (TM) 740' });
});

test('a client sends the word only to a door that says it reads it', () => {
  expect(worldReadsDevice(encode({ cells: 1, shards: ['a'], device: 1 }))).toBe(true);
  expect(worldReadsDevice(encode({ cells: 1, shards: ['a'] }))).toBe(false);
  expect(worldReadsDevice(new TextEncoder().encode('{').buffer)).toBe(false);
});
