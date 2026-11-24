// oxlint-disable-next-line import/no-nodejs-modules -- Real private scratch for restart controls.
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify actual source hashes.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep scratch inside the lane.
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CookDeliveryError, cookApi, cookHeaders, pendingSource, uploadDelivery, VerdictOutbox, type CookApi, type PendingUpload} from '../src/cook/game/uploadTransport';
import type {CookRow} from '../src/cook/game/cookWorker';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {emptyShardfile} from '../src/shared/host/author';

const key = 'fixture-cook-signing-key-with-32-bytes', bytes = new TextEncoder().encode('private original');
const job: PendingUpload = {uploadId: '11111111-1111-1111-1111-111111111111', hash: createHash('sha256').update(bytes).digest('hex'), slug: 'check-fixture', revision: 1, formatVersion: '2'};
const directories: string[] = [];
const directory = (): string => {const root = resolve('tmp/codex-wire'); mkdirSync(root, {recursive: true}); const path = mkdtempSync(`${root}/transport-`); directories.push(path); return path;};
afterEach(() => {for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true});});
const feed = async function* jobs(): AsyncIterable<PendingUpload> {yield job;};
const api = (overrides: Partial<CookApi> = {}): CookApi => ({pending: feed, activations: async function* notices() {}, download: () => Promise.resolve(bytes), verdict: () => Promise.resolve(), acknowledge: () => Promise.resolve(), ...overrides});
const successful = async (): Promise<CookRow> => {
  const shard = emptyShardfile({slug: job.slug, name: 'Fixture', author: 'Test', seed: 1, revision: 1});
  const check = await checkShardfile(shard, new Map(), {validate: () => Promise.resolve({ticks: 240, lanes: 4, steps: 16, scripts: {p95Micros: 1, maxMicros: 2, samples: 180}, fuel: {p95: 1, max: 2, samples: 240}})});
  return {slug: job.slug, hash: job.hash, state: 'cooked', check};
};

describe('the parent-only cook API', () => {
  it('matches the API exact-body signing vector', () => {
    expect(cookHeaders(key, 'GET', '/api/shardfiles/cook/uploads', '', 1795000000000)['x-wildshard-cook-signature']).toBe('e8365c3d6b236fa4f993edfc3ff7ea9b20b04b4ff53a1ea75f782e0f1f70bd3f');
    expect(cookHeaders(key, 'POST', '/x', '{}', 1795000000000)).not.toEqual(cookHeaders(key, 'POST', '/x', '{ }', 1795000000000));
  });

  it('pages every pending upload and signs the exact cursor query', async () => {
    const seen: string[] = [];
    const read: typeof fetch = (input, options) => {
      const url = new URL(String(input)); seen.push(url.pathname + url.search);
      expect(options?.headers).toEqual(cookHeaders(key, 'GET', url.pathname + url.search, '', 1795000000000));
      return Promise.resolve(Response.json({uploads: [job], ...(seen.length === 1 ? {cursor: job.uploadId} : {})}));
    };
    const rows = [];
    for await (const row of cookApi('https://api.example', key, read, () => 1795000000000).pending()) rows.push(row);
    expect(rows).toEqual([job, job]);
    expect(seen).toEqual(['/api/shardfiles/cook/uploads', `/api/shardfiles/cook/uploads?cursor=${job.uploadId}`]);
  });

  it('row 46 names its engine on every feed page, signed with the cursor', async () => {
    const seen: string[] = [];
    const read: typeof fetch = (input, options) => {
      const url = new URL(String(input)); seen.push(url.pathname + url.search);
      expect(options?.headers).toEqual(cookHeaders(key, 'GET', url.pathname + url.search, '', 1795000000000));
      return Promise.resolve(Response.json({uploads: [job], ...(seen.length === 1 ? {cursor: job.uploadId} : {})}));
    };
    for await (const _row of cookApi('https://api.example', key, read, () => 1795000000000).pending('b1')) { /* drain */ }
    expect(seen).toEqual(['/api/shardfiles/cook/uploads?engine=b1', `/api/shardfiles/cook/uploads?engine=b1&cursor=${job.uploadId}`]);
  });

  it('drops credentials at the first redirect and verifies the final decoded hash', async () => {
    const read: typeof fetch = (input, options) => {
      if (String(input).includes('/source')) {
        expect(options?.headers).toHaveProperty('x-wildshard-cook-signature');
        expect(options?.redirect).toBe('manual');
        return Promise.resolve(new Response(null, {status: 302, headers: {location: 'https://storage.example/object'}}));
      }
      expect(options?.headers).toBeUndefined();
      return Promise.resolve(new Response(bytes));
    };
    expect(await cookApi('https://api.example', key, read).download(job)).toEqual(bytes);
    await expect(cookApi('https://api.example', key, read).download({...job, hash: 'a'.repeat(64)})).rejects.toThrow('differs from its hash');
    await expect(cookApi('https://api.example', key, read, Date.now, 2).download(job)).rejects.toThrow('passes 2 bytes');
  });

  it('accepts a durable 202 verdict without claiming live', async () => {
    const read: typeof fetch = (_input, options) => {
      expect(options?.body).toBe('{"result":"cooked"}');
      return Promise.resolve(new Response(null, {status: 202}));
    };
    await expect(cookApi('https://api.example', key, read).verdict(job.uploadId, '{"result":"cooked"}')).resolves.toBeUndefined();
  });
});

