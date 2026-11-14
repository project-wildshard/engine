import { expect, test, vi } from 'vitest';
import { unzlibSync } from 'fflate';
import { unshuffleLanes } from '../src/client/engine/core/deflate';
import { fixedDraws } from '../src/client/game/models/fixedDraws';
import { originalPlaceBinary } from './fixtures/nalati-original-place-binary';
import original from './fixtures/nalati-shape-book-original.json' with { type: 'json' };

const compressed=await originalPlaceBinary(),raw=unshuffleLanes(unzlibSync(compressed));
const actors=original.draws.filter(row=>'lane'in row);
function productShapeRow(row:typeof original.draws[number]){
  if(!('lane'in row))throw new Error('Expected original actor lane');
  return {...row,lane:{file:'world/places.bin',offset:row.lane.offset}};
}

test('all 36 original actor shapes use the admitted bank with complete geometry parity',async()=>{
  expect(actors).toHaveLength(36);
  const first=actors[0];if(first===undefined||!('lane'in first))throw new Error('Missing original lane');
  const legacy=fixedDraws({slug:'before',file:()=>Promise.reject(new Error('No raw block'))},actors);
  await legacy.load(new Map([[first.lane.url,raw]]));
  const file=vi.fn(()=>Promise.resolve(compressed)),url=vi.fn(()=>Promise.reject(new Error('Retired public bank must not be fetched')));
  const current=fixedDraws({slug:'nalati-grasslands',file},actors.map(productShapeRow),undefined,url);
  await current.load();expect(file).toHaveBeenCalledExactlyOnceWith('world/places.bin');expect(url).not.toHaveBeenCalled();
  for(const row of actors){
    const before=legacy.handle(row.slot).take(),after=current.handle(row.slot).take();
    try{
      expect(Object.keys(after.attributes)).toEqual(Object.keys(before.attributes));
      for(const [name,attribute]of Object.entries(before.attributes)){
        const actual=after.getAttribute(name);expect(actual.itemSize).toBe(attribute.itemSize);expect(actual.normalized).toBe(attribute.normalized);
        expect(Array.from(actual.array)).toEqual(Array.from(attribute.array));
      }
      expect(Array.from(after.index?.array??[])).toEqual(Array.from(before.index?.array??[]));
      expect(after.boundingBox).toEqual(before.boundingBox);expect(after.boundingSphere).toEqual(before.boundingSphere);
    }finally{before.dispose();after.dispose();}
  }
});
