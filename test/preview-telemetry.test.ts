// oxlint-disable-next-line import/no-nodejs-modules -- Own temporary HTTP server fixture and recorded payload files.
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture storage stays under the repository's ignored tmp root.
import {join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {previewServer} from './fixtures/preview-server';
import {crossroadsConfig} from '@wildshard/format/contentBounds';
import {record} from '../scripts/phone-loading/model';
import {CROSSROADS_CONFIG} from '../api/_crossroadsConfig';

test('the real preview accepts and records exact production-valid telemetry; real refusals remain', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolve('tmp/preview-telemetry-'));
  mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/index.html'), 'fixture');
  const directory = join(root, 'records'), server = await previewServer(root, directory);
  const payloads = [
    {kind: 'session', build: 'fixture', install: 'local', end: 'clean', heartbeat: {session: 's', level: 'driftwood-isle', stage: 'title', fps: 30}, extra: 'same 原始 payload'},
    {kind: 'analytics', build: 'fixture', install: 'local', events: [{name: 'level.time', data: {level: 'driftwood-isle', seconds: 12}}]},
    {kind: 'crossroads', build: 'fixture', install: 'local', rig: {rigVersion: 1, run: 'fixture/1', series: 'fixture', iteration: 1, stage: 'started', config: crossroadsConfig(),
      context: {userAgent: 'fixture', viewport: [402, 874], dpr: 3, standalone: false, origin: 'local'}}},
  ];
  try {
    for (const payload of payloads) {
      const body = JSON.stringify(payload, null, 2), response = await fetch(new URL('api/telemetry', server.base), {method: 'POST', headers: {'content-type': 'application/json'}, body});
      expect(response.status).toBe(204); expect(await response.text()).toBe(''); expect(response.headers.get('cache-control')).toBe('no-store');
      const id = response.headers.get('x-preview-telemetry-id'); expect(id).toMatch(/^[a-f0-9-]{36}$/u);
      const saved = record(JSON.parse(readFileSync(join(directory, `${String(id)}.json`), 'utf8')));
      const bodyFile = saved['bodyFile'], receivedAt = saved['receivedAt'];
      if (typeof bodyFile !== 'string' || typeof receivedAt !== 'string') throw new Error('Missing telemetry bytes or date');
      expect(bodyFile).toBe(`${String(id)}.bin`); expect(saved['bodyBytes']).toBe(Buffer.byteLength(body));
      expect(readFileSync(join(directory, bodyFile))).toEqual(Buffer.from(body)); expect(saved['payload']).toEqual(payload);
      expect(saved['record']).toMatchObject({kind: payload.kind, build: 'fixture', install: 'local', receivedAt});
      if (payload.kind === 'session') expect(saved['record']).toEqual({kind: 'session', build: 'fixture', install: 'local', receivedAt,
        session: 's', end: 'clean', shard: 'driftwood-isle', stage: 'title', fps: 30});
      if (payload.kind === 'analytics') expect(record(saved['record'])['events']).toEqual([{name: 'shard.time', data: {shard: 'driftwood-isle', seconds: 12}}]);
      if (payload.kind === 'crossroads') expect(record(record(saved['record'])['rig'])['stats']).toBeNull();
      const privateRead = await fetch(new URL(`records/${String(id)}.json`, server.base), {headers: {accept: 'application/json'}});
      expect(privateRead.status).toBe(404);
    }
    const bad = ['{', JSON.stringify({kind: 'session', build: 'fixture', install: 'local', end: 'invented', heartbeat: {session: 's'}}),
      JSON.stringify({kind: 'analytics', build: 'fixture', install: 'local', events: [{name: 'invented', data: {}}]})];
    for (const body of bad) expect((await fetch(new URL('api/telemetry', server.base), {method: 'POST', body})).status).toBe(400);
    expect((await fetch(new URL('api/telemetry', server.base), {method: 'POST', body: 'x'.repeat(16_385)})).status).toBe(413);
    expect((await fetch(new URL('api/errors', server.base), {method: 'POST', body: '{}'})).status).toBe(405);
    expect((await fetch(new URL('api/telemetry', server.base))).status).toBe(405);
    expect(readdirSync(directory)).toHaveLength(payloads.length * 2);
  } finally {server.close(); rmSync(root, {recursive: true, force: true});}
}, 15_000);

test('an unwritable telemetry target is an HTTP500, never a silent acknowledgement', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolve('tmp/preview-telemetry-refusal-'));
  mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist/index.html'), 'fixture');
  const directory = join(root, 'blocked'); writeFileSync(directory, 'not a directory');
  const server = await previewServer(root, directory);
  try {
    const response = await fetch(new URL('api/telemetry', server.base), {method: 'POST', body: JSON.stringify({kind: 'analytics', build: 'fixture', install: 'local', events: []})});
    expect(response.status).toBe(500); expect(await response.json()).toEqual({error: 'telemetry recording failed'});
  } finally {server.close(); rmSync(root, {recursive: true, force: true});}
}, 15_000);

test('public static cache entries are Origin-invariant without changing API or preflight CORS', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolve('tmp/preview-static-cors-'));
  mkdirSync(join(root, 'dist/assets'), {recursive: true});
  const small = 'export const ready = true;', large = `${small}\n`.repeat(100);
  writeFileSync(join(root, 'dist/index.html'), 'fixture');
  writeFileSync(join(root, 'dist/assets/runtime-01234567.js'), small);
  writeFileSync(join(root, 'dist/assets/large-01234567.js'), large);
  const server = await previewServer(root, join(root, 'records'));
  const local = new URL(server.base).origin, foreign = 'https://foreign.test';
  try {
    for (const origin of [undefined, local, 'http://localhost:4400', foreign]) {
      const headers: Record<string, string> = {'accept-encoding': 'identity'};
      if (origin !== undefined) headers['origin'] = origin;
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(new URL('assets/runtime-01234567.js', server.base), {method, headers});
        expect(response.status).toBe(200); expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('vary')).toBeNull(); expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(small)));
        expect(await response.text()).toBe(method === 'HEAD' ? '' : small);
      }
      const compressed = await fetch(new URL('assets/large-01234567.js', server.base), {headers: {...headers, 'accept-encoding': 'gzip'}});
      expect(compressed.headers.get('vary')).toBe('Accept-Encoding'); expect(compressed.headers.get('content-encoding')).toBe('gzip');
      expect(await compressed.text()).toBe(large);
    }
    for (const origin of [local, foreign]) {
      for (const method of ['OPTIONS', 'POST']) {
        const response = await fetch(new URL('assets/runtime-01234567.js', server.base), {method, headers: {origin}});
        expect(response.status).toBe(method === 'OPTIONS' ? 204 : 405);
        expect(response.headers.get('access-control-allow-origin')).toBe(origin === local ? local : null);
        expect(response.headers.get('vary')).toBe(origin === local ? 'Origin' : null);
      }
      const api = await fetch(new URL('api/telemetry', server.base), {headers: {origin}});
      expect(api.status).toBe(405); expect(api.headers.get('access-control-allow-origin')).toBe(origin === local ? local : null);
      expect(api.headers.get('vary')).toBe(origin === local ? 'Origin' : null);
    }
  } finally {server.close(); rmSync(root, {recursive: true, force: true});}
}, 15_000);

test('the API keeps format\'s exact crossroads experiment', () => {
  expect(CROSSROADS_CONFIG).toEqual(crossroadsConfig());
});
