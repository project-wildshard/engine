import { expect,test } from 'vitest';
import { Vector3 } from 'three';
import { Rng } from '../../../shared/engine/core/rng';
import { HuntingStalkerCore,type HuntGround } from '../../../shared/engine/ai/huntPattern';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import { decodeTerrainTile,encodeTerrainTile,bilinearTerrainSamplers,type TerrainTileData } from '@wildshard/format/terrainTileBytes';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';

const tile = (resolution: number,size: number): TerrainTileData => ({ resolution,size,x: -size/2,z: -size/2,
  heights: Float32Array.from({ length: resolution*resolution },(_,i) => i === 0 ? -0 : Math.sin(i)*3),splat: new Uint8Array(resolution*resolution*4).fill(127) });

test('sample profile preserves original population grid and decoder byte windows',() => {
  const source = tile(4,12),wire = encodeTerrainTile(source),window = new Uint8Array(wire.length+17);window.set(wire,9);
  const bytes = window.subarray(9,9+wire.length),old = decodeTerrainTile(bytes);
  const grid = decodeTerrainTile(bytes,{ resolution: 4,size: 12,seed: 71 });
  expect(grid).toEqual({ res: old.resolution,size: old.size,seed: 71,landscapeHash: 0,heights: old.heights,splat: old.splat,undergrowth: null });
  expect(Object.is(grid.heights[0],-0)).toBe(true);
  const expected = bakedSamplers({ ...grid,heights: old.heights,splat: grid.splat }),actual = bakedSamplers(grid);
  for (const x of [-50,-6,-0,0,1.7,6,50]) for (const z of [-50,-6,0,3.2,6,50]) {
    expect(Object.is(actual.heightAt(x,z),expected.heightAt(x,z))).toBe(true);
    expect(actual.normalAt(x,z)).toEqual(expected.normalAt(x,z));expect(actual.splatAt(x,z)).toEqual(expected.splatAt(x,z));
  }
});

test('sampling profile retains colour, splat, dimension and centred-origin refusals',() => {
  const source = tile(4,12),row = { resolution: 4,size: 12,seed: 7 };
  const { splat: _splat,...without } = source;
  for (const data of [without,{ ...source,colours: new Float32Array(48) },{ ...source,x: -5 }]) expect(() => decodeTerrainTile(encodeTerrainTile(data),row)).toThrow('sampling profile');
  for (const profile of [{ ...row,resolution: 3 },{ ...row,size: 10 },{ ...row,seed: Number.NaN },{ ...row,extra: true }]) expect(() => decodeTerrainTile(encodeTerrainTile(source),profile)).toThrow();
  expect(() => decodeTerrainTile(undefined,row)).toThrow('terrain header');
  let calls = 0;const accessor = { ...row };
  Object.defineProperty(accessor,'seed',{ enumerable: true,get() { calls++;return 7; } });
  expect(() => decodeTerrainTile(encodeTerrainTile(source),accessor)).toThrow('sampling rows');expect(calls).toBe(0);
});

test('shared bilinear conversion keeps Pine-sized lattice and original normal arithmetic',() => {
  const data = decodeTerrainTile(encodeTerrainTile(tile(257,500))),sample = bilinearTerrainSamplers(data,.25,-.8),grid = decodeTerrainTile(encodeTerrainTile(data),{ resolution: 257,size: 500,seed: 0 });
  const old = bakedSamplers(grid);
  for (const x of [-251,-250,-0,0,53.25,250,251]) for (const z of [-251,-250,0,19.5,250,251]) {
    expect(Object.is(sample.heightAt(x,z),old.heightAt(x,z)-.8)).toBe(true);
    expect(sample.normalAt(x,z)).toEqual(old.normalAt(x,z,.25));expect(sample.splatAt(x,z)).toEqual(old.splatAt(x,z));
  }
});

test('hunt controller exposes its original ground, not a second registry or replacement',() => {
  const ground: HuntGround = { heightAt: () => 3,normalY: () => 1,trailDistance: () => 7,cabinMask: () => 0,inChunk: () => true,
    streamAt: () => null,waterLevel: () => -1,pond: () => null,sea: () => false,wetAt: () => false,trees: () => [],treeless: () => true,terrain: () => true,chunkHalf: 250 };
  const ports = { ground,nav: () => null,reach: () => true,wanderGoal: () => null,unaware: () => false,now: () => 0,sound: () => undefined,charge: () => undefined };
  const core = new HuntingStalkerCore<AnimalSim>([],{ config: { rng: new Rng(7),fight: {},faunaTuning: () => undefined },ports,player: new Vector3(),sampleTerrain: () => undefined });
  expect(core.ground).toBe(ground);ports.ground = { ...ground,heightAt: () => 99 };expect(core.ground).toBe(ground);
  expect(Reflect.set(core,'ground',ports.ground)).toBe(false);expect(core.ground.heightAt(0,0)).toBe(3);
  expect(() => new HuntingStalkerCore<AnimalSim>([]).ground).toThrow('Incompatible stalker hunt pattern');
});
