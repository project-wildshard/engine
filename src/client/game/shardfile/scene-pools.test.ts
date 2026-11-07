import { expect, test, vi } from 'vitest';
import { parseWorldScenes, worldScenesForTier } from '@wildshard/format/worldScenes';
import { worldScenePool, type WorldScenePoolRow } from './scenePools';

const file = (): WorldScenePoolRow['files'][number] => ({ file: 'geometry/tiles.glb', parts: ['tile', 'edge'], channels: [{ name: 'wind', source: '_wind', width: 1, parts: ['tile'] }] });
function pool(): WorldScenePoolRow {
  const row = parseWorldScenes({ version: 1, libraries: [{ id: 'tiles', kind: 'pool', publish: 'terrain', files: [file()] }], materials: [], steps: [] }).libraries[0];
  if (row?.kind !== 'pool') throw new Error('Missing fixture pool');
  return row;
}
const product = () => ({ url: vi.fn((name: string) => name), file: vi.fn(() => Promise.resolve(new Uint8Array())) });

test.each([
  { name: 'wind', source: '_wind', width: 1, parts: ['foreign'] },
  { name: 'wind', source: '_wind', width: 1, parts: ['tile', 'tile'] },
  { name: 'wind', source: '_wind', width: 1, parts: [] },
  { name: 'position', source: '_wind', width: 1 },
  { name: 'wind', source: '__proto__', width: 1 },
  { name: 'wind', source: '_wind', width: 5 },
])('pool channel admission refuses invalid rules before product access: %j', channel => {
  const source = product();
  expect(() => parseWorldScenes({ version: 1, libraries: [{ ...pool(), files: [{ ...file(), channels: [channel] }] }], materials: [], steps: [] })).toThrow();
  expect(source.url).not.toHaveBeenCalled(); expect(source.file).not.toHaveBeenCalled();
});

test('pool channels have unique destinations and source columns per file', () => {
  for (const channels of [
    [{ name: 'wind', source: '_a', width: 1 }, { name: 'wind', source: '_b', width: 1 }],
    [{ name: 'wind', source: '_a', width: 1 }, { name: 'sway', source: '_a', width: 1 }],
  ]) expect(() => parseWorldScenes({ version: 1, libraries: [{ ...pool(), files: [{ ...file(), channels }] }], materials: [], steps: [] })).toThrow();
});

test('the public decoder refuses getters and foreign or repeated cold files before URL lookup', () => {
  const source = product(), rows = pool(), read = vi.fn(() => rows.files);
  const poisoned: WorldScenePoolRow = { ...rows, get files() { return read(); } };
  expect(() => worldScenePool(source, poisoned)).toThrow('plain JSON'); expect(read).not.toHaveBeenCalled();
  expect(() => worldScenePool(source, rows, [file()])).toThrow('declared files');
  const first = rows.files[0]; if (first === undefined) throw new Error('Missing fixture file');
  expect(() => worldScenePool(source, rows, [first, first])).toThrow('distinct declared files');
  expect(source.url).not.toHaveBeenCalled(); expect(source.file).not.toHaveBeenCalled();
  const cold = worldScenePool(source, rows, [first]); expect(cold.geometry('tile')).toBeNull();
  expect(source.url).toHaveBeenCalledWith('geometry/tiles.glb'); expect(source.file).not.toHaveBeenCalled();
});

test('tier membership permits the same part on separate tiers and preserves full channel rules', () => {
  const rows = parseWorldScenes({ version: 1, libraries: [{ id: 'tiles', kind: 'pool', publish: 'terrain', files: [
    { ...file(), tier: 'phone' }, { ...file(), file: { phone: 'unused.glb', desktop: 'geometry/full.glb' }, tier: 'desktop' },
  ] }], materials: [], steps: [] });
  for (const tier of ['phone', 'desktop'] as const) {
    const row = worldScenesForTier(rows, tier).libraries[0]; if (row?.kind !== 'pool') throw new Error('Missing fixture pool');
    expect(row.files).toHaveLength(1); expect(row.files[0]?.channels).toEqual(file().channels);
    expect(() => worldScenePool(product(), row)).not.toThrow();
  }
  expect(() => parseWorldScenes({ ...rows, libraries: [{ ...pool(), files: [file(), file()] }] })).toThrow();
});


test('native pool capacity refuses before resolving any verified file URLs', () => {
  const source = product();
  for (const [count, parts] of [[17, 1], [3, 64]] as const) {
    const files = Array.from({ length: count }, (_, index) => ({ file: `pool-${index}.glb`, parts: Array.from({ length: parts }, (_part, part) => `part-${index}-${part}`) }));
    expect(() => worldScenePool(source, { ...pool(), files })).toThrow();
  }
  expect(source.url).not.toHaveBeenCalled(); expect(source.file).not.toHaveBeenCalled();
});
