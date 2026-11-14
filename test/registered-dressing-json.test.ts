import {expect,test} from 'vitest';
import {SceneDressingSchema} from '@wildshard/format/sceneDressing';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {encodeCanonicalJson,hashImmutableBytes} from '../src/shared/host/immutable';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {emptyShardfile} from '../src/shared/host/author';
import {fixtureJsonCheck} from './fixtures/productFile';

const names=['world/dressing-phone.json','world/dressing-desktop.json'] as const;
const value={name:'registered-dressing',catalogues:[],packs:{},geometry:{},materials:{},layers:[],statics:[],animations:[]};
const bytes=new TextEncoder().encode(encodeCanonicalJson(value));
const identity={slug:'dressing-native-contract',name:'Dressing',author:'Fixture',revision:1,seed:1};

test.each(names)('%s keeps its complete defining native contract and raw wire defaults',name=>{
 expect(registeredJsonContract(name)?.schema).toBe(SceneDressingSchema);
 expect(registeredJsonSchema(name)).toEqual(namedJsonSchema(SceneDressingSchema,{provenance:true}));
 const before=structuredClone(value);validateRegisteredJson(name,value);expect(value).toEqual(before);
 expect(nameBlob(name,'json',bytes,{jsonSchema:registeredJsonSchema(name)}).bytes).toEqual(bytes);
 expect(()=>nameBlob(name,'json',bytes)).toThrow('defining schema');
 expect(registeredJsonContract('world/dressing-other.json')).toBeUndefined();
});

const malformed=[{...value,name:''},{...value,extra:'foreign'},
 {...value,staticModels:[{model:{id:'foreign'},geometry:'missing',material:'missing'}]}];
test.each(names.flatMap(name=>malformed.map(bad=>({name,bad}))))('$name native full-root checks still refuse malformed rows',({name,bad})=>{
 expect(()=>validateRegisteredJson(name,bad)).toThrow();
});

test.each(names.flatMap(name=>['missing','foreign'].map(kind=>({name,kind}))))('$name metadata $kind refuses before any body read',async({name,kind})=>{
 let reads=0;const schema=registeredJsonSchema(name),metadata=kind==='missing'?undefined:{...schema,$comment:'foreign'};
 const product=createShardProduct({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
 files:new Map([[name,{hash:hashImmutableBytes(bytes),url:'/same',...(metadata===undefined?{}:{jsonSchema:metadata})}]]),
 read:()=>{reads++;return Promise.resolve(bytes);}});
 await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
});

test.each(names)('%s existing product reader retains omitted native defaults on decoded wire rows',async name=>{
 let reads=0;const product=createShardProduct({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
 files:new Map([[name,{hash:hashImmutableBytes(bytes),url:'/same',jsonSchema:registeredJsonSchema(name)}]]),
 read:()=>{reads++;return Promise.resolve(bytes);}});
 expect(await product.json(name)).toEqual(value);expect(reads).toBe(1);expect(value).not.toHaveProperty('instances');
});
