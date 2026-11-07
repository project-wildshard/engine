import {expect,test,vi} from 'vitest';
import * as THREE from 'three';
import * as v from 'valibot';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {explorerRoster} from '../src/client/game/models/explorerCatalogue';
import {emptyShardfile} from '../src/shared/host/author';
import {nameBlob,emitNamedBlobs} from '../src/sharddev/blobs';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import {SpecimenBookSchema} from '@wildshard/format/specimenCatalogue';
import {parseExplorerCatalogue} from '@wildshard/format/explorerCatalogue';
import {initializeTier,TIER} from '../src/client/engine/core/tier';
import {WorldRegistry} from '../src/client/engine/world/registry';
import {modelContext} from '../src/client/engine/models/model';
import {SkyRig} from '../src/client/engine/world/skyRig';

function fixture(offset=false){
  const vertices=Float32Array.from([0,0,0,1,0,0,0,1,0]);
  const book={rows:[{key:'leaf',model:{id:'orchard/leaf',name:'Pear leaf',file:'orchard.json',category:'nature',pipeline:'code',defaults:{}},source:{kind:'file',file:'models/leaf.bin',geometry:{attrs:[['position','f32',3,false]],count:3,index:null,indexCount:0,box:false,expand:false},material:{id:'orchard-leaf',family:'painterly',side:'double'}}}],materials:{}};
  const declared=emitNamedBlobs([nameBlob('models/cover-phone.json','json',new TextEncoder().encode(JSON.stringify(book)),{jsonSchema:registeredJsonSchema('models/cover-phone.json')}),nameBlob('models/leaf.bin','bin',new Uint8Array(vertices.buffer))]);
  const catalogue=parseExplorerCatalogue({version:1,entries:[{kind:'specimen',books:{phone:'models/cover-phone.json',desktop:'models/cover-phone.json'},model:'leaf',tierCopies:{phone:7,desktop:18},drawnAs:'instanced'}]});
  return createShardProduct({slug:'orchard',revision:1,shardfile:emptyShardfile({slug:'orchard',name:'Orchard',author:'Fixture',revision:1,seed:7}),sections:new Map([['explore/catalogue',catalogue]]),files:new Map(declared.files.flatMap(row=>row.name===undefined?[]:[[row.name,{hash:row.hash,url:row.hash,...(row.jsonSchema===undefined?{}:{jsonSchema:row.jsonSchema})}]])),read:hash=>{const bytes=declared.assets.get(hash);if(bytes===undefined)throw new Error('Missing leaf book');if(offset){const backing=new Uint8Array(bytes.byteLength+4);backing.set(bytes,4);return Promise.resolve(backing.subarray(4));}return Promise.resolve(bytes);},check:true});
}

test.each([false,true])('an unrelated shard lists and builds its cold specimen book at both tiers (offset=%s)',async offset=>{
  const previous=TIER;
  try{
    for(const tier of ['phone','desktop']as const){
      initializeTier(tier);const product=fixture(offset),entries=await explorerRoster(product),registry=new WorldRegistry();
      const sky:unknown=Object.create(SkyRig.prototype);if(!(sky instanceof SkyRig))throw new Error('Missing sky');
      Object.assign(sky,{csm:{lights:[]},sunDir:new THREE.Vector3(0,1,0)});vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);
      const entry=entries[0];if(entry===undefined)throw new Error('Missing leaf card');entry.list(modelContext(sky),()=>[],registry);
      const card=registry.models()[0];expect(card).toMatchObject({id:'orchard/leaf',name:'Pear leaf',copies:tier==='phone'?7:18,drawnAs:'instanced'});
      const object=card?.object(),mesh=object?.getObjectByProperty('type','Mesh');if(!(mesh instanceof THREE.Mesh))throw new Error('Missing leaf specimen');
      const geometry:unknown=mesh.geometry;if(!(geometry instanceof THREE.BufferGeometry))throw new Error('Missing leaf shape');const position:unknown=geometry.getAttribute('position');if(!(position instanceof THREE.BufferAttribute))throw new Error('Missing leaf positions');expect(position.count).toBe(3);expect(mesh.material).toMatchObject({side:THREE.DoubleSide});geometry.dispose();
    }
    const product=fixture();vi.spyOn(product,'json').mockResolvedValue({rows:[]});await expect(explorerRoster(product)).rejects.toMatchObject({item:'explore/catalogue',reason:'schema'});
  }finally{initializeTier(previous);vi.restoreAllMocks();}
});

test('a specimen book refuses an unknown face side',()=>{
  const row={key:'leaf',model:{id:'orchard/leaf',name:'Pear leaf',file:'orchard.json',category:'nature',pipeline:'code',defaults:{}},source:{kind:'inline',data:'',geometry:{attrs:[],count:0,index:null,indexCount:0,box:false,expand:false},material:{id:'orchard-leaf',family:'painterly',side:'back'}}};
  expect(()=>v.parse(SpecimenBookSchema,{rows:[row],materials:{}})).toThrow();
  expect(v.parse(SpecimenBookSchema,{rows:[{...row,source:{...row.source,material:{id:'orchard-leaf',family:'painterly'}}}],materials:{}}).packed).toBeUndefined();
});
