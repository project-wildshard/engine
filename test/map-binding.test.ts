import {scalarBlockBytes} from './fixtures/nalati-scalar-blocks';
import { expect,test } from 'vitest';
import { zlibSync,unzlibSync } from 'fflate';
import { declaredMapColour as declaredMapColourInput } from '../src/client/game/shard/manifest';
import {ScalarLatticeBindings} from '../src/shared/engine/world/scalarChannel';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { mapPalette } from '@wildshard/format/minimap';
import { readNalatiGeography } from './fixtures/nalati-geography';

import { NALATI_MINIMAP } from './fixtures/nalati-terrain';

const geography=readNalatiGeography();

const files=new Map<string,Uint8Array>();
const encode = (values: Float32Array): {file:string} => {
  const file=`test/map-binding-${files.size}.bin`;files.set(file,zlibSync(new Uint8Array(values.buffer)));return {file};
};
function declaredMapColour(input:unknown){const bindings=new ScalarLatticeBindings(),sample=declaredMapColourInput(input,bindings);bindings.prepare(files);return sample;}
const raster = (value: number) => ({ res: 2,size: 500,values: { type: 'f32',count: 4,data: encode(new Float32Array(4).fill(value)) } });
const rows = [raster(-2),raster(.25),raster(300)];

test('map callback preserves void return, output component order and ignored inputs', () => {
  const sample = declaredMapColour(rows),out: [number,number,number] = [0,0,0],writes: number[] = [];
  for (const index of [0,1,2]) Object.defineProperty(out,index,{ configurable: true,set(value: number) { writes.push(index,value); },get() { return 17; } });
  const invoke: (...args: Parameters<typeof sample>) => unknown = sample;
  expect(invoke(0,0,Number.NaN,Infinity,-Infinity,out)).toBeUndefined();expect(writes).toEqual([0,-2,1,.25,2,300]);
});

test('whole triplet admission rejects malformed rows and getters, with detached independent instances', () => {
  for (const input of [[],rows.slice(0,2),[...rows,raster(1)],[rows[0],rows[1],{ ...raster(1),res: 3 }],[rows[0],rows[1],raster(Number.NaN)]]) expect(() => declaredMapColour(input)).toThrow();
  let reads = 0;const accessor = [rows[0],rows[1],{ ...raster(1),get size() { reads++;return 500; } }];
  expect(() => declaredMapColour(accessor)).toThrow('plain JSON');expect(reads).toBe(0);
  const authored = structuredClone(rows),first = declaredMapColour(authored),second = declaredMapColour([raster(1),raster(2),raster(3)]),out: [number,number,number] = [0,0,0];
  for (const row of authored) row.values.data = encode(new Float32Array(4).fill(99));
  first(0,0,0,0,0,out);expect(out).toEqual([-2,.25,300]);second(0,0,0,0,0,out);expect(out).toEqual([1,2,3]);
});

test('unchanged actual raster bytes retain map answers, boundaries and POIs', () => {
  const old = [geography.channels.mapRed,geography.channels.mapGreen,geography.channels.mapBlue].map(row => {
    const bytes = unzlibSync(scalarBlockBytes(row.values.data));
    return bakedSamplers({ res: geography.res,size: geography.size,seed: geography.seed,landscapeHash: 0,heights: new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),splat: new Uint8Array(0),undergrowth: null }).heightAt;
  });
  for (const x of [-500,-250,-249.99,-0,0,12,250,500,Number.NaN]) for (const z of [-500,-250,-0,0,25,250,500]) {
    const out: [number,number,number] = [0,0,0];
    const invoke: (...args: Parameters<typeof NALATI_MINIMAP.ground>) => unknown = NALATI_MINIMAP.ground;
    expect(invoke(x,z,Number.NaN,Infinity,-Infinity,out)).toBeUndefined();expect(out).toEqual(old.map(sample => sample(x,z)));
  }
  expect(NALATI_MINIMAP.pois()).toEqual(mapPalette(geography.map).pois());
});
