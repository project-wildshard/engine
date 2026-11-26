import { describe, expect, test } from 'vitest';
import { alignProductionPointers, pointerMoves, readMoves, releaseEntries } from '../scripts/server-release/production-pointers.mjs';

// Meta QA 11-25 row 127: v0.1.92's promotion signed releases/production.json (serial 53) and left six of the API's
// production pointers one release behind. The shape below is that day's, on made-up hashes (J507).
const BEHIND = [
  ['brasscap-mesa', 17, 19], ['driftwood-isle', 12, 13], ['far-reach', 8, 9],
  ['nalati-grasslands', 8, 10], ['nine-dragon-stack', 9, 11], ['pine-hollow', 16, 18],
];
const ON_TIME = [['sunscar-dunes', 8], ['open-plot-sky-race', 3]];
const hashOf = (/** @type {string} */ slug, /** @type {number} */ revision) => {
  const seed = [...`${slug}@${revision}`].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 0xffffff, 7);
  return seed.toString(16).padStart(6, '0').repeat(11).slice(0, 64);
};

function v0192() {
  const entries = [...BEHIND.map(([slug, , to]) => ({ slug, revision: to })), ...ON_TIME.map(([slug, revision]) => ({ slug, revision }))];
  const revisions = [...BEHIND.flatMap(([slug, from, to]) => [[slug, from], [slug, to]]), ...ON_TIME];
  const listed = revisions.map(([slug, revision]) => ({ hash: hashOf(slug, revision), revisions: [{ shard: slug, revision }] }));
  const catalogue = [...BEHIND.map(([slug, from]) => [slug, from]), ...ON_TIME].map(([slug, revision]) => ({ slug, live: { revision, hash: hashOf(slug, revision) } }));
  return { entries, listed, catalogue };
}

/** A stub API and packs host: production's file, the list, a catalogue that flips move. */
function network(state = v0192()) {
  /** @type {{method: string, url: string, body?: unknown, auth?: string | null}[]} */
  const seen = [];
  /** @type {typeof fetch} */
  const fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    seen.push({ method, url, body, auth: headers.get('authorization') });
    if (url.endsWith('/releases/production.json')) return Response.json({ body: JSON.stringify({ channel: 'production', serial: 53, shards: state.entries }), signature: 'x' });
    if (url.endsWith('/api/shardfiles')) return Response.json({ shardfiles: state.listed });
    if (url.endsWith('/api/catalogue')) return Response.json({ shards: state.catalogue });
    if (url.endsWith('/api/channels/production/flip') && method === 'POST') {
      const row = state.catalogue.find(shard => shard.slug === body.slug);
      const to = state.listed.find(file => file.hash === body.hash)?.revisions[0]?.revision;
      if (row === undefined || to === undefined) return new Response('{"error":"unknown"}', { status: 404 });
      row.live = { revision: to, hash: body.hash };
      return Response.json({ channel: 'production', slug: body.slug, hash: body.hash });
    }
    return new Response('nope', { status: 404 });
  };
  return { fetch, seen, state };
}

describe('production pointers follow the signed release file', () => {
  test("v0.1.92's shape owes six moves, each to the release file's upload", () => {
    const { entries, listed, catalogue } = v0192();
    expect(pointerMoves(entries, listed, catalogue)).toEqual(BEHIND.map(([slug, from, to]) => ({ slug, from, to, hash: hashOf(slug, to) })));
  });

  test('the check fails on that shape and passes once the move ran', async () => {
    const net = network();
    expect((await readMoves({ fetch: net.fetch })).map(move => move.slug)).toEqual(BEHIND.map(([slug]) => slug));
    const lines = [];
    const moved = await alignProductionPointers({ fetch: net.fetch, token: 't'.repeat(32), log: line => lines.push(line) });
    expect(moved).toHaveLength(6);
    expect(await readMoves({ fetch: net.fetch })).toEqual([]);
    const flips = net.seen.filter(one => one.method === 'POST');
    expect(flips.map(one => one.body)).toEqual(BEHIND.map(([slug, , to]) => ({ slug, hash: hashOf(slug, to) })));
    expect(flips.every(one => one.auth === `Bearer ${'t'.repeat(32)}`)).toBe(true);
    expect(lines.at(-1)).toBe('production pointers match releases/production.json (6 moved)');
  });

  test('a release entry the API lists no upload for refuses before any flip', async () => {
    const net = network();
    net.state.entries.push({ slug: 'glowfen', revision: 9 });
    await expect(alignProductionPointers({ fetch: net.fetch, token: 't'.repeat(32), log: () => {} })).rejects.toThrow(/glowfen r9: the API lists no upload/u);
    expect(net.seen.some(one => one.method === 'POST')).toBe(false);
  });

  test('no token moves nothing and says why', async () => {
    const net = network();
    await expect(alignProductionPointers({ fetch: net.fetch })).rejects.toThrow(/ADMIN_TOKEN is not set/u);
    expect(net.seen).toEqual([]);
  });

  test('a flip the API does not apply fails the verify read', async () => {
    const net = network();
    const stuck = /** @type {typeof fetch} */ (async (input, init) => (init?.method === 'POST' ? Response.json({}) : await net.fetch(input, init)));
    await expect(alignProductionPointers({ fetch: stuck, token: 't'.repeat(32), log: () => {} })).rejects.toThrow(/still off the release file: brasscap-mesa r17 for r19/u);
  });

  test('only a signed production file is read as one', () => {
    expect(() => releaseEntries({ body: JSON.stringify({ channel: 'staging', shards: [] }) })).toThrow(/not a signed production release/u);
  });
});
