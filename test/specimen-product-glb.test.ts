import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { fixtureProductFile, fixtureJsonCheck } from './fixtures/productFile';
import {afterEach,expect,test,vi} from 'vitest';
import * as THREE from 'three';
import {parse} from 'valibot';
import {SpecimenAssetSchema} from '@wildshard/format/specimenCatalogue';
import {parseExplorerCatalogue} from '@wildshard/format/explorerCatalogue';
import {Scope} from '../src/shared/engine/app/scope';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {bindFlatTerrain} from '@wildshard/engine/test/terrain';
import {TIER,initializeTier} from '../src/client/engine/core/tier';
import {Rng} from '../src/shared/engine/core/rng';
import {modelContext} from '../src/client/engine/models/model';
import {SkyRig} from '../src/client/engine/world/skyRig';
import {WorldRegistry} from '../src/client/engine/world/registry';
import {staticGlb} from '../src/sharddev/bake/glb';
import {emptyShardfile} from '../src/shared/host/author';
import {emitNamedBlobs,nameBlob} from '../src/sharddev/blobs';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {SceneDressing} from '../src/client/game/shardfile/sceneDressing';
import type {ShardContext} from '../src/client/game/plugin/context';
import {explorerRoster} from '../src/client/game/models/explorerCatalogue';
import {awaitSpecimenAssets,defineSpecimenCatalogue,loadSpecimenAsset,prepareSpecimenCatalogue} from '../src/client/game/models/specimenCatalogue';

const originalTier=TIER;
afterEach(()=>{initializeTier(originalTier);vi.restoreAllMocks();});
function glb(width:number):Uint8Array{
  const geometry=new THREE.BoxGeometry(width,2,3),material=new THREE.MeshStandardMaterial();
  try{return staticGlb([{name:'crate',geometry,material}]);}finally{geometry.dispose();material.dispose();}
}
const material={id:'product-crate',family:'painterly'}as const;
const metadata={id:'orchard/product-crate',name:'Crate',file:'fixture.json',category:'props',pipeline:'code',defaults:{}}as const;
const desktop=glb(2),phone=glb(8);
const asset={url:{file:'models/crate.glb',bytes:desktop.length},phoneUrl:{file:'models/crate-phone.glb',bytes:phone.length},material};
const rows=[{key:'crate',model:metadata,source:{kind:'asset',asset}}];
function skyFixture():SkyRig{
  const sky:unknown=Object.create(SkyRig.prototype);if(!(sky instanceof SkyRig))throw new Error('Missing fixture sky');
  Reflect.set(sky,'csm',{lights:[]});Reflect.set(sky,'sunDir',new THREE.Vector3(0,1,0));vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);return sky;
}
function deferred<T>():{promise:Promise<T>;resolve:(value:T)=>void}{
  let finish:(value:T)=>void=()=>{throw new Error('Missing deferred resolver');};
  const promise=new Promise<T>(resolve=>{finish=resolve;});return{promise,resolve:finish};
}
function isGeometry(value:unknown):value is THREE.BufferGeometry{return value instanceof THREE.BufferGeometry;}
function geometryOf(value:unknown):THREE.BufferGeometry{if(!isGeometry(value))throw new Error('Missing fixture geometry');return value;}

