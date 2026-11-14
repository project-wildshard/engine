import {expect,test} from 'vitest';
import {LivingPageSitesSchema} from '@wildshard/format/forestPage';
import {FixedDrawRowsSchema} from '@wildshard/format/fixedDraws';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {fixtureJsonCheck} from './fixtures/folderFile';

const sites={buildings:[{id:'cabin',index:0,root:'cabin.root',standalone:true}],roofs:[{x:0,z:0,rot:0,w:1,d:1}]};
const draws=[{slot:'native.draw',channels:[['position','position']],file:'native.glb'}];
const roots=[{name:'world/building-sites.json',schema:LivingPageSitesSchema,source:'@wildshard/format/forestPage#LivingPageSitesSchema',value:sites,
 invalid:{...sites,buildings:[{...sites.buildings[0],index:-1}]}},
 {name:'models/shape-book.json',schema:FixedDrawRowsSchema,source:'@wildshard/format/fixedDraws#FixedDrawRowsSchema',value:draws,invalid:[]} ] as const;
for(const root of roots){
 test(`${root.name} preserves its whole native root and encoded bytes`,()=>{
  expect(registeredJsonContract(root.name).schema).toBe(root.schema);
  const schema=registeredJsonSchema(root.name);expect(schema).toEqual({...namedJsonSchema(root.schema),$comment:root.source});
  expect(namedJsonSchema(root.schema,{provenance:true})).toEqual(schema);
  const value=structuredClone(root.value),bytes=new TextEncoder().encode(JSON.stringify(value));
  validateRegisteredJson(root.name,value);expect(value).toEqual(root.value);
  expect(nameBlob(root.name,'json',bytes,{jsonSchema:schema}).bytes).toEqual(bytes);
  expect(()=>validateRegisteredJson(root.name,root.invalid)).toThrow();
  expect(()=>nameBlob(root.name,'json',bytes)).toThrow('defining schema');
 });
 for(const kind of ['missing','foreign']as const)test(`${root.name} rejects ${kind} provenance before reading payload`,async()=>{
  let reads=0;const identity={slug:'scene-facts',name:'Facts',author:'Fixture',revision:1,seed:1};
  const schema=registeredJsonSchema(root.name),bytes=new TextEncoder().encode(JSON.stringify(root.value));
  const product=createShardFolder({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
   files:new Map([[root.name,{hash:'a'.repeat(64),url:'/native',...(kind==='missing'?{}:{jsonSchema:{...schema,$comment:'foreign'}})}]]),
   read:()=>{reads++;return Promise.resolve(bytes);}});
  await expect(product.json(root.name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
 });
}
test('the withheld living envelopes and withdrawn 62 welds remain unregistered',()=>{
 for(const name of ['scenes/cabins/living/phone-false-false.json','scenes/cabins-phone-shadow-false.json',
  'scenes/cabins/specimens/log-cabin-east-phone-false.json'])
  expect(registeredJsonContract(name)).toBeUndefined();
});
