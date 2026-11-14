import {expect,test} from 'vitest';
import {WorldSceneSchema} from '@wildshard/format/clientChannels';
import {SceneBakeSourceSchema} from '@wildshard/format/sceneSources';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {fixtureJsonCheck} from './fixtures/folderFile';

const rows={scene:{version:1,root:'root',nodes:[{id:'root',kind:'group',children:[]}],materials:[]},imports:[]};
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const names=['world/scenes/dressing.json','world/scenes/brazier.1.json','world/scenes/static-cell.json'] as const;

test.each(names)('%s retains its defining hierarchy parser and payload bytes',name=>{
  expect(registeredJsonContract(name).schema).toBe(WorldSceneSchema);
  expect(registeredJsonSchema(name)).toEqual({...namedJsonSchema(WorldSceneSchema),$comment:'@wildshard/format/clientChannels#WorldSceneSchema'});
  const value=structuredClone(rows),bytes=encode(value);
  validateRegisteredJson(name,value);expect(encode(value)).toEqual(bytes);
  expect(nameBlob(name,'json',bytes,{jsonSchema:registeredJsonSchema(name)}).bytes).toEqual(bytes);
  expect(()=>nameBlob(name,'json',bytes)).toThrow('defining schema');
  expect(()=>validateRegisteredJson(name,{...value,scene:{...value.scene,nodes:[...value.scene.nodes,...value.scene.nodes]}})).toThrow();
  expect(()=>validateRegisteredJson(name,{...value,imports:[{id:'bake',kind:'baked',piece:'a'},{id:'bake',kind:'baked',piece:'b'}]})).toThrow();
});

test('scene names refuse nested, empty and oversized ids without capturing other families',()=>{
  for(const id of ['','../source','nested/item','a'.repeat(181)])expect(()=>registeredJsonContract(`world/scenes/${id}.json`)).toThrow('bounded platform id');
  expect(registeredJsonContract('world/scenes.json')).toBeUndefined();
  expect(registeredJsonContract('world/sources/bakes.json').schema).toBe(SceneBakeSourceSchema);
  expect(registeredJsonContract('world/sources/bakes.json').source).toBe('@wildshard/format/sceneSources#SceneBakeSourceSchema');
  expect(registeredJsonContract('world/sources/private.json')).toBeUndefined();
  expect(registeredJsonContract('scenes/cabins-phone-shadow-false.json')).toBeUndefined();
});

test('scene admission refuses absent or foreign defining metadata before resource reads',async()=>{
  const name=names[0],schema=registeredJsonSchema(name),bytes=encode(rows);
  for(const metadata of [undefined,{...schema,$comment:'foreign-contract'}]){
    let reads=0;
    const identity={slug:'scene-contract',name:'Scene',author:'Fixture',revision:1,seed:1};
    const product=createShardFolder({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
      files:new Map([[name,{hash:'a'.repeat(64),url:'/same',...(metadata===undefined?{}:{jsonSchema:metadata})}]]),
      read:()=>{reads++;return Promise.resolve(bytes);}});
    await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
  }
});
