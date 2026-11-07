import { installWorldRegistry } from '../src/client/engine/world/registry';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the original named carving blocks through the same product fixture.
import {readFileSync} from 'node:fs';
import { place } from '../src/client/engine/models/place';
import { parse } from 'valibot';
import { SpecimenAssetSchema } from '@wildshard/format/specimenCatalogue';
import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { staticGlb } from '../src/sharddev/bake/glb';
import { Rng } from '../src/shared/engine/core/rng';
import { modelContext, paramsOf } from '../src/client/engine/models/model';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { defineSpecimenCatalogue, prepareSpecimenCatalogue, loadBoundSpecimen, awaitSpecimenAssets } from '../src/client/game/models/specimenCatalogue';
import rows from './fixtures/nalati-balbal-original.json' with {type:'json'};

installWorldRegistry();

/** Nalati's baked balbal rows: the generated model and both carved steles as one selection. */
const files=await prepareSpecimenCatalogue({file:name=>{const row=rows.sources.find(source=>source.name===name);if(row===undefined)throw new Error('Missing carving fixture');return Promise.resolve(new Uint8Array(readFileSync(`test/fixtures/nalati-balbal-original-${row.name.endsWith('balbal-0.bin')?'0':'1'}.bin`)));}},rows.catalogue);
const balbal=defineSpecimenCatalogue<{balbal:{readonly carved:'bare'|'capped'|null}}>(rows.catalogue,undefined,{},files).model('balbal');

function skyFixture():SkyRig{
  const sky:unknown=Object.create(SkyRig.prototype);
  if(!(sky instanceof SkyRig))throw new Error('Missing fixture sky');
  Reflect.set(sky,'csm',{lights:[]});Reflect.set(sky,'sunDir',new THREE.Vector3(0,1,0));
  vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);return sky;
}

test('parameter rows select both carved copies and refuse unauthored shapes',()=>{
  const sky=skyFixture(),context=modelContext(sky);
  try{
    expect(balbal.variants?.map(row=>row.id)).toEqual(['generated','bare','capped']);
    for(const id of ['bare','capped']){
      const params=paramsOf(balbal,id,undefined),built=balbal.build(context,params,new Rng(1));
      if(built instanceof THREE.Object3D)throw new Error('Carving must retain native model parts');
      const part=built[0];if(part===undefined)throw new Error('Missing carving mesh');
      const shape:unknown=part.geometry;if(!(shape instanceof THREE.BufferGeometry))throw new Error('Missing carving geometry');
      const position:unknown=shape.getAttribute('position');if(!(position instanceof THREE.BufferAttribute))throw new Error('Missing carving position');
      expect(position.count).toBeGreaterThan(20);
      expect(part.castShadow&&part.receiveShadow).toBe(true);
      shape.dispose();
    }
    const orchard=defineSpecimenCatalogue<{crate:{stored:boolean}}>([{...rows.catalogue[0],key:'crate',model:{id:'orchard/crate',name:'Harvest crate',category:'props',pipeline:'code',file:'orchard.json',defaults:{stored:true}},
      source:{kind:'selection',variants:[{params:{stored:true},source:rows.catalogue[0]?.source.kind==='selection'?{...rows.catalogue[0].source.variants[1]?.source,representation:'group'}:undefined}]}}],undefined,{},files).model('crate');
    expect(orchard.build(context,{stored:true},new Rng(1))).toBeInstanceOf(THREE.Group);
    expect(()=>orchard.build(context,{stored:false},new Rng(1))).toThrow('No authored specimen');
  }finally{vi.restoreAllMocks();}
});

test('fitted assets share the source loan without mutating it or leaking transforms into other variants',async()=>{
  const geometry=new THREE.BoxGeometry(1,2,3),material=new THREE.MeshStandardMaterial(),bytes=staticGlb([{name:'fruit',geometry,material}]);
  const gltf=await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer,''),load=vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue(gltf),sky=skyFixture();
  const {retainedAttribute:_retained,transform:_transform,...source}=rows.generated;
  const asset=parse(SpecimenAssetSchema,{...source,url:'/assets/orchard/fruit.glb',phoneUrl:'/assets/orchard/fruit.glb'});
  try{
    const base=await loadBoundSpecimen(sky,asset),fitted=await loadBoundSpecimen(sky,{...asset,transform:{yaw:Math.PI/2,scale:3}});
    const expected=base.geometry.clone().rotateY(Math.PI/2).scale(3,3,3);
    expect(fitted.geometry.getAttribute('position').array).toEqual(expected.getAttribute('position').array);
    expect(fitted.geometry).not.toBe(base.geometry);expect(fitted.material).toBe(base.material);
    expect((await loadBoundSpecimen(sky,asset)).geometry).toBe(base.geometry);expect(load).toHaveBeenCalledOnce();
    const catalogue=defineSpecimenCatalogue<{fruit:object}>([{key:'fruit',model:{id:'orchard/fruit',name:'Fruit',category:'props',pipeline:'code',file:'orchard.json',defaults:{}},source:{kind:'asset',asset:{...asset,transform:{yaw:Math.PI/2,scale:3}}}}]);
    const built=catalogue.model('fruit').build(modelContext(sky),{},new Rng(1));await awaitSpecimenAssets(sky);await Promise.resolve();
    if(!(built instanceof THREE.Group))throw new Error('Missing asset specimen');
    const mesh=built.children[0];if(!(mesh instanceof THREE.Mesh))throw new Error('Missing fitted specimen');
    expect(mesh.geometry).toBe(fitted.geometry);expected.dispose();
  }finally{vi.restoreAllMocks();geometry.dispose();material.dispose();}
});

