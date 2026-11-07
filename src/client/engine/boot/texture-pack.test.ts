import { expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import type { PackDef, PackFile } from '../../../shared/engine/boot/tables';
import { demandTextureResponse, TexturePackReads } from './texturePack';
import { demandPack } from './pack';

async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 8);
}
function textureOrigin(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://texture-fixture.test/') });
  return () => { if (previous === undefined) Reflect.deleteProperty(globalThis, 'location'); else Object.defineProperty(globalThis, 'location', previous); };
}
async function fixture(sizes = [17, 23, 31]) {
  const bodies = sizes.map((size, i) => new Uint8Array(size).fill(i + 1)), scope = new Scope('texture-demand');
  const paths = await Promise.all(bodies.map(async body => `/assets/gpu/texture-${await hash(body)}.ktx2`));
  const bytes = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0)), files: PackFile[] = []; let offset = 0;
  for (const [i, body] of bodies.entries()) {
    const path = paths[i]; if (path === undefined) throw new Error('Missing texture fixture');
    bytes.set(body, offset); files.push([path, offset, body.length, 'image/ktx2']); offset += body.length;
  }
  const part = { url: `/assets/packs/fixture.phone-${await hash(bytes)}.bin`, bytes: bytes.length, files }, pack: PackDef = { parts: [part], bytes: part.bytes, files };
  const net = vi.fn<typeof fetch>(input => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; if (path === part.url) return Promise.resolve(new Response(bytes.slice()));
    const index = paths.indexOf(path), body = bodies[index]; if (body === undefined) throw new Error('Unexpected texture request');
    return Promise.resolve(new Response(body.slice()));
  });
  const cached = vi.fn<(path: string) => Promise<Response | undefined>>().mockResolvedValue(undefined);
  const publish = vi.fn<(path: string, response: Response) => Promise<void>>(() => Promise.resolve());
  const reader = new TexturePackReads(pack, scope, cached, publish);
  const read = (index: number, signal?: AbortSignal) => {
    const path = paths[index], result = path === undefined ? undefined : reader.read(path, net, signal);
    if (result === undefined) throw new Error('Missing fixture demand'); return result;
  };
  return { scope, reader, read, bodies, paths, bytes, part, pack, net, cached, publish };
}

