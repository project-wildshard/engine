import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { StagingSocket } from '../scripts/mmo-release-observer.mjs';

vi.mock('ws', async () => ({ default: (await import('node:events')).EventEmitter }));

test('a staging handshake error does not terminate the release observer', () => {
  const socket = new StagingSocket('wss://rooms-staging.wildshard.io', []);
  assert.doesNotThrow(() => socket.emit('error', new Error('Unexpected server response: 429')));
});
