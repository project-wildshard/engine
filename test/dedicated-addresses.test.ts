import { expect, test } from 'vitest';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { closeCode } from '../src/shared/engine/net/socketFrames';

test('address churn cannot exclude a stranger and tracking stays bounded', { timeout: 9000 }, async () => {
  const door = await gatewayDoor();
  try {
    for (let batch = 0; batch < 65; batch++) await Promise.all(Array.from({ length: 64 }, (_value, index) => door.upgrade(`198.18.${String(batch)}.${String(index)}`)));
    expect(await door.upgrade('203.0.113.99')).toContain('101');
    expect(door.world.connectionStats.addresses).toBeLessThanOrEqual(4096);
  } finally { await door.close(); }
});

test('one IPv6 /64 cannot fill the world, including equivalent spellings', { timeout: 9000 }, async () => {
  const door = await gatewayDoor();
  try {
    for (let index = 0; index < 40; index++) await door.admit(index % 2 === 0 ? `2001:db8:1:1::${index.toString(16)}` : `2001:0db8:0001:0001:0:0:0:${index.toString(16)}`, `device:${String(index)}`);
    expect(door.seats).toHaveLength(4);
    expect(await door.admit('2001:db8:1:2::1', 'device:stranger')).toBe(true);
  } finally { await door.close(); }
});

test('refused repeats do not grow history and idle histories expire', { timeout: 9000 }, async () => {
  let now = 0; const door = await gatewayDoor({ now: () => now });
  try {
    for (let batch = 0; batch < 10; batch++) await Promise.all(Array.from({ length: 50 }, () => door.upgrade('203.0.113.1')));
    expect(door.world.connectionStats).toEqual({ addresses: 1, attempts: 10 });
    now = 120_001;
    expect(door.world.connectionStats).toEqual({ addresses: 0, attempts: 0 });
    expect(await door.upgrade('203.0.113.1')).toContain('101');
  } finally { await door.close(); }
});

test('a worker lookup that never answers closes as a retry within its budget', { timeout: 1000 }, async () => {
  const logs: Record<string, unknown>[] = [];
  const door = await gatewayDoor({ helloMs: 50, log: row => { logs.push(row); }, boot: () => ({
    listen: heard => { queueMicrotask(() => { heard({ kind: 'booted', ms: 0 }); }); }, send: () => undefined, stop: () => undefined,
  }) });
  try { expect(await door.admit('203.0.113.10', 'device:lookup')).toBe(false); expect(logs.some(row => String(row['error']).includes('Worker lookup timed out'))).toBe(true); }
  finally { await door.close(); }
});

test('the trusted tunnel address beats a changing forwarded-for chain', async () => {
  const door = await gatewayDoor({ connectsPerMinute: 1 });
  try {
    expect(await door.upgrade('203.0.113.10', { 'x-forwarded-for': '198.51.100.1, 127.0.0.1' })).toContain('101');
    expect(await door.upgrade('203.0.113.10', { 'x-forwarded-for': '198.51.100.2, 127.0.0.1' })).toContain('429');
    expect(await door.upgrade('203.0.113.11', { 'x-forwarded-for': '198.51.100.2, 127.0.0.1' })).toContain('101');
  } finally { await door.close(); }
});

test('transient joins refund their attempts before the same address retries', async () => {
  let down = true; const saves = memoryPlayerSaves(), door = await gatewayDoor({ now: () => 0, saves: { ...saves, where: () => down ? Promise.reject(new Error('Postgres restarting')) : Promise.resolve(null) } });
  try {
    for (let index = 0; index < 12; index++) { expect(await door.admit('203.0.113.20', `device:retry${String(index)}`)).toBe(false); expect(door.closes.at(-1)).toBe(closeCode('retry')); }
    expect(door.world.connectionStats.attempts).toBe(0); down = false;
    expect(await door.admit('203.0.113.20', 'device:back')).toBe(true); expect(door.world.connectionStats.attempts).toBe(1);
  } finally { await door.close(); }
});
