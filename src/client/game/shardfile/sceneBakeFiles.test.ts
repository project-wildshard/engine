import { expect, test } from 'vitest';
import type { SceneBakeSource } from './sceneSources';
import { sceneBakeFiles } from './sceneBakeFiles';

const source: SceneBakeSource = { rows: {}, urls: { owned: 'geometry/world.glb', public: '/assets/public.glb' },
  attributes: { _LOCAL: 'local' }, inputs: { lights: 'lights' }, placements: { rows: [] }, resources: [
    { id: 'owned', url: 'textures/coil.bin', compression: 'deflate', fault: { level: 'error', message: 'Missing coil' } },
    { id: 'public', url: '/assets/public.bin', compression: 'deflate', fault: { level: 'warn', message: 'Missing public' } },
  ] };

test('public bake sources preserve descriptor and companion identities', () => {
  const product = { hasFile: () => false, url: () => { throw new Error('Unexpected URL read'); } };
  expect(sceneBakeFiles(source, product)).toBe(source);
  const withoutResources = { rows: {}, urls: {} };
  expect(sceneBakeFiles(withoutResources, product)).toBe(withoutResources);
});

test('owned meshes and deflated companions use verified URLs without changing their declarations', () => {
  const calls: string[] = [];
  const resolved = sceneBakeFiles(source, { hasFile: file => !file.startsWith('/'),
    url: file => { calls.push(file); return `/shardfiles/${file}`; } });
  expect(calls).toEqual(['geometry/world.glb', 'textures/coil.bin']);
  expect(resolved.urls).toEqual({ owned: '/shardfiles/geometry/world.glb', public: '/assets/public.glb' });
  expect(resolved.resources).toEqual([
    { ...source.resources?.[0], url: '/shardfiles/textures/coil.bin' }, source.resources?.[1],
  ]);
  expect(resolved.rows).toBe(source.rows); expect(resolved.placements).toBe(source.placements);
  expect(resolved.inputs).toBe(source.inputs); expect(resolved.attributes).toBe(source.attributes);
  expect(resolved.resources?.[0]?.fault).toBe(source.resources?.[0]?.fault);
  expect(resolved.resources?.[1]).toBe(source.resources?.[1]);
  expect(source.urls['owned']).toBe('geometry/world.glb');
  expect(source.resources?.[0]?.url).toBe('textures/coil.bin');
});

test.each(['geometry/world.glb', 'textures/coil.bin'])('an unadmitted owned file refuses: %s', refused => {
  expect(() => sceneBakeFiles(source, { hasFile: file => file === refused, url: () => { throw new Error('Not admitted'); } }))
    .toThrow('Not admitted');
  expect(source.urls['owned']).toBe('geometry/world.glb');
  expect(source.resources?.[0]?.url).toBe('textures/coil.bin');
});
