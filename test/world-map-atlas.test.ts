import { expect, test } from 'vitest';
import sharp from 'sharp';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this tiny atlas compiler fixture.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve files within the owned fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Give the fixture the same measured hash checks as the product reader.
import { createHash } from 'node:crypto';
import { encodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import { bakeWorldMapAtlas, folderMapBytes, writeWorldMapAtlas } from '../scripts/app-build/worldMapAtlas';

test('one atlas includes every unique map with stable crops and an explicit nonblank plain-plot tile', async () => {
  const red = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const reads: string[] = [];
  const atlas = await bakeWorldMapAtlas(['red', 'empty', 'red'], slug => { reads.push(slug); return slug === 'red' ? red : null; });
  expect(reads).toEqual(['empty', 'red']); expect(atlas.slugs).toEqual(reads); expect(atlas.width).toBe(512); expect(atlas.height).toBe(256);
  const tile = await sharp(await sharp(atlas.bytes).extract({ left: 256, top: 0, width: 256, height: 256 }).png().toBuffer()).stats();
  expect(tile.channels[0]?.mean).toBeGreaterThan(245); expect(tile.channels[1]?.mean).toBeLessThan(5);
  const plot = await sharp(await sharp(atlas.bytes).extract({ left: 0, top: 0, width: 256, height: 256 }).png().toBuffer()).stats();
  expect(plot.channels[0]?.stdev).toBeGreaterThan(5); expect(atlas.bytes.length).toBeLessThan(100_000);
});
test('missing or corrupt declared map bytes fail instead of silently substituting a plain plot', async () => {
  await expect(bakeWorldMapAtlas(['broken'], () => { throw new Error('Missing admitted image'); })).rejects.toThrow('Missing admitted image');
  await expect(bakeWorldMapAtlas(['broken'], () => new Uint8Array([1, 2, 3]))).rejects.toThrow();
});

test('the app build writes one atlas and its define, verifies source hashes, and includes every declared grid map', async () => {
  const root = mkdtempSync(resolve('tmp', 'world-atlas-build-'));
  const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
  try {
    mkdirSync(resolve(root, 'test/pins'), { recursive: true });
    // QA-FEEDBACK 2026-11-13 row 44: a built placement the grid's cells lack (a cell the placement file adds) gets its tile too;
    // an unbuilt one gets none, so the page draws that cell's own map rather than a plot tile for good
    // MN17: a pinned shard the cells and placements lack (Mossgate on v0.1.76) gets its tile; an unbuilt pin gets none
    writeFileSync(resolve(root, 'test/pins/catalogue.json'), JSON.stringify({ placements: [{ slug: 'placed' }, { slug: 'base' }, { slug: 'unbuilt' }],
      shards: [{ slug: 'pinned' }, { slug: 'base' }, { slug: 'unbuilt-pin' }], grid: { cells: [{ slug: 'base' }, { slug: 'plain' }, { slug: 'override' }] } }));
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer();
    for (const slug of ['base', 'override', 'pinned', 'placed', 'plain']) {
      const map = JSON.stringify(slug === 'plain' ? {} : { map: { image: digest(image) } });
      const out = resolve(root, 'out', slug); mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, 'map.json'), map); writeFileSync(resolve(out, 'map.webp'), image);
      writeFileSync(resolve(out, 'shard.json'), JSON.stringify({ format: 'wildshard.shardfile', formatVersion: 2, runtime: null, schemas: [],
        sections: [{ name: 'look/map', path: 'map.json', bytes: Buffer.byteLength(map), hash: digest(map) }],
        files: [{ path: 'map.webp', hash: digest(image), compressed: image.length }] }));
    }
    await writeWorldMapAtlas(root);
    const rows = JSON.parse(readFileSync(resolve(root, 'out/.app/world-map.json'), 'utf8')) as { fileName: string; define: { url: string; compressed: number; slugs: string[] } };
    const atlas = readFileSync(resolve(root, 'out/.app/world-map.webp'));
    expect(rows.fileName).toMatch(/^assets\/world-map-[a-f0-9]{16}\.webp$/u);
    expect(rows.fileName).toBe(`assets/world-map-${digest(atlas).slice(0, 16)}.webp`);
    expect(rows.define).toMatchObject({ url: `/${rows.fileName}`, compressed: atlas.length, slugs: ['base', 'override', 'pinned', 'placed', 'plain'] });
    writeFileSync(resolve(root, 'out/base/map.webp'), 'corrupt'); expect(() => folderMapBytes(root, 'base')).toThrow('image differs');
    writeFileSync(resolve(root, 'out/base/map.json'), '{}'); expect(() => folderMapBytes(root, 'base')).toThrow('section differs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the atlas precedes the app build, and a cold atlas refuses an unbuilt product', async () => {
  const script = readFileSync('scripts/build-app.mjs', 'utf8');
  const pipeline = readFileSync('scripts/app-build-pipeline.mjs', 'utf8');
  const preparation = pipeline.slice(pipeline.indexOf('export function prepareAppBuild()'), pipeline.indexOf('export async function finishAppBuild('));
  expect(preparation).toContain('writeWorldMapAtlas(process.cwd())');
  const prepareCall = script.indexOf('  prepareAppBuild();');
  expect(prepareCall).toBeGreaterThan(-1);
  expect(prepareCall).toBeLessThan(script.indexOf('const build = spawnSync('));
  const root = mkdtempSync(resolve('tmp', 'world-atlas-cold-'));
  try {
    mkdirSync(resolve(root, 'test/pins'), { recursive: true });
    writeFileSync(resolve(root, 'test/pins/catalogue.json'), JSON.stringify({ grid: {
      cells: [{ slug: 'brasscap-mesa' }, { slug: 'plain' }],
    } }));
    await expect(writeWorldMapAtlas(root)).rejects.toThrow(/ENOENT.*brasscap-mesa/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a mostly transparent author map yields to a world map that draws the missing ground', async () => {
  const root = mkdtempSync(resolve('tmp', 'world-atlas-sparse-'));
  const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
  try {
    const folder = resolve(root, 'out', 'sparse');
    mkdirSync(folder, {recursive: true});
    mkdirSync(resolve(root, 'test/pins'), {recursive: true});
    writeFileSync(resolve(root, 'test/pins/catalogue.json'), JSON.stringify({grid: {cells: [{slug:'sparse'}]}}));
    const pixels = Buffer.alloc(8 * 8 * 4);
    pixels.set([255, 255, 255, 255], 0);
    const image = await sharp(pixels, {raw: {width: 8, height: 8, channels: 4}}).png().toBuffer();
    const ground = encodeTerrainTile({resolution: 2, x: -250, z: -250, size: 500, heights: new Float32Array(4)});
    const sections = [['look/map', 'map.json', {map:{image:digest(image)}}],
      ['world/tiles', 'tiles.json', {tiles:[{lod:0,files:[digest(ground)]}]}]] as const;
    const rows = sections.map(([name, path, value]) => {
      const body = JSON.stringify(value);
      writeFileSync(resolve(folder,path), body);
      return {name,path,bytes:Buffer.byteLength(body),hash:digest(body)};
    });
    const files = [['map.png', image, 'png'], ['terrain.bin', ground, 'tile']] as const;
    writeFileSync(resolve(folder, 'shard.json'), JSON.stringify({format:'wildshard.shardfile', formatVersion:2, runtime:null, schemas:[], sections:rows,
      files:files.map(([path, bytes, kind]) => {
        writeFileSync(resolve(folder,path), bytes);
        return {path,hash:digest(bytes),kind,compressed:bytes.length};
      })}));
    await writeWorldMapAtlas(root);
    const tile = await sharp(resolve(root, 'out/.app/world-map.webp')).stats();
    expect(tile.channels[1]?.mean).toBeGreaterThan(70);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
