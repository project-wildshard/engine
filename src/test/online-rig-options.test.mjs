import { expect, test } from 'vitest';
import { openRig } from '../scripts/online-rig.mjs';
import { rigOptions, rigSocketPath } from '../scripts/online-rig-options.mjs';

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

// QA 11-25 row 88's clone put v0.1.94's local QA socket about 120 bytes deep; listen failed EINVAL past 103.
test('the rig socket fits a Unix socket path however deep the work folder is', () => {
  expect(rigSocketPath('/work/local/rig')).toBe('/work/local/rig/pg.sock');
  const deep = `/Users/someone/projects/games/wildshard/engine/tmp/opus-rel86/train-2zxv8G/cut-tree/tmp/opus-rel86/qa-bG47t3/local/rig`;
  const path = rigSocketPath(deep, '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T');
  expect(Buffer.byteLength(path)).toBeLessThanOrEqual(103);
  expect(path).toMatch(/\/ws-pg-[a-f0-9]{16}\.sock$/u);
  expect(rigSocketPath(deep, '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T')).toBe(path);
  expect(rigSocketPath(`${deep}-2`, '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T')).not.toBe(path);
});