test('a complete demand wave shares one complete envelope and keeps no settled backing', async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all(f.paths.map((_, i) => f.read(i)));
    const members = await Promise.all(responses.map(async response => new Uint8Array(await response.arrayBuffer())));
    expect(f.net).toHaveBeenCalledOnce();expect(f.net.mock.calls[0]?.[0]).toBe(f.part.url);expect(f.net.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(members).toEqual(f.bodies); expect(f.cached).toHaveBeenCalledExactlyOnceWith(f.part.url);
    const later = new Uint8Array(await (await f.read(0)).arrayBuffer()); expect(later).toEqual(f.bodies[0]);
    expect(f.net).toHaveBeenCalledTimes(2); expect(f.net.mock.calls[1]?.[0]).toBe(f.paths[0]);
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('partial waves never fetch missing members and duplicate borrowers own independent responses', async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all([f.read(0), f.read(0), f.read(2)]);
    const members = await Promise.all(responses.map(async response => new Uint8Array(await response.arrayBuffer())));
    expect(f.net.mock.calls.map(call => call[0])).toEqual([f.paths[0], f.paths[2]]);
    expect(members).toEqual([f.bodies[0], f.bodies[0], f.bodies[2]]);
    const first = members[0], second = members[1]; if (first === undefined || second === undefined) throw new Error('Missing duplicate responses');
    first[0] = 99; expect(second[0]).toBe(1); expect(first.buffer).not.toBe(second.buffer);
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test.each(['truncated', 'oversized'] as const)('a %s envelope refuses every borrower', async kind => {
  const f = await fixture();
  try {
    f.net.mockImplementation(() => {
      const bytes = kind === 'truncated' ? f.bytes.slice(0, -1) : kind === 'oversized' ? new Uint8Array(f.bytes.length + 1) : f.bytes.slice();
      return Promise.resolve(new Response(bytes));
    });
    const results = await Promise.allSettled(f.paths.map((_, i) => f.read(i)));
    expect(results.every(result => result.status === 'rejected')).toBe(true); expect(f.net).toHaveBeenCalledOnce();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('an exact cached envelope supplies a lone offline member without a network read', async () => {
  const f = await fixture();
  try {
    f.cached.mockResolvedValue(new Response(f.bytes.slice())); f.net.mockRejectedValue(new Error('offline'));
    const member = new Uint8Array(await (await f.read(1)).arrayBuffer()); expect(member).toEqual(f.bodies[1]);
    expect(f.cached).toHaveBeenCalledExactlyOnceWith(f.part.url); expect(f.net).not.toHaveBeenCalled();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('G881 trusts compiler member addresses and the exact supplied bytes without a read digest', async () => {
  const f = await fixture(), files = f.part.files.map((row, i): PackFile => i === 0 ? [row[0].replace(/-[a-f0-9]{8}\.ktx2$/u, '-00000000.ktx2'), row[1], row[2], row[3]] : row);
  const reader = new TexturePackReads({ ...f.pack, files, parts: [{ ...f.part, files }] }, f.scope, f.cached, f.publish);
  const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('No read digest'));
  try {
    const results = await Promise.all(files.map(row => {
      const read = reader.read(row[0], f.net); if (read === undefined) throw new Error('Missing declared member demand'); return read;
    }));
    expect(await Promise.all(results.map(async row => new Uint8Array(await row.arrayBuffer())))).toEqual(f.bodies);
    expect(f.net).toHaveBeenCalledOnce(); expect(digest).not.toHaveBeenCalled();
  } finally { digest.mockRestore(); reader.dispose(); f.reader.dispose(); f.scope.dispose(); }
});

test('an offline same-length cached mutation is used as-is, with its predecessor address retained', async () => {
  const f = await fixture(), bytes = f.bytes.slice(); bytes[0] = 99;
  const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('No cache digest'));
  try {
    f.cached.mockResolvedValue(new Response(bytes)); f.net.mockRejectedValue(new Error('offline'));
    const expected = f.bodies[0]?.slice(); if (expected === undefined) throw new Error('Missing original member'); expected[0] = 99;
    expect(new Uint8Array(await (await f.read(0)).arrayBuffer())).toEqual(expected);
    expect(f.part.url).not.toContain('00000000'); expect(f.net).not.toHaveBeenCalled(); expect(digest).not.toHaveBeenCalled();
  } finally { digest.mockRestore(); f.reader.dispose(); f.scope.dispose(); }
});

test('an offline missing envelope remains a real transport refusal', async () => {
  const f = await fixture();
  try {
    f.net.mockRejectedValue(new Error('offline')); await expect(f.read(1)).rejects.toThrow('offline'); expect(f.net).toHaveBeenCalledOnce();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test.each(['truncated', 'oversized'] as const)('a %s cached envelope refetches only the demanded member', async kind => {
  const f = await fixture();
  try {
    f.cached.mockResolvedValue(new Response(kind === 'truncated' ? f.bytes.slice(0, -1) : new Uint8Array(f.bytes.length + 1)));
    expect(new Uint8Array(await (await f.read(1)).arrayBuffer())).toEqual(f.bodies[1]);
    expect(f.net.mock.calls.map(row => row[0])).toEqual([f.paths[1]]);
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('an uncontrolled complete wave is published once and the next offline wave reads the same exact body', async () => {
  const f = await fixture(), disk = new Map<string, Uint8Array<ArrayBuffer>>();
  f.cached.mockImplementation(path => Promise.resolve(disk.has(path) ? new Response(disk.get(path)) : undefined));
  f.publish.mockImplementation(async (path, response) => {disk.set(path, new Uint8Array(await response.arrayBuffer()));});
  try {
    const cold = await Promise.all(f.paths.map((_, i) => f.read(i)));
    expect(await Promise.all(cold.map(async row => new Uint8Array(await row.arrayBuffer())))).toEqual(f.bodies);
    expect(disk.get(f.part.url)).toEqual(f.bytes); expect(f.publish).toHaveBeenCalledOnce();
    f.net.mockClear(); f.net.mockRejectedValue(new Error('offline'));
    const warm = await Promise.all(f.paths.map((_, i) => f.read(i)));
    expect(await Promise.all(warm.map(async row => new Uint8Array(await row.arrayBuffer())))).toEqual(f.bodies);
    expect(f.net).not.toHaveBeenCalled(); expect(f.publish).toHaveBeenCalledOnce();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('quota denial preserves complete texture bytes and retirement still prevents publication to borrowers', async () => {
  const f = await fixture(); f.publish.mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
  try {
    const cold = await Promise.all(f.paths.map((_, i) => f.read(i)));
    expect(await Promise.all(cold.map(async row => new Uint8Array(await row.arrayBuffer())))).toEqual(f.bodies);
    f.reader.dispose(); expect(f.reader.read(f.paths[0] ?? '', f.net)).toBeUndefined();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('the envelope cap keeps an oversized complete cohort on original file URLs', async () => {
  const f = await fixture([2_097_153, 2_097_153]);
  try {
    const responses = await Promise.all([f.read(0), f.read(1)]);
    expect(f.net.mock.calls.map(call => call[0])).toEqual(f.paths);
    for (const [i, response] of responses.entries()) expect((await response.arrayBuffer()).byteLength).toBe(f.bodies[i]?.length);
    expect(f.cached).not.toHaveBeenCalled();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('one cancelled borrower does not abort the other demanded textures', async () => {
  const f = await fixture(), cancelled = new AbortController();
  let deliver: (response: Response) => void = () => { throw new Error('Texture transport was not started'); };
  let transport: AbortSignal | undefined, started: () => void = () => {throw new Error('Missing transport observer');};
  const transportStarted = new Promise<void>(resolve => {started = resolve;});
  try {
    f.net.mockImplementation((_input, init) => new Promise<Response>(resolve => { deliver = resolve; transport = init?.signal ?? undefined; started(); }));
    const complete = Promise.allSettled([f.read(0, cancelled.signal), f.read(1), f.read(2)]);
    await transportStarted; cancelled.abort();
    expect(transport?.aborted).toBe(false); deliver(new Response(f.bytes.slice()));
    const results = await complete, first = results[0];
    if (first?.status !== 'rejected') throw new Error('Cancelled borrower published a response');
    const reason: unknown = first.reason; expect(reason).toBeInstanceOf(DOMException);
    for (const [i, result] of results.entries()) if (i > 0) {
      if (result.status !== 'fulfilled') throw new Error('Another borrower was cancelled');
      expect(new Uint8Array(await result.value.arrayBuffer())).toEqual(f.bodies[i]);
    }
    expect(f.net).toHaveBeenCalledOnce();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('retiring a queued texture wave publishes nothing and starts no fetch', async () => {
  const f = await fixture();
  try {
    const complete = Promise.allSettled(f.paths.map((_, i) => f.read(i)));
    f.reader.dispose(); const results = await complete;
    expect(results.every(result => result.status === 'rejected')).toBe(true); expect(f.net).not.toHaveBeenCalled();
  } finally { f.reader.dispose(); f.scope.dispose(); }
});

test('the public session binding preserves custom requests and disappears with its owner', async () => {
  const f = await fixture(), restoreLocation = textureOrigin();
  try {
    demandPack(f.pack, f.scope);
    const requests = f.paths.map(path => new Request(new URL(path, location.href)));
    const responses = await Promise.all(requests.map(request => {
      const response = demandTextureResponse(request, undefined, f.net); if (response === undefined) throw new Error('Session did not bind its texture'); return response;
    }));
    expect(f.net).toHaveBeenCalledOnce();
    for (const [i, response] of responses.entries()) expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bodies[i]);
    const first = requests[0]; if (first === undefined) throw new Error('Missing session request');
    expect(demandTextureResponse(first, { headers: { Range: 'bytes=0-1' } }, f.net)).toBeUndefined();
    expect(demandTextureResponse(first, { headers: { Authorization: 'private' }, credentials: 'same-origin' }, f.net)).toBeUndefined();
    expect(demandTextureResponse(first, { headers: {}, credentials: 'include' }, f.net)).toBeUndefined();
    expect(demandTextureResponse(first, { headers: {}, credentials: 'omit' }, f.net)).toBeUndefined();
    expect(demandTextureResponse(first, { headers: {}, credentials: 'same-origin', cache: 'force-cache' }, f.net)).toBeUndefined();
    expect(demandTextureResponse(new Request(first, { method: 'POST' }), undefined, f.net)).toBeUndefined();
    expect(demandTextureResponse(new URL(first.url.replace('texture-fixture.test', 'elsewhere.test')), undefined, f.net)).toBeUndefined();
    f.scope.dispose(); expect(demandTextureResponse(first, undefined, f.net)).toBeUndefined();
  } finally { f.reader.dispose(); f.scope.dispose(); restoreLocation(); }
});

test('explicit empty headers and same-origin credentials share the original complete texture wave', async () => {
  const f = await fixture(), restoreLocation = textureOrigin();
  try {
    demandPack(f.pack, f.scope);
    const responses = await Promise.all(f.paths.map(path => {
      const response = demandTextureResponse(path, { headers: {}, credentials: 'same-origin' }, f.net);
      if (response === undefined) throw new Error('Default fetch options bypassed the texture wave');
      return response;
    }));
    expect(f.net).toHaveBeenCalledOnce(); expect(f.net.mock.calls[0]?.[0]).toBe(f.part.url);
    for (const [i, response] of responses.entries()) expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bodies[i]);
  } finally { f.reader.dispose(); f.scope.dispose(); restoreLocation(); }
});
