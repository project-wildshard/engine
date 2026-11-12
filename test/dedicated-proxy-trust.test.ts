// VPS-HARDENING VH10: a client behind the proxy cannot choose its own per-address key, and a page on another site cannot open a socket.
import { expect, test } from 'vitest';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { DEFAULT_ALLOWED_ORIGINS, doorTrust, originAllowed, trustedAddress } from '../src/server/host/dedicated/doorTrust';

test('caddy mode: a forged first forwarded-for hop and a spoofed CF-Connecting-IP share one key', async () => {
  const door = await gatewayDoor({ connectsPerMinute: 2 });
  try {
    expect(await door.upgrade('x', { 'x-forwarded-for': '198.51.100.1, 203.0.113.7', 'cf-connecting-ip': '10.9.9.1' })).toContain('101');
    expect(await door.upgrade('x', { 'x-forwarded-for': '198.51.100.2, 203.0.113.7', 'cf-connecting-ip': '10.9.9.2' })).toContain('101');
    expect(await door.upgrade('x', { 'x-forwarded-for': '198.51.100.3, 203.0.113.7', 'cf-connecting-ip': '10.9.9.3' })).toContain('429');
    expect(await door.upgrade('203.0.113.8')).toContain('101');
    expect(door.world.refusals['connections']).toBe(1);
  } finally { await door.close(); }
});

test('caddy mode: the per-address socket cap holds against forged hops', { timeout: 9000 }, async () => {
  const door = await gatewayDoor();
  try {
    for (let index = 0; index < 8; index++) await door.admit('203.0.113.30', `device:${String(index)}`, { 'x-forwarded-for': `198.51.100.${String(index)}, 203.0.113.30`, 'cf-connecting-ip': `10.0.0.${String(index)}` });
    expect(door.seats).toHaveLength(4);
    expect(await door.admit('203.0.113.31', 'device:stranger')).toBe(true);
  } finally { await door.close(); }
});

test('cloudflare mode reads only CF-Connecting-IP, and none mode reads no header', async () => {
  const tunnel = await gatewayDoor({ connectsPerMinute: 1, trustProxy: 'cloudflare' });
  try {
    expect(await tunnel.upgrade('203.0.113.40', { 'x-forwarded-for': '198.51.100.1' })).toContain('101');
    expect(await tunnel.upgrade('203.0.113.40', { 'x-forwarded-for': '198.51.100.2' })).toContain('429');
  } finally { await tunnel.close(); }
  const bare = await gatewayDoor({ connectsPerMinute: 1, trustProxy: 'none' });
  try {
    expect(await bare.upgrade('203.0.113.41', { 'cf-connecting-ip': '203.0.113.41' })).toContain('101');
    expect(await bare.upgrade('203.0.113.42', { 'cf-connecting-ip': '203.0.113.42' })).toContain('429');
  } finally { await bare.close(); }
});

test('only a loopback peer may forward, and the last hop is the proxy\'s', () => {
  const headers = { 'x-forwarded-for': '198.51.100.1, 203.0.113.7', 'cf-connecting-ip': '10.9.9.1' };
  for (const mode of ['caddy', 'cloudflare', 'none'] as const) expect(trustedAddress('203.0.113.50', headers, mode)).toBe('203.0.113.50');
  expect(trustedAddress('127.0.0.1', headers, 'caddy')).toBe('203.0.113.7');
  expect(trustedAddress('::ffff:127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }, 'caddy')).toBe('203.0.113.9');
  expect(trustedAddress('::1', headers, 'cloudflare')).toBe('10.9.9.1');
  expect(trustedAddress('127.0.0.1', headers, 'none')).toBe('127.0.0.1');
  expect(trustedAddress('127.0.0.1', {}, 'caddy')).toBe('127.0.0.1');
  expect(trustedAddress('127.0.0.1', { 'x-forwarded-for': ' ' }, 'caddy')).toBe('127.0.0.1');
});

test('a bad Origin gets 403; a listed one or none gets a socket', async () => {
  const door = await gatewayDoor();
  try {
    expect(await door.upgrade('203.0.113.60', { origin: 'https://evil.example' })).toContain('403');
    expect(await door.upgrade('203.0.113.60', { origin: 'https://play.wildshard.io.evil.example' })).toContain('403');
    expect(await door.upgrade('203.0.113.60', { origin: 'null' })).toContain('403');
    expect(door.world.refusals['origin']).toBe(3);
    expect(await door.upgrade('203.0.113.60', { origin: 'https://play.wildshard.io' })).toContain('101');
    expect(await door.upgrade('203.0.113.61')).toContain('101');
  } finally { await door.close(); }
  const open = await gatewayDoor({ allowedOrigins: null });
  try { expect(await open.upgrade('203.0.113.62', { origin: 'https://evil.example' })).toContain('101'); }
  finally { await open.close(); }
});

test('TRUST_PROXY and ALLOWED_ORIGINS: caddy and the game hosts by default, a strange word stops the server', () => {
  // OFF-VERCEL OV9: the default is the three game hosts and nothing else.
  expect(DEFAULT_ALLOWED_ORIGINS).toEqual(['https://play.wildshard.io', 'https://staging.wildshard.io', 'https://preview.wildshard.io']);
  expect(doorTrust({})).toEqual({ trustProxy: 'caddy', allowedOrigins: DEFAULT_ALLOWED_ORIGINS });
  expect(doorTrust({ TRUST_PROXY: 'cloudflare', ALLOWED_ORIGINS: 'https://a.example, https://b.example:8443' }))
    .toEqual({ trustProxy: 'cloudflare', allowedOrigins: ['https://a.example', 'https://b.example:8443'] });
  expect(doorTrust({ TRUST_PROXY: 'none', ALLOWED_ORIGINS: '*' }).allowedOrigins).toBeNull();
  expect(() => doorTrust({ TRUST_PROXY: 'nginx' })).toThrow(/TRUST_PROXY/u);
  expect(() => doorTrust({ ALLOWED_ORIGINS: 'play.wildshard.io' })).toThrow(/ALLOWED_ORIGINS/u);
  expect(() => doorTrust({ ALLOWED_ORIGINS: 'https://play.wildshard.io/path' })).toThrow(/ALLOWED_ORIGINS/u);
  expect(originAllowed(undefined, ['https://a.example'])).toBe(true);
  expect(originAllowed('https://A.example', ['https://a.example'])).toBe(true);
});
