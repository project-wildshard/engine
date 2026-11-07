import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { staticGlb } from '../src/sharddev/bake/glb';
import { loadSpecimenAsset, loadBoundSpecimen, awaitSpecimenAssets } from '../src/client/game/models/specimenCatalogue';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { realGc } from '@wildshard/engine/test/realGc';

function fixture(width:number):Uint8Array{
  const geometry=new THREE.BoxGeometry(width,2,3),material=new THREE.MeshStandardMaterial();
  geometry.setAttribute('paintClone',new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count*3).fill(.25),3));
  try{return staticGlb([{name:'crate',geometry,material,customAttributes:{_PAINT_CLONE:'paintClone'}}]);}
  finally{geometry.dispose();material.dispose();}
}
afterEach(()=>{vi.restoreAllMocks();});

test('owned offset GLBs use the existing parser and preserve every primitive channel and bound',async()=>{
  const bytes=fixture(4),backing=new Uint8Array(bytes.length+17);backing.set(bytes,7);
  const expected=await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer,'');
  const mesh=expected.scene.children[0];if(!(mesh instanceof THREE.Mesh))throw new Error('Missing original mesh');
  const originalGeometry:unknown=mesh.geometry;if(!(originalGeometry instanceof THREE.BufferGeometry))throw new Error('Missing original geometry');
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No URL source'));
  const asset=await loadSpecimenAsset({url:'/assets/orchard/crate.glb',retainedAttribute:'_paint_clone'},backing.subarray(7,7+bytes.length));
  expect(Object.keys(asset.geometry.attributes).sort()).toEqual(['normal','position','uv']);
  for(const name of ['position','normal','uv','_paint_clone']){
    const attribute:unknown=originalGeometry.getAttribute(name);
    const actual=name==='_paint_clone'?asset.retainedAttribute:asset.geometry.getAttribute(name);
    if(!(actual instanceof THREE.BufferAttribute)||!(attribute instanceof THREE.BufferAttribute))throw new Error('Missing retained channel');
    expect(Array.from(actual.array)).toEqual(Array.from(attribute.array));expect(actual.itemSize).toBe(attribute.itemSize);expect(actual.normalized).toBe(attribute.normalized);
  }
  originalGeometry.computeBoundingBox();expect(asset.box).toEqual(originalGeometry.boundingBox);
  expect(asset.geometry.index?.array).toEqual(originalGeometry.index?.array);expect(asset.geometry.hasAttribute('_paint_clone')).toBe(false);expect(asset.map).toBeNull();expect(fetch).not.toHaveBeenCalled();
  asset.geometry.dispose();originalGeometry.dispose();
});

test('byte identities keep same-name products separate and disposal permits a fresh decode',async()=>{
  const first=fixture(2),second=fixture(8),row={url:'/assets/shared/model.glb'};
  const a=await loadSpecimenAsset(row,first),b=await loadSpecimenAsset(row,second);
  expect(await loadSpecimenAsset(row,first)).toBe(a);expect(a.geometry).not.toBe(b.geometry);
  expect(a.box.max.x-a.box.min.x).toBe(2);expect(b.box.max.x-b.box.min.x).toBe(8);
  a.geometry.dispose();const fresh=await loadSpecimenAsset(row,first);expect(fresh).not.toBe(a);
  a.geometry.dispose();expect(await loadSpecimenAsset(row,first)).toBe(fresh);fresh.geometry.dispose();b.geometry.dispose();
});

test('owned bound variants share their source and retain the original transform and material cache',async()=>{
  const sky:unknown=Object.create(SkyRig.prototype);if(!(sky instanceof SkyRig))throw new Error('Missing fixture sky');
  Reflect.set(sky,'csm',{lights:[]});Reflect.set(sky,'sunDir',new THREE.Vector3(0,1,0));vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);
  const bytes=fixture(2),row={url:'/assets/forge/anvil.glb',material:{id:'owned-anvil',family:'painterly' as const}};
  const a=loadBoundSpecimen(sky,row,bytes),b=loadBoundSpecimen(sky,{...row,transform:{yaw:Math.PI/2,scale:3}},bytes);
  await awaitSpecimenAssets(sky);const base=await a,fitted=await b,expected=base.geometry.clone().rotateY(Math.PI/2).scale(3,3,3);
  expect(fitted.geometry.getAttribute('position').array).toEqual(expected.getAttribute('position').array);expect(fitted.material).toBe(base.material);
  expect(await loadBoundSpecimen(sky,row,bytes)).toBe(base);expected.dispose();base.geometry.dispose();fitted.geometry.dispose();base.material.dispose();
});

test('owned GLBs refuse invalid headers and external resources before any parser or URL read',()=>{
  const bytes=fixture(1),invalid=bytes.slice();new DataView(invalid.buffer).setUint32(8,bytes.length+4,true);
  expect(()=>loadSpecimenAsset({url:'/assets/refused.glb'},invalid)).toThrow('Invalid owned');
  expect(()=>loadSpecimenAsset({url:'/assets/refused.glb'},new Uint8Array(12))).toThrow('byte cap');
  for(const kind of ['buffers','images']){
    const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},[kind]:[{uri:'https://outside.test/resource'}]})),size=Math.ceil(json.length/4)*4,wire=new Uint8Array(20+size),header=new DataView(wire.buffer);
    for(const [at,value]of [[0,0x46546c67],[4,2],[8,wire.length],[12,size],[16,0x4e4f534a]])header.setUint32(at??0,value??0,true);
    wire.fill(32,20);wire.set(json,20);expect(()=>loadSpecimenAsset({url:'/assets/refused.glb'},wire)).toThrow('embedded resources');
  }
});

test('a rejected owned parse preserves its error and the same input can retry',async()=>{
  const bytes=fixture(5),row={url:'/assets/forge/retry.glb'},error=new Error('Owned parser refused');
  const parse=vi.spyOn(GLTFLoader.prototype,'parse').mockImplementationOnce(()=>{throw error;});
  await expect(loadSpecimenAsset(row,bytes)).rejects.toBe(error);
  const asset=await loadSpecimenAsset(row,bytes);expect(parse).toHaveBeenCalledTimes(2);
  expect(asset.box.max.x-asset.box.min.x).toBe(5);asset.geometry.dispose();
});

const lifetime='a cached owned specimen releases its consumed declaration and input bank';
test(lifetime,async()=>{
  await realGc('test/specimen-owned-glb.test.ts',lifetime,async collect=>{
    const prepare=async()=>{const bytes=fixture(3),row={url:'/assets/gc-owned.glb',context:new Uint8Array(1024*1024)};return {asset:await loadSpecimenAsset(row,bytes),bytes:new WeakRef(bytes),backing:new WeakRef(bytes.buffer),row:new WeakRef(row),context:new WeakRef(row.context.buffer)};};
    const result=await prepare();await collect(result.row);await collect(result.context);await collect(result.bytes);await collect(result.backing);
    expect(result.asset.geometry.getAttribute('position').count).toBe(24);result.asset.geometry.dispose();
  });
});
