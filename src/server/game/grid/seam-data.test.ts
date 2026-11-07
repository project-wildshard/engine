import { expect, test } from 'vitest';
import { readGridSeamData } from '../../../shared/game/grid/seamData';
import { jsonDataHeapBytes } from '@wildshard/format/json';

async function fixture(source: string) {
  const wire = new TextEncoder().encode(source), hash = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
  const sha256 = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  return { source, address: { url: `/assets/grid-seams-${sha256.slice(0, 8)}.json`, bytes: wire.length, sha256 } };
}

test('entry reads exact bytes once and returns detached per-read data without a module-held bank', async () => {
  const asset = await fixture('{"plans":[["native",[[0,0.125,1]]]],"edges":[]}');
  const urls: string[] = [];
  const read = (url: string): Promise<Response> => { urls.push(url); return Promise.resolve(new Response(asset.source)); };
  const first = await readGridSeamData(asset.address, read), second = await readGridSeamData(asset.address, read);
  expect(first).toEqual({ plans: [['native', [[0, 0.125, 1]]]], edges: [] });
  expect(second).toEqual(first); expect(second).not.toBe(first);
  expect(urls).toEqual([asset.address.url, asset.address.url]);
});

test('missing, changed, truncated or malformed seam data refuses before construction', async () => {
  const asset = await fixture('{"plans":[],"edges":[]}');
  await expect(readGridSeamData(asset.address, () => Promise.resolve(new Response(null, { status: 404 })))).rejects.toThrow('404');
  await expect(readGridSeamData(asset.address, () => Promise.resolve(new Response('x')))).rejects.toThrow('size');
  await expect(readGridSeamData(asset.address, () => Promise.resolve(new Response(asset.source.replace('plans', 'wrong'))))).rejects.toThrow('differs');
  const invalid = await fixture('{"plans":[["native",[["wrong"]]]],"edges":[]}');
  await expect(readGridSeamData(invalid.address, () => Promise.resolve(new Response(invalid.source)))).rejects.toThrow('Invalid grid seam data');
});

test('native edge samples and physical observations survive transport exactly', async () => {
  const row = { heights: Array.from({ length: 257 }, (_, i) => i / 256),
    colours: Array.from({ length: 257 }, () => [0.125, 0.25, 0.5]), roadHeight: 0 };
  const observation = { entryWidth: 12, waterSurface: 0, geometry: 'ground', sourceSurface: 'terrain', outflows: [{ from: -5, to: 5 }] };
  const value = { plans: [], edges: [['native', { kind: 'declared', profiles: { north: row, east: row, south: row, west: row },
    observations: { north: observation, east: observation, south: observation, west: observation } }]] };
  const asset = await fixture(JSON.stringify(value));
  expect(await readGridSeamData(asset.address, () => Promise.resolve(new Response(asset.source)))).toEqual(value);
});

test('native plans stay unread until demanded and each verified read is detached', async () => {
  const main = await fixture('{"plans":[],"edges":[]}'), plans = await fixture('{"plans":[["native",[[0,0.125,1]]]],"edges":[]}');
  const address = { ...plans.address, url: plans.address.url.replace('grid-seams-', 'grid-seam-plans-') };
  const urls: string[] = [], data = await readGridSeamData({ ...main.address, plans: address }, url => { urls.push(url); return Promise.resolve(new Response(main.source)); });
  expect(urls).toEqual([main.address.url]); expect(data.plans).toEqual([]);
  if (data.readPlans === undefined) throw new Error('Missing native plan reader');
  const read = (url: string): Promise<Response> => { urls.push(url); return Promise.resolve(new Response(plans.source)); };
  const first = await data.readPlans(read), second = await data.readPlans(read);
  expect(first).toEqual([['native', [[0, 0.125, 1]]]]); expect(second).toEqual(first); expect(second).not.toBe(first);
  first[0]?.[1][0]?.fill(17); expect(second).toEqual([['native', [[0, 0.125, 1]]]]);
  expect(urls).toEqual([main.address.url, address.url, address.url]);
  await expect(data.readPlans(() => Promise.resolve(new Response(`${plans.source} `)))).rejects.toThrow('size');
  await expect(data.readPlans(() => Promise.resolve(new Response(plans.source.replace('0.125', '0.250'))))).rejects.toThrow('differs from the build');
  await expect(data.readPlans(() => Promise.resolve(new Response(null, { status: 404 })))).rejects.toThrow('404');
  const abort = new DOMException('Plan input retired', 'AbortError');
  await expect(data.readPlans(() => Promise.reject(abort))).rejects.toBe(abort);
});