describe('durable parent verdict delivery', () => {
  it('row 46 polls with its engine and puts it in every verdict, refused or cooked', async () => {
    for (const state of ['refused', 'cooked'] as const) {
      const bodies: string[] = [], engines: (string | undefined)[] = [];
      const pending = async function* jobs(engine?: string): AsyncIterable<PendingUpload> {engines.push(engine); yield job;};
      const row = state === 'cooked' ? await successful() : {slug: job.slug, hash: job.hash, state, detail: 'capabilities'} satisfies CookRow;
      const delivery = uploadDelivery({api: api({pending, verdict: (_id, body) => {bodies.push(body); return Promise.resolve();}}), source: {bind: () => undefined}, worker: {cook: () => Promise.resolve(row)}, outbox: new VerdictOutbox(directory()), build: 'b7'});
      await delivery.sweep(); await delivery.idle();
      expect(engines).toEqual(['b7']);
      expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({hash: job.hash, result: state, engine: 'b7'});
    }
  });

  it('replays the exact saved report after lost response and restart without remeasuring', async () => {
    const path = directory(), row = await successful(), bodies: string[] = [];
    const first = api({verdict: (_id, body) => {bodies.push(body); return Promise.reject(new Error('lost response'));}});
    const cook = vi.fn(() => Promise.resolve(row)), source = {bind: vi.fn()};
    const delivery = uploadDelivery({api: first, source, worker: {cook}, outbox: new VerdictOutbox(path), build: 'b1'});
    await delivery.sweep(); await delivery.idle();
    const saved = new VerdictOutbox(path).rows(); expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]?.body ?? '{}')).toMatchObject({hash: job.hash, build: 'b1', result: 'cooked', report: row.check});
    const second = api({pending: async function* empty() {}, verdict: (_id, body) => {bodies.push(body); return Promise.resolve();}});
    const restarted = uploadDelivery({api: second, source, worker: {cook}, outbox: new VerdictOutbox(path), build: 'b2'});
    await restarted.sweep(); await restarted.idle();
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
    expect(cook).toHaveBeenCalledTimes(1); expect(new VerdictOutbox(path).rows()).toEqual([]);
  });

  it('discovers later pages while a cook is pending and deduplicates discovery', async () => {
    let finish: (row: CookRow) => void = () => undefined;
    const cooking = new Promise<CookRow>(done => {finish = done;});
    const cook = vi.fn(() => cooking), bind = vi.fn();
    let discovered = false;
    const client = api({pending: async function* pending() {yield job; discovered = true; yield {...job, uploadId: '22222222-2222-2222-2222-222222222222'};}});
    const delivery = uploadDelivery({api: client, source: {bind}, worker: {cook}, outbox: new VerdictOutbox(directory()), build: 'b1'});
    await delivery.sweep(); await delivery.sweep();
    expect(discovered).toBe(true); expect(cook).toHaveBeenCalledTimes(2);
    finish(await successful()); await delivery.idle();
  });

  it('never turns a killed job or a legacy unchecked index into a byte verdict', async () => {
    for (const state of ['failed', 'present'] as const) {
      const outbox = new VerdictOutbox(directory()), verdict = vi.fn(() => Promise.resolve());
      const delivery = uploadDelivery({api: api({verdict}), source: {bind: () => undefined}, worker: {cook: () => Promise.resolve({slug: job.slug, hash: job.hash, state})}, outbox, build: 'b1'});
      await delivery.sweep(); await delivery.idle();
      expect(verdict).not.toHaveBeenCalled(); expect(outbox.rows()).toEqual([]);
    }
  });

  it('backs off killed cooks across parent restart without turning them into byte refusals', async () => {
    let now = 1000;
    const path = directory(), cook = vi.fn(() => Promise.resolve({slug: job.slug, hash: job.hash, state: 'failed' as const}));
    const options = {api: api(), source: {bind: () => undefined}, worker: {cook}, build: 'b1', now: () => now};
    const first = uploadDelivery({...options, outbox: new VerdictOutbox(path)});
    await first.sweep(); await first.idle();
    const restarted = uploadDelivery({...options, outbox: new VerdictOutbox(path)});
    await restarted.sweep(); await restarted.idle(); expect(cook).toHaveBeenCalledTimes(1);
    now += 600_000;
    await restarted.sweep(); await restarted.idle(); expect(cook).toHaveBeenCalledTimes(2);
    expect(new VerdictOutbox(path).rows()).toEqual([]);
  });

  it('retains permanently rejected full reports as dead letters and stops replaying them', async () => {
    const outbox = new VerdictOutbox(directory()), cook = vi.fn(() => successful());
    const verdict = vi.fn(() => Promise.reject(new CookDeliveryError(413)));
    const delivery = uploadDelivery({api: api({verdict}), source: {bind: () => undefined}, worker: {cook}, outbox, build: 'b1'});
    await delivery.sweep(); await delivery.idle();
    expect(outbox.blocked(job.uploadId)).toBe(true); expect(outbox.rows()).toEqual([]);
    await delivery.sweep(); await delivery.idle();
    expect(cook).toHaveBeenCalledTimes(1); expect(verdict).toHaveBeenCalledTimes(1);
  });

  it('routes bound originals through protected source and leaves public recooks intact', async () => {
    const privateRead = vi.fn(() => Promise.resolve(bytes)), publicRead = vi.fn(() => Promise.resolve(new Uint8Array([2])));
    const source = pendingSource(api({download: privateRead}), {heads: () => Promise.resolve([]), download: publicRead});
    await source.download('a'.repeat(64)); source.bind(job);
    expect(await source.download(job.hash)).toEqual(bytes);
    expect(privateRead).toHaveBeenCalledWith(job); expect(publicRead).toHaveBeenCalledTimes(1);
    source.unbind(job); await source.download(job.hash); expect(publicRead).toHaveBeenCalledTimes(2);
  });
});
