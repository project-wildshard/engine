import {expect,test} from 'vitest';
import {PopulationFieldSchema} from '@wildshard/format/populationEnvironment';
import {CoverCompositionSchema} from '@wildshard/format/streamedCover';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {fixtureJsonCheck} from './fixtures/productFile';

const cover={name:'cover',placement:'logs',mesh:'cover.mesh',userData:{active:true}};
const meadow={seed:29,world:{res:2,size:20,water:-100,wet:'raster',pond:'raster'},trails:[],
 river:{from:-6,step:4,values:[[-0,1],[2,3],[-2,7]]},meadow:{short:[],tall:[],bare:[],valley:.4,plateau:.7}};
const roots=[{name:'world/cover-composition.json',schema:CoverCompositionSchema,source:'@wildshard/format/streamedCover#CoverCompositionSchema',value:cover,invalid:{...cover,userData:{active:1}}},
 {name:'world/meadow.json',schema:PopulationFieldSchema,source:'@wildshard/format/populationEnvironment#PopulationFieldSchema',value:meadow,invalid:{...meadow,river:{...meadow.river,step:0}}}]as const;
for(const root of roots){
 test(`${root.name} preserves the complete native root and original JSON bytes`,()=>{
  expect(registeredJsonContract(root.name).schema).toBe(root.schema);const schema=registeredJsonSchema(root.name);
  expect(schema).toEqual({...namedJsonSchema(root.schema),$comment:root.source});expect(namedJsonSchema(root.schema,{provenance:true})).toEqual(schema);
  const value=structuredClone(root.value),bytes=new TextEncoder().encode(JSON.stringify(value));validateRegisteredJson(root.name,value);expect(value).toEqual(root.value);
  if('river'in value)expect(Object.is(value.river.values[0]?.[0],-0)).toBe(true);
  expect(nameBlob(root.name,'json',bytes,{jsonSchema:schema}).bytes).toEqual(bytes);
  expect(()=>nameBlob(root.name,'json',bytes)).toThrow('defining schema');expect(()=>validateRegisteredJson(root.name,root.invalid)).toThrow();
 });
 for(const kind of ['missing','foreign']as const)test(`${root.name} refuses ${kind} provenance before payload`,async()=>{
  let reads=0;const identity={slug:'native-ground',name:'Ground',author:'Fixture',revision:1,seed:1},schema=registeredJsonSchema(root.name);
  const product=createShardProduct({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
   files:new Map([[root.name,{hash:'a'.repeat(64),url:'/original',...(kind==='missing'?{}:{jsonSchema:{...schema,$comment:'foreign'}})}]]),
   read:()=>{reads++;return Promise.resolve(new TextEncoder().encode(JSON.stringify(root.value)));}});
  await expect(product.json(root.name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
 });
}
test('unapproved private Pine owner aliases remain outside registration',()=>expect(registeredJsonContract('data/physics.private.json')).toBeUndefined());
