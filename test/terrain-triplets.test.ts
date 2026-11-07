import {scalarBlockBytes} from './fixtures/nalati-scalar-blocks';
// oxlint-disable-next-line import/no-nodejs-modules -- validate numeric geography fixtures without inferring the full generated JSON type
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect,test } from 'vitest';
import { zlibSync,unzlibSync } from 'fflate';
import { declaredGroundColour as declaredGroundColourInput,declaredSurface as declaredSurfaceInput } from '../src/client/game/shard/manifest';
import {ScalarLatticeBindings} from '../src/shared/engine/world/scalarChannel';
import { ScalarTripletSchema } from '@wildshard/format/scalarChannel';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { formatJsonSchema } from '../src/shared/host/formatJsonSchema';
import { groundColor,surfaceAt,GROUND } from './fixtures/nalati-terrain';

const finite=v.pipe(v.number(),v.finite());
const geography=v.parse(v.object({res:finite,size:finite,seed:finite,pigment:ScalarTripletSchema,surface:ScalarTripletSchema}),
  JSON.parse(readFileSync('test/fixtures/nalati-geography-original.json','utf8')));

const TERRAIN = GROUND.terrain;

const files=new Map<string,Uint8Array>();
const encode = (values: Float32Array): {file:string} => {
  const file=`test/terrain-triplets-${files.size}.bin`;files.set(file,zlibSync(new Uint8Array(values.buffer)));return {file};
};
function declaredGroundColour(input:unknown){const bindings=new ScalarLatticeBindings(),sample=declaredGroundColourInput(input,bindings);bindings.prepare(files);return sample;}
function declaredSurface(input:unknown){const bindings=new ScalarLatticeBindings(),sample=declaredSurfaceInput(input,bindings);bindings.prepare(files);return sample;}
const raster = (value: number) => ({ res: 2,size: 500,values: { type: 'f32',count: 4,data: encode(new Float32Array(4).fill(value)) } });
const triplet = [raster(-2),raster(.25),raster(3)];

test('ground writes the original output in component order and surface allocates independent tuples', () => {
  const colour = declaredGroundColour(triplet),surface = declaredSurface(triplet),out: [number,number,number] = [0,0,0],writes: number[] = [];
  for (const index of [0,1,2]) Object.defineProperty(out,index,{ configurable: true,set(value: number) { writes.push(index,value); },get() { return 17; } });
  expect(colour(0,0,Number.NaN,Infinity,TERRAIN,out)).toBe(out);expect(writes).toEqual([0,-2,1,.25,2,3]);
  const first = surface(0,0,Number.NaN,Infinity),second = surface(0,0,-Infinity,Number.NaN);
  expect(first).toEqual([-2,.25,3]);expect(second).toEqual(first);expect(second).not.toBe(first);
  first[0] = 99;expect(surface(0,0,0,0)).toEqual([-2,.25,3]);
});

test('the entire strict triplet and every encoded component refuse before exposing either callback', () => {
  for (const input of [[],triplet.slice(0,2),[...triplet,raster(4)],[triplet[0],triplet[1],{ ...raster(2),res: 3 }],[triplet[0],triplet[1],{ ...raster(2),values: { ...raster(2).values,data: encode(new Float32Array([1,2,3])) } }],[triplet[0],triplet[1],raster(Number.NaN)]]) {
    expect(() => declaredGroundColour(input)).toThrow();expect(() => declaredSurface(input)).toThrow();
  }
  let calls = 0;const accessor = [triplet[0],triplet[1],{ ...raster(2),get size() { calls++;return 500; } }];
  expect(() => declaredGroundColour(accessor)).toThrow('plain JSON');expect(() => declaredSurface(accessor)).toThrow('plain JSON');expect(calls).toBe(0);
  expect(formatJsonSchema(ScalarTripletSchema)).toBeDefined();
});

test('input changes and unrelated declarations cannot redirect existing sampled callbacks', () => {
  const authored = structuredClone(triplet),first = declaredGroundColour(authored),surface = declaredSurface(authored);
  const other = declaredGroundColour([raster(7),raster(8),raster(9)]),out: [number,number,number] = [0,0,0];
  for (const row of authored) row.values.data = encode(new Float32Array(4).fill(100));
  expect(first(1000,-1000,0,0,TERRAIN,out)).toBe(out);expect(out).toEqual([-2,.25,3]);
  expect(other(0,0,0,0,TERRAIN,out)).toBe(out);expect(out).toEqual([7,8,9]);expect(surface(0,0,0,0)).toEqual([-2,.25,3]);
});

test('actual declared pigment and surface retain the predecessor native sampler answers', () => {
  const old = (data: string|{file:string}) => {
    const bytes = unzlibSync(scalarBlockBytes(data));
    return bakedSamplers({ res: geography.res,size: geography.size,seed: geography.seed,landscapeHash: 0,heights: new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),splat: new Uint8Array(0),undergrowth: null }).heightAt;
  };
  const pigment = geography.pigment.map(row => old(row.values.data)),surface = geography.surface.map(row => old(row.values.data));
  for (const x of [-500,-250,-249.99,-0,0,12.5,250,500,Number.NaN]) for (const z of [-500,-250,-0,0,25,250,500]) {
    const out: [number,number,number] = [0,0,0];
    expect(groundColor(x,z,Number.NaN,Infinity,TERRAIN,out)).toBe(out);
    expect(out).toEqual(pigment.map(sample => sample(x,z)));
    expect(surfaceAt(x,z,-Infinity,Number.NaN)).toEqual(surface.map(sample => sample(x,z)));
  }
});
