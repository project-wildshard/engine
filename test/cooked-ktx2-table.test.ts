// SF15 (J525): the KTX2 table in the cooked index, the shape the client and the index writer share.
import {describe, expect, it} from 'vitest';
import {cookedKtx2TableOf, EMPTY_COOKED_KTX2_TABLE, readCookedKtx2Table} from '../src/shared/game/shardfile/cookedKtx2Table';

const shardRows = {
  phone: {'/assets/pine-hollow/tex/leafy_grass/diffuse.jpg': '/assets/pine-hollow/tex/leafy_grass/diffuse.t512-0a1b2c3d.ktx2'},
  desktop: {
    '/assets/pine-hollow/tex/leafy_grass/diffuse.jpg': '/assets/pine-hollow/tex/leafy_grass/diffuse-1a2b3c4d.ktx2',
    '/assets/pine-hollow/tex/leafy_grass/diffuse.jpg#layer': '/assets/pine-hollow/tex/leafy_grass/diffuse.layer-2a3b4c5d.ktx2',
  },
};

describe('the cooked index KTX2 table (SF15)', () => {
  it('reads a table of source URLs to cooked files, per tier', () => {
    expect(readCookedKtx2Table({version: 1, ...shardRows})).toEqual({version: 1, ...shardRows});
    expect(readCookedKtx2Table(EMPTY_COOKED_KTX2_TABLE)).toEqual({version: 1, phone: {}, desktop: {}});
  });

  it('refuses any other shape: no version, an extra field, a query, a relative URL', () => {
    expect(() => readCookedKtx2Table({...shardRows})).toThrow();
    expect(() => readCookedKtx2Table({version: 1, ...shardRows, grid: {}})).toThrow();
    expect(() => readCookedKtx2Table({version: 1, phone: {}, desktop: {'/a.jpg': '/a.ktx2?v=1'}})).toThrow();
    expect(() => readCookedKtx2Table({version: 1, phone: {'a.jpg': '/a.ktx2'}, desktop: {}})).toThrow();
  });

  it('takes the table from a cooked discovery document, the one-shard map first', () => {
    const grid = {phone: {'/assets/x.jpg': '/assets/x-grid.ktx2'}, desktop: {}};
    const document = {native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: shardRows, grid}]}}};
    const table = cookedKtx2TableOf(document);
    expect(table.desktop).toEqual(shardRows.desktop);
    expect(table.phone).toEqual({...grid.phone, ...shardRows.phone});
    expect(cookedKtx2TableOf({native: {}})).toEqual(EMPTY_COOKED_KTX2_TABLE);
    expect(cookedKtx2TableOf({native: {ktx2: {GPU_FILES: shardRows}}}).desktop).toEqual(shardRows.desktop);
  });
});
