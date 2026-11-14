import {expect,expectTypeOf,test} from 'vitest';
import {WorldSceneModelsSchema,parseWorldSceneModels} from '@wildshard/format/worldSceneModels';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {namedJsonSchema,registeredJsonSchema} from '@wildshard/engine/host/formatJsonSchema';
import {nameBlob} from '@wildshard/sharddev/blobs';
import {emptyShardfile} from '@wildshard/engine/host/author';
import {createShardFolder} from '@wildshard/engine/game/shardfile/shardFolder';

const name='models/world-scenes.json';
const raw={product:'orchard',models:[{key:'crate',id:'orchard/crate',name:'Crate',file:'crate.glb',category:'props',pipeline:'code',defaults:{},
  choices:[{id:'plain',params:{},size:[1,1,1],draws:[],colliders:[]}]}]};
const bytes=()=>new TextEncoder().encode(JSON.stringify(raw));

test('scene catalogues bind their original shared schema without rewriting the wire',()=>{
  expect(registeredJsonContract(name).schema).toBe(WorldSceneModelsSchema);
  expect(registeredJsonSchema(name)).toEqual({...namedJsonSchema(WorldSceneModelsSchema),$comment:'@wildshard/format/worldSceneModels#WorldSceneModelsSchema'});
  const value=structuredClone(raw);validateRegisteredJson(name,value);expect(value).toEqual(raw);
  expect(nameBlob(name,'json',bytes(),{jsonSchema:registeredJsonSchema(name)}).bytes).toEqual(bytes());
});

test('catalogue reads retain consumer-owned defaults and mutable authored data',async()=>{
  const identity={slug:'catalogue-fixture',name:'Catalogue',author:'Test',revision:1,seed:1};
  for(const builtJson of [false,true]){
    const product=createShardFolder({slug:identity.slug,revision:1,shardfile:emptyShardfile(identity),sections:new Map(),
      files:new Map([[name,{hash:'a'.repeat(64),url:'/original',jsonSchema:registeredJsonSchema(name)}]]),read:()=>Promise.resolve(bytes()),builtJson});
    const value=await product.json(name);expectTypeOf(value).toBeUnknown();expect(value).toEqual(raw);
    expect(Object.isFrozen(value)).toBe(false);
    const parsed=parseWorldSceneModels(value);expect(parsed.models[0]?.assembly).toBe('weld');
    expect(parsed.models[0]?.variants).toEqual([]);expect(parsed.models[0]?.choices[0]?.lods).toEqual([]);
    expect(value).toEqual(raw);
  }
});

test('catalogue identity and LOD laws remain mandatory at named admission',()=>{
  const schema=registeredJsonSchema(name);
  expect(()=>nameBlob(name,'json',bytes())).toThrow('defining schema');
  const mismatched={...raw,models:raw.models.map(model=>({...model,id:'other/crate'}))};
  expect(()=>nameBlob(name,'json',new TextEncoder().encode(JSON.stringify(mismatched)),{jsonSchema:schema})).toThrow();
  const duplicate={...raw,models:[...raw.models,...raw.models]};
  expect(()=>validateRegisteredJson(name,duplicate)).toThrow();
});
