import { expect, test, vi } from 'vitest';
import { discoveryDocument } from '../src/sharddev/discoveryDocument';
import { readDiscovery, shardFromDiscovery } from '../src/client/game/shard/discovery';
import { shardArt } from '../src/client/game/shard/list';
import { AUTHOR_BUDGETS, authorManifest } from '../src/sharddev/authorManifest';

const spawn = { eye: [0, 1, 0] satisfies [number, number, number], yaw: 0, pitch: 0, mockup: 'spawn', frame: 'spawn' };
const reads = new Map<string, unknown>([['./data/budgets.json', { phone: { fps: 30 } }], ['./ktx2.generated', { phone: {}, desktop: {} }]]);
const read = (module: string): Promise<unknown> => { if (!reads.has(module)) throw new Error(`Unread ${module}`); return Promise.resolve(reads.get(module)); };
const binding = { accent: 'mint', budgets: { module: './data/budgets.json', export: 'default' }, ktx2: { module: './ktx2.generated' }, render: { platform: 'toon' }, poses: { program: true } };

test('a manifest\'s bindings become data, and what names shard code refuses', async () => {
  const document = await discoveryDocument('island', { slug: 'island', bindings: binding }, { poses: { spawn } }, read);
  expect(document.rows).toEqual({ accent: 'mint', budgets: { phone: { fps: 30 } }, poses: { spawn } });
  expect(document.native).toEqual({ render: { $call: 'renderToon', args: [] }, ktx2: { GPU_FILES: { phone: {}, desktop: {} } } });
  for (const [key, row] of [['load', { module: './plugin', export: 'default' }], ['audioPreload', { module: './audio', export: 'load' }], ['render', { module: './look', export: 'look' }], ['roster', { module: './roster', export: 'roster' }]] as const) {
    await expect(discoveryDocument('island', { slug: 'island', bindings: { ...binding, [key]: row } }, { poses: {} }, read)).rejects.toThrow('shard code');
  }
  await expect(discoveryDocument('island', { slug: 'island', bindings: binding }, undefined, read)).rejects.toThrow('no program value poses');
});

test('a document names only the reader\'s own calls', () => {
  expect(() => shardFromDiscovery({ version: 1, slug: 'island', data: {}, rows: {}, native: { render: { $call: 'eval', args: ['1'] } } })).toThrow('Unknown discovery call eval');
  expect(() => shardFromDiscovery({ version: 1, slug: 'island', data: {}, rows: {}, native: { render: { $call: 'constructor', args: [] } } })).toThrow('Unknown discovery call');
  expect(() => shardFromDiscovery({ version: 2, slug: 'island', rows: {}, native: {} })).toThrow('Invalid discovery document');
});

test('a read refuses another shard and a failed answer, and a homed shard names its images there', async () => {
  const answer = (status: number): typeof fetch => vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status })));
  await expect(readDiscovery({ slug: 'island' }, answer(200))).rejects.toThrow('no discovery document');
  await expect(readDiscovery({ slug: 'island', discovery: '/shardfiles/island/discovery.json' }, answer(404))).rejects.toThrow('answered 404');
  await expect(readDiscovery({ slug: 'island', discovery: '/shardfiles/island/discovery.json' }, answer(200))).rejects.toThrow('Invalid discovery document');
  expect(shardArt()).toEqual({});
});

test('a shard on another origin shows its images from there, past the format\'s page URLs', async () => {
  const url = `/shardfiles/island/blobs/image/${'a'.repeat(64)}.jpg`;
  const data = {...authorManifest({identity: {slug: 'island', name: 'Island', seed: 1, author: 'A', revision: 1}, accent: 'sand', spawn: {x: 0, y: 0, z: 0, yaw: 0}} as unknown as Parameters<typeof authorManifest>[0]) as Record<string, unknown>, card: {thumb: url, portrait: url, landscape: url}};
  const body = JSON.stringify({version: 1, slug: 'island', data, rows: {accent: 'sand', budgets: AUTHOR_BUDGETS}, native: {}, art: {[url]: 9}});
  const answer: typeof fetch = () => Promise.resolve(new Response(body));
  const home = 'https://packs.example';
  expect((await readDiscovery({slug: 'island', discovery: `${home}/shardfiles/island/discovery.json`}, answer)).card.thumb).toBe(`${home}${url}`);
  expect(shardArt()[`${home}${url}`]).toBe(9);
  expect((await readDiscovery({slug: 'island', discovery: '/shardfiles/island/discovery.json'}, answer)).card.thumb).toBe(url);
});