test('both tiers preflight only their selected GLB and preserve the complete primitive through catalogue builds',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Product GLBs cannot fetch URLs'));
  for(const tier of ['desktop','phone']as const){
    initializeTier(tier);const selected=tier==='phone'?asset.phoneUrl:asset.url,source=tier==='phone'?phone:desktop;
    const read=vi.fn((name:string)=>{expect(name).toBe(selected.file);return Promise.resolve(source.slice());});
    const files=await prepareSpecimenCatalogue({file:read,hasFile:name=>name===selected.file},rows,undefined,[],[asset]);
    expect(read).toHaveBeenCalledOnce();expect(files.size).toBe(1);
    const expected=await loadSpecimenAsset({url:'/assets/original/crate.glb'},source.slice()),sky=skyFixture();
    const definition=defineSpecimenCatalogue<{crate:object}>(rows,undefined,{},files).model('crate');
    const object=definition.build(modelContext(sky),{},new Rng(1));await awaitSpecimenAssets(sky);await Promise.resolve();
    if(!(object instanceof THREE.Group))throw new Error('Missing product specimen group');
    const mesh=object.children[0];if(!(mesh instanceof THREE.Mesh))throw new Error('Missing product specimen mesh');
    const actual=geometryOf(mesh.geometry);
    expect(Object.keys(actual.attributes)).toEqual(Object.keys(expected.geometry.attributes));
    for(const [name,attribute]of Object.entries(expected.geometry.attributes)){
      const channel=actual.getAttribute(name);if(!(attribute instanceof THREE.BufferAttribute)||!(channel instanceof THREE.BufferAttribute))throw new Error('Missing primitive channel');
      expect(channel.array).toEqual(attribute.array);expect(channel.itemSize).toBe(attribute.itemSize);expect(channel.normalized).toBe(attribute.normalized);
    }
    expect(actual.index?.array).toEqual(expected.geometry.index?.array);expect(actual.boundingBox).toEqual(expected.geometry.boundingBox);expect(actual.boundingSphere).toEqual(expected.geometry.boundingSphere);
    actual.dispose();expected.geometry.dispose();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('missing, ambiguous, conflicting and hostile GLB declarations refuse before any product read',async()=>{
  initializeTier('desktop');const file=vi.fn(()=>Promise.resolve(desktop));
  await expect(prepareSpecimenCatalogue({file,hasFile:()=>false},rows)).rejects.toThrow('Missing binary source');
  await expect(prepareSpecimenCatalogue({file},rows,undefined,[],[{...asset,url:{...asset.url,bytes:desktop.length+4}}])).rejects.toThrow('Conflicting binary source lengths');
  expect(()=>parse(SpecimenAssetSchema,{...asset,url:{...asset.url,data:'ambiguous'}})).toThrow();
  expect(()=>parse(SpecimenAssetSchema,{...asset,url:{file:'models/crate.glb',bytes:25_000_001}})).toThrow();
  let touched=0;const hostile=Object.defineProperty({...asset},'url',{enumerable:true,get:()=>{touched++;return asset.url;}});
  expect(()=>prepareSpecimenCatalogue({file},[],undefined,[],[hostile])).toThrow('plain JSON');
  expect(touched).toBe(0);expect(file).not.toHaveBeenCalled();
  const admitted=parse(SpecimenAssetSchema,asset);
  expect(()=>defineSpecimenCatalogue(rows)).toThrow('not prepared');
  expect(()=>loadSpecimenAsset(admitted)).toThrow('not prepared');
  expect(()=>loadSpecimenAsset(admitted,new Map([[asset.url.file,desktop.subarray(1)]]))).toThrow('not prepared');
});

test('wrong lengths and invalid GLBs refuse before model publication without URL fallback',async()=>{
  initializeTier('desktop');const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No fallback'));
  await expect(prepareSpecimenCatalogue({file:()=>Promise.resolve(desktop.subarray(1))},rows)).rejects.toThrow('byte count');
  const invalid=desktop.slice();new DataView(invalid.buffer,invalid.byteOffset,invalid.byteLength).setUint32(8,invalid.length+4,true);
  await expect(prepareSpecimenCatalogue({file:()=>Promise.resolve(invalid)},rows)).rejects.toThrow('Invalid owned specimen GLB');
  expect(fetch).not.toHaveBeenCalled();
});

test('retired owners and replaced readers cannot admit an in-flight GLB',async()=>{
  initializeTier('desktop');
  for(const change of ['scope','reader','inventory']as const){
    const scope=new Scope('product-glb-owner'),reply=deferred<Uint8Array>();
    const product={file:():Promise<Uint8Array>=>reply.promise,hasFile:():boolean=>true};
    const pending=prepareSpecimenCatalogue(product,rows,scope);
    if(change==='scope')scope.dispose();else if(change==='reader')product.file=()=>Promise.resolve(desktop);else product.hasFile=()=>false;
    reply.resolve(desktop);await expect(pending).rejects.toThrow(change==='scope'?'retired':'reader changed');scope.dispose();
  }
});

test('Explorer and live dressing geometry, material and encounter adapters use verified GLBs',async()=>{
  initializeTier('desktop');const book='models/cover-phone.json',siteAsset={url:{file:'models/statue.glb',bytes:phone.length},material};
  const declared=emitNamedBlobs([nameBlob(asset.url.file,'glb',desktop),nameBlob(siteAsset.url.file,'glb',phone),
    nameBlob(book,'json',new TextEncoder().encode(JSON.stringify({rows,materials:{}})),{jsonSchema:registeredJsonSchema(book)})]);
  const product=createShardProduct({slug:'product-glb-fixture',revision:1,
    shardfile:emptyShardfile({slug:'product-glb-fixture',name:'GLB fixture',author:'Fixture',revision:1,seed:1}),
    sections:new Map([['explore/catalogue',parseExplorerCatalogue({version:1,entries:[{kind:'specimen',id:'product-crate',books:{phone:book,desktop:book},model:'crate'}]})]]),
    files:new Map(declared.files.flatMap(row=>row.name===undefined?[]:[[row.name,fixtureProductFile(row.name,{hash:row.hash,url:row.hash})]])),
    jsonCheck:fixtureJsonCheck, read:hash=>{const bytes=declared.assets.get(hash);if(bytes===undefined)throw new Error('Missing product GLB');return Promise.resolve(bytes);},check:true});
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No URL fallback')),sky=skyFixture(),registry=new WorldRegistry(),scope=new Scope('product-glb-adapters'),root=new THREE.Group(),restore=bindFlatTerrain({heightAt:()=>0});
  try{
    const roster=await explorerRoster(product),card=roster[0];if(card===undefined)throw new Error('Missing Explorer card');
    card.list(modelContext(sky),()=>[],registry);const listed=registry.get('model:product-crate')?.model;if(listed===undefined)throw new Error('Missing Explorer model');
    const specimen=listed.object();await awaitSpecimenAssets(sky);await Promise.resolve();
    let count=0;specimen.traverse(child=>{if(child instanceof THREE.Mesh)count+=geometryOf(child.geometry).getAttribute('position').count;});expect(count).toBe(24);
    const ctx=legacyDouble<ShardContext>({scope,root,product,system:vi.fn<ShardContext['system']>(),app:legacyDouble<ShardContext['app']>({registry}),
      game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({world:legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>>({sky})})})});
    const host=await SceneDressing.install(ctx,{name:'product-glb-adapter',catalogues:[],packs:{},geometry:{crate:{kind:'asset',row:asset}},materials:{crate:{kind:'asset',row:asset}},
      staticModels:[{model:{...metadata,id:'orchard/statue'},geometry:'crate',material:'crate'}],layers:[],statics:[],animations:[],
      sites:[{name:'statues',model:'orchard/statue',rows:{name:'statues',label:'Statue',file:'fixture.json',surface:'stone',variants:[''],variantCycle:[0],sink:0,
        generated:siteAsset,collider:{hw:1,hd:1,top:2,bottom:0},sites:[{x:1,z:2,yaw:0,scale:1}]}}]});
    await awaitSpecimenAssets(sky);await Promise.resolve();
    const site=host.sites.get('statues');if(site===undefined)throw new Error('Missing prepared encounter');
    let width=0;site.sites.object.traverse(child=>{if(child instanceof THREE.InstancedMesh){const geometry=geometryOf(child.geometry);geometry.computeBoundingBox();width=geometry.boundingBox===null?0:geometry.boundingBox.max.x-geometry.boundingBox.min.x;}});
    expect(width).toBe(8);expect(SceneDressing.current(ctx)).toBe(host);expect(fetch).not.toHaveBeenCalled();
  }finally{scope.dispose();restore();}
  expect(root.children).toHaveLength(0);
});
