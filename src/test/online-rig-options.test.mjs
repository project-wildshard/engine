import { expect, test } from 'vitest';
import { openRig } from '../scripts/online-rig.mjs';
import { rigOptions } from '../scripts/online-rig-options.mjs';

const socket = 'ws://127.0.0.1:18797/';
test('explicit memory saves need no Postgres paths; existing callers retain theirs', () => {
  expect(rigOptions({ saves: 'memory', socket })).toEqual({ memory: true, pgBin: '', pgData: '' });
  expect(rigOptions({ pgBin: 'memory:', socket }).memory).toBe(true);
  expect(rigOptions({ pgBin: 'postgres/bin', pgData: 'proof/pg', socket })).toEqual({ memory: false, pgBin: 'postgres/bin', pgData: 'proof/pg' });
  expect(rigOptions({ pgBin: 'pglite:', socket })).toEqual({ memory: false, pgBin: 'pglite:', pgData: '' });
  expect(() => rigOptions({ socket })).toThrow('requires Postgres');
});

test('only literal loopback WebSockets can be signed', () => {
  for (const socket of ['ws://rooms.wildshard.io/', 'ws://localhost/', 'ws://127.0.0.1.example/', 'https://127.0.0.1/', 'ws://user:password@127.0.0.1/']) {
    expect(() => rigOptions({ saves: 'memory', socket })).toThrow('loopback WebSocket');
  }
  expect(rigOptions({ saves: 'memory', socket: 'ws://[::1]:18797/' }).memory).toBe(true);
});

test('openRig refuses a remote socket before reading any fixture or opening ports', async () => {
  await expect(openRig({ dist: 'not-a-build', work: 'not-a-work-dir', keyFile: 'not-a-key', saves: 'memory', socket: 'wss://rooms.wildshard.io/' })).rejects.toThrow('loopback WebSocket');
});
