// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Verify shipped binary formats and their source identity.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the actual engine assets rather than an encoder fixture.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

test('phone road maps match their painters and contain complete native ASTC 6x6 mip chains', () => {
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(readFileSync('public/assets/grid-road/road-surfaces.json', 'utf8')) as {
    format: number; sourcesSHA256: Record<string, string>; encoder: {version: string; options: string[]}; assets: {file: string; width: number; height: number; sha256: string; gpuBytes: number}[];
  };
  expect(manifest.format).toBe(2);
  const sources = ['src/client/game/grid/roadSurfaceMaps.ts', 'src/client/game/grid/roadGrain.ts',
    'src/shared/game/grid/roadLayout.ts', 'src/scripts/bake-road-surfaces.entry.ts', 'src/scripts/bake-road-surfaces.mjs'];
  expect(Object.keys(manifest.sourcesSHA256).sort()).toEqual([...sources].sort());
  for (const source of sources) expect(manifest.sourcesSHA256[source], source).toBe(hash(readFileSync(source)));
  expect(manifest.encoder.version).toMatch(/^Basis Universal .+ v[0-9]+\.[0-9]+/u);
  expect(manifest.encoder.options).toEqual(['-ktx2', '-ldr_6x6', '-effort', '4', '-srgb', '-mipmap']);
  expect(manifest.assets).toHaveLength(2);
  let total = 0;
  for (const asset of manifest.assets) {
    const bytes = readFileSync(`public/assets/grid-road/${asset.file}`);
    expect(hash(bytes)).toBe(asset.sha256);
    expect(bytes.readUInt32LE(12)).toBe(166); // VK_FORMAT_ASTC_6x6_SRGB_BLOCK
    expect([bytes.readUInt32LE(20), bytes.readUInt32LE(24)]).toEqual([asset.width, asset.height]);
    expect(bytes.readUInt32LE(40)).toBe(11);
    let gpu = 0;
    for (let level = 0; level < 11; level++) {
      const actual = Number(bytes.readBigUInt64LE(80 + level * 24 + 16));
      expect(actual).toBe(Math.ceil(Math.max(1, asset.width >> level) / 6) * Math.ceil(Math.max(1, asset.height >> level) / 6) * 16);
      gpu += actual;
    }
    expect(gpu).toBe(asset.gpuBytes); total += gpu;
  }
  expect(total).toBeLessThan(1024 * 1024);
});
