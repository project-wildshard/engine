// @vitest-environment happy-dom
// MEMORY-STRUCTURE STR4: a dev page's verbs post to the control channel beside its world's socket, with its device.
import { afterEach, expect, test, vi } from 'vitest';
import { devControls, devControlUrl } from './devControl';

afterEach(() => { vi.unstubAllGlobals(); });

test('the control channel is the socket host over HTTP', () => {
  expect(devControlUrl('ws://127.0.0.1:5555/')).toBe('http://127.0.0.1:5555/__dev/control');
  expect(devControlUrl('wss://example.test/room')).toBe('https://example.test/__dev/control');
});

test('each verb posts its harness message with the device', async () => {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', (url: string, init: { body: string }) => { sent.push([url, JSON.parse(init.body)]); return Promise.resolve(Response.json({ ok: true, tick: 7 })); });
  const dev = devControls(() => 'ws://127.0.0.1:9/', 'device:a');
  dev.place(1, 2, 3, 0.5); dev.hardHits(3); dev.bossGod(); dev.still(); dev.raise('door'); dev.move('device:b', 4, 5, 6);
  dev.devColliders('wall', []);
  expect(await dev.send({ probe: true })).toEqual({ ok: true, tick: 7 });
  expect(sent.map(row => (row as [string, object])[1])).toEqual([
    { x: 1, y: 2, z: 3, yaw: 0.5, device: 'device:a' }, { hits: 3, device: 'device:a' }, { god: true, device: 'device:a' }, { still: true, device: 'device:a' },
    { flag: 'door', device: 'device:a' }, { move: 'device:b', x: 4, y: 5, z: 6, yaw: 0, device: 'device:a' }, { wildshardDevColliders: 'wall', boxes: [], device: 'device:a' },
    { probe: true, device: 'device:a' }]);
  expect(new Set(sent.map(row => (row as [string])[0]))).toEqual(new Set(['http://127.0.0.1:9/__dev/control']));
});

test('a refused or unreachable channel answers, never throws', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('down')));
  expect(await devControls(() => 'ws://127.0.0.1:9/', 'd').send({ flag: 'x' })).toEqual({ ok: false, reason: 'down' });
});
