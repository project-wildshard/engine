import {expect,test} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {clientRingCatalogue} from '../src/client/game/shardfile/tileContent';
import {TileStreamer} from '../src/client/engine/world/tileStreamer';
import {ResidencyAllocator} from '../src/shared/game/grid/allocator';

// Independent zero-cost metadata, with no author producer in the engine suite.
const emptyTiles=():ReturnType<typeof emptyShardfile>['tiles']=>Array.from({length:64},(_,key)=>{
 const x=key%8,z=Math.floor(key/8);
 return {lod:0,x,z,bounds:{min:[-250+x*62.5,0,-250+z*62.5],max:[-250+(x+1)*62.5,0,-250+(z+1)*62.5]},
 geometricError:0,files:[],compressed:0,decoded:0,gpu:0,triangles:0,draws:0};
});

test('explicit zero-cost squares satisfy readiness without fetch, allocation or publication', async () => {
  const source = emptyShardfile({ slug: 'empty-grid', name: 'Empty grid', author: 'Test', seed: 1, revision: 1 });
  source.tiles = emptyTiles();
  const catalogue = clientRingCatalogue(new Map([['home', { source }]])), allocator = new ResidencyAllocator();
  let fetches = 0, publications = 0;
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], allocator, catalogue, {
    fetch: (_tile, done) => { fetches++; done('unexpected'); },
    upload: () => { publications++; return { mask: () => undefined, shadow: () => undefined, dispose: () => undefined }; },
  });
  const required = streamer.require('home', Array.from({ length: 64 }, (_, key) => key));
  try {
    await required.ready; streamer.step({ x: 0, z: 0, vx: 0, vz: 0 });
    expect([fetches, publications]).toEqual([0, 0]); expect(allocator.entries()).toEqual([]);
    for (const row of source.tiles) expect(catalogue('home', 'l0', row.x, row.z)).toBeNull();
  } finally { required.release(); streamer.dispose(); }
});

test('empty classification preserves nonempty costs and first-row lookup semantics', () => {
  const source = emptyShardfile({ slug: 'grid-costs', name: 'Grid costs', author: 'Test', seed: 1, revision: 1 });
  const [empty] = emptyTiles(); if (empty === undefined) throw new Error('Missing fixture tile');
  const content = { ...empty, files: ['a'.repeat(64)], compressed: 5, decoded: 6, gpu: 7, triangles: 2, draws: 1 };
  const read = (tiles: typeof source.tiles) => clientRingCatalogue(new Map([['home', { source: { ...source, tiles } }]]))('home', 'l0', empty.x, empty.z);
  expect(read([content])).toBe(13);
  expect(read([empty, content])).toBeNull();
  expect(read([content, empty])).toBe(13);
  for (const field of ['compressed', 'triangles', 'draws'] as const) expect(read([{ ...empty, [field]: 1 }])).toBe(0);
});
