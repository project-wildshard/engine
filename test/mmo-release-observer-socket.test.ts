import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { StagingSocket } from '../src/scripts/mmo-release-observer.mjs';

const { dial } = vi.hoisted(() => ({ dial: vi.fn() }));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class extends EventEmitter {
    constructor(...args: unknown[]) {
      super();
      dial(...args);
    }
  } };
});

test('a staging handshake error does not terminate the release observer', () => {
  const socket = new StagingSocket('wss://rooms-staging.wildshard.io', []);
  assert.doesNotThrow(() => socket.emit('error', new Error('Unexpected server response: 429')));
});

test('the observer uses the staging agent marker on its socket upgrade', () => {
  const url = 'wss://rooms-staging.wildshard.io';
  vi.stubEnv('WS_LANE_NAME', 'observer-test');
  try {
    new StagingSocket(url, []);
    assert.deepEqual(dial.mock.lastCall, [url, [], {
      origin: 'https://staging.wildshard.io',
      headers: { 'x-wildshard-agent': 'observer-test', 'user-agent': 'node WildshardAgent/1 (observer-test)' },
    }]);
  } finally {
    vi.unstubAllEnvs();
  }
});
