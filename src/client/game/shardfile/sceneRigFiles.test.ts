import { expect, test } from 'vitest';
import type { ModelLibraryRows } from '../plugin/geometry';
import { sceneRigFiles } from './sceneRigFiles';

const empty: ModelLibraryRows<string, string> = { meshes: [], meshUrls: {}, hd: [], hdUrls: {}, aoFloor: 0, hdLooks: {} };
const rows: ModelLibraryRows<string, string> = { ...empty, rigs: { bodies: { creatures: ['owned', 'public'],
  urls: { owned: 'rigs/owned.glb', public: '/assets/public.glb' }, standIns: {}, fault: 'rig' }, looks: [] } };

test('public rigs and libraries without rigs keep their original identity', () => {
  const product = { hasFile: () => false, url: () => { throw new Error('Unexpected URL read'); } };
  expect(sceneRigFiles(empty, product)).toBe(empty);
  expect(sceneRigFiles(rows, product)).toBe(rows);
});

test('owned rig names use verified product URLs without changing public URLs or the source descriptor', () => {
  const reads: string[] = [];
  const resolved = sceneRigFiles(rows, { hasFile: name => name === 'rigs/owned.glb', url: name => { reads.push(name); return '/shardfiles/hash.glb'; } });
  expect(reads).toEqual(['rigs/owned.glb']);
  expect(resolved.rigs?.bodies.urls).toEqual({ owned: '/shardfiles/hash.glb', public: '/assets/public.glb' });
  expect(resolved.rigs?.bodies.standIns).toBe(rows.rigs?.bodies.standIns);
  expect(resolved.rigs?.looks).toBe(rows.rigs?.looks);
  expect(rows.rigs?.bodies.urls['owned']).toBe('rigs/owned.glb');
});

test('a refused owned URL remains a preparation refusal', () => {
  expect(() => sceneRigFiles(rows, { hasFile: () => true, url: () => { throw new Error('Not admitted'); } })).toThrow('Not admitted');
});

test('owned facet meshes bind without rigs and preserve public URLs and source rows', () => {
  const source = { ...empty, meshes: ['owned', 'public'], meshUrls: { owned: 'geometry/owned.glb', public: '/assets/public.glb' } };
  const resolved = sceneRigFiles(source, { hasFile: name => name === 'geometry/owned.glb', url: () => '/shardfiles/owned.glb' });
  expect(resolved.meshUrls).toEqual({ owned: '/shardfiles/owned.glb', public: '/assets/public.glb' });
  expect(resolved.meshes).toBe(source.meshes);
  expect(source.meshUrls.owned).toBe('geometry/owned.glb');
  expect(() => sceneRigFiles(source, { hasFile: name => name === 'geometry/owned.glb', url: () => { throw new Error('Not admitted'); } })).toThrow('Not admitted');
});

test('owned pools bind without rigs and retain every public row and geometry option', () => {
  const parts = ['flame'], channels = [{ name: 'life', source: '_life', width: 1 as const }];
  const publicPool = { url: '/assets/public.glb', parts: ['public'] };
  const source = { ...empty, geometryPools: [{ url: 'geometry/owned.glb', parts, channels }, publicPool] };
  expect(sceneRigFiles(source, { hasFile: () => false, url: () => { throw new Error('Unexpected read'); } })).toBe(source);
  const resolved = sceneRigFiles(source, { hasFile: name => name === 'geometry/owned.glb', url: () => '/shardfiles/owned.glb' });
  expect(resolved.geometryPools?.[0]).toEqual({ url: '/shardfiles/owned.glb', parts, channels });
  expect(resolved.geometryPools?.[0]?.parts).toBe(parts);
  expect(resolved.geometryPools?.[0]?.channels).toBe(channels);
  expect(resolved.geometryPools?.[1]).toBe(publicPool);
  expect(source.geometryPools[0]?.url).toBe('geometry/owned.glb');
});

test('rigs and pools bind together, and a refused pool never becomes a public fallback', () => {
  const source = { ...rows, geometryPools: [{ url: 'geometry/owned.glb', parts: ['flame'] }] };
  const product = { hasFile: (name: string) => !name.startsWith('/assets/'), url: (name: string) => `/shardfiles/${name}` };
  const resolved = sceneRigFiles(source, product);
  expect(resolved.rigs?.bodies.urls['owned']).toBe('/shardfiles/rigs/owned.glb');
  expect(resolved.geometryPools?.[0]?.url).toBe('/shardfiles/geometry/owned.glb');
  expect(() => sceneRigFiles(source, { hasFile: name => name === 'geometry/owned.glb', url: () => { throw new Error('Not admitted'); } })).toThrow('Not admitted');
});