test('both carving variants place through the actual native instanced path',async()=>{
  const sky=skyFixture();
  try{
    const placed=place(balbal,[{x:0,y:0,z:0,variant:'bare'},{x:3,y:0,z:0,variant:'capped'}],{ctx:modelContext(sky),draw:'instanced'});
    await placed.registered;
    const counts:number[]=[];placed.object.traverse(object=>{if(object instanceof THREE.InstancedMesh){counts.push(object.count);const shape:unknown=object.geometry;if(shape instanceof THREE.BufferGeometry)shape.dispose();}});
    expect(counts).toEqual([1,1]);
  }finally{vi.restoreAllMocks();}
});


test('both raw carving variants build the same native parts as their raw witness',()=>{
  const variants=['bare','capped']as const;
  const sky=skyFixture(),ctx=modelContext(sky);
  try{for(const id of variants){
    const variant=rows.catalogue[0]?.source.variants.find(row=>row.params.carved===id),source=variant?.source;
    if(source===undefined||source.kind!=='file'||source.file===undefined)throw new Error('Missing raw carving');
    const bytes=files.get(source.file);if(bytes===undefined)throw new Error('Missing prepared carving');
    const backing=new Uint8Array(bytes.byteLength+4);backing.set(bytes,4);
    const witness=defineSpecimenCatalogue<{old:object}>([{key:'old',model:{id:'fixture/old-carving',name:'Old carving',category:'props',pipeline:'code',file:'fixture.json',defaults:{}},source:{...source,file:'witness.bin'}}],undefined,{},new Map([['witness.bin',backing.subarray(4)]])).model('old');
    const before=witness.build(ctx,{},new Rng(1)),after=balbal.build(ctx,{carved:id},new Rng(1));
    if(before instanceof THREE.Object3D||after instanceof THREE.Object3D)throw new Error('Carvings retain parts');
    expect(after).toHaveLength(before.length);
    for(let i=0;i<before.length;i++){const a=before[i],b=after[i];if(a===undefined||b===undefined||!(a.geometry instanceof THREE.BufferGeometry)||!(b.geometry instanceof THREE.BufferGeometry))throw new Error('Missing native carving');
      expect(Object.keys(b.geometry.attributes)).toEqual(Object.keys(a.geometry.attributes));
      for(const[name,attr]of Object.entries(a.geometry.attributes)){const actual=b.geometry.getAttribute(name);if(!(attr instanceof THREE.BufferAttribute)||!(actual instanceof THREE.BufferAttribute))throw new Error('Expected raw attributes');expect(actual.array).toEqual(attr.array);expect(actual.itemSize).toBe(attr.itemSize);expect(actual.normalized).toBe(attr.normalized);}
      expect(b.geometry.index?.array??null).toEqual(a.geometry.index?.array??null);expect(b.geometry.boundingBox).toEqual(a.geometry.boundingBox);expect(b.geometry.boundingSphere).toEqual(a.geometry.boundingSphere);expect(b.material).toBe(a.material);expect(b.castShadow).toBe(a.castShadow);expect(b.receiveShadow).toBe(a.receiveShadow);a.geometry.dispose();b.geometry.dispose();
    }
  }}finally{vi.restoreAllMocks();}
});


test('specimen file admission refuses ambiguous rows and getters before any file read',async()=>{
  const carving=rows.catalogue[0]?.source.variants[1]?.source;if(carving===undefined||carving.file===undefined)throw new Error('Missing carving');
  const base=rows.catalogue[0];if(base===undefined)throw new Error('Missing catalogue');
  const file=vi.fn(()=>Promise.resolve(new Uint8Array(1)));let touched=0;
  const hostile=Object.defineProperty({...carving},'file',{enumerable:true,get:()=>{touched++;return carving.file;}});
  expect(()=>prepareSpecimenCatalogue({file},[{...base,source:hostile}])).toThrow();
  expect(()=>prepareSpecimenCatalogue({file},[{...base,source:{...carving,data:'inline'}}])).toThrow();
  expect(touched).toBe(0);expect(file).not.toHaveBeenCalled();
  await expect(prepareSpecimenCatalogue({file},[{...base,source:carving}])).rejects.toThrow('byte count');expect(file).toHaveBeenCalledOnce();
});