test('deferred native plans keep the original complete matrix guard', async () => {
  const main = await fixture('{"plans":[],"edges":[]}'), plans = await fixture('{"plans":[["native",[["bad"]]]],"edges":[]}');
  const data = await readGridSeamData({ ...main.address, plans: { ...plans.address, url: plans.address.url.replace('grid-seams-', 'grid-seam-plans-') } }, () => Promise.resolve(new Response(main.source)));
  if (data.readPlans === undefined) throw new Error('Missing native plan reader');
  await expect(data.readPlans(() => Promise.resolve(new Response(plans.source)))).rejects.toThrow('Invalid grid seam plans');
});

test('deferred plan addresses detach and cannot borrow the main asset namespace', async () => {
  const main = await fixture('{"plans":[],"edges":[]}'), plans = await fixture('{"plans":[["native",[[0,1]]]],"edges":[]}');
  const address = { ...plans.address, url: plans.address.url.replace('grid-seams-', 'grid-seam-plans-') }, original = address.url;
  const data = await readGridSeamData({ ...main.address, plans: address }, () => Promise.resolve(new Response(main.source)));
  if (data.readPlans === undefined) throw new Error('Missing native plan reader');
  address.url = '/assets/foreign.json'; address.sha256 = '0'.repeat(64); address.bytes = 1;
  const urls: string[] = [];
  expect(await data.readPlans(url => { urls.push(url); return Promise.resolve(new Response(plans.source)); })).toEqual([['native', [[0, 1]]]]);
  expect(urls).toEqual([original]);
  const wrongNamespace = await readGridSeamData({ ...main.address, plans: plans.address }, () => Promise.resolve(new Response(main.source)));
  if (wrongNamespace.readPlans === undefined) throw new Error('Missing refused plan reader');
  let reads = 0;
  await expect(wrongNamespace.readPlans(() => { reads++; return Promise.resolve(new Response(plans.source)); })).rejects.toThrow('Invalid');
  expect(reads).toBe(0);
});

test('compiler costs require the verified source and complete unique edge names', async () => {
  const row = { heights: Array.from({ length: 257 }, (_, index) => index / 257), colours: Array.from({ length: 257 }, () => [0.2, 0.4, 0.6]), roadHeight: 0 };
  const observation = { entryWidth: 8 }, edge = { kind: 'declared', profiles: { north: row, east: row, south: row, west: row }, observations: { north: observation, east: observation, south: observation, west: observation } };
  const asset = await fixture(JSON.stringify({ plans: [], edges: [['native', edge]], edgeCosts: 'not a compiler fact' }));
  const bytes = jsonDataHeapBytes(edge); if (bytes === undefined) throw new Error('Missing exact fixture charge');
  const facts = { source: asset.address.sha256, rows: [['native', bytes] as const] };
  const data = await readGridSeamData({ ...asset.address, edgeCosts: facts }, () => Promise.resolve(new Response(asset.source)));
  expect(data.edgeCosts?.get('native')).toBe(bytes);
  facts.rows[0] = ['native', bytes + 1000]; expect(data.edgeCosts?.get('native')).toBe(bytes);
  for (const bad of [undefined, { source: '0'.repeat(64), rows: [['native', bytes]] }, { source: asset.address.sha256, rows: [['other', bytes]] },
    { source: asset.address.sha256, rows: [['native', bytes], ['native', bytes]] }, { source: asset.address.sha256, rows: [['native', -1]] },
    { source: asset.address.sha256, rows: [['native', 1.5]] }, { source: asset.address.sha256, rows: [['native', 'not a number']] }]) {
    const address = { ...asset.address }; Object.defineProperty(address, 'edgeCosts', { value: bad });
    const fallback = await readGridSeamData(address, () => Promise.resolve(new Response(asset.source)));
    expect(fallback.edgeCosts).toBeUndefined(); expect(jsonDataHeapBytes(fallback.edges[0]?.[1])).toBe(bytes);
  }
});

test('wire fields cannot install a deferred reader or assert compiler facts', async () => {
  const asset = await fixture('{"plans":[],"edges":[],"readPlans":"not a function capability","edgeCosts":{"source":"wire","rows":[]}}');
  const data = await readGridSeamData(asset.address, () => Promise.resolve(new Response(asset.source)));
  expect(data.plans).toEqual([]); expect(data.edges).toEqual([]);
  expect(data.readPlans).toBeUndefined(); expect(data.edgeCosts).toBeUndefined();
});
