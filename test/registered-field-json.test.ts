import {expect,test} from 'vitest';
import {SceneBuffersSchema,parseSceneBuffers} from '@wildshard/format/sceneBuffers';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '@wildshard/engine/host/formatJsonSchema';
import {nameBlob} from '@wildshard/sharddev/blobs';
import {admitSceneBuffers} from '../src/client/game/shardfile/sceneBuffers';

const raw={version:1,buffers:[{id:'position',storage:'f32',file:'world/fields/flowers.bin',byteLength:12}],
  attributes:[{id:'position',buffer:'position',size:3}],geometries:[{id:'flowers',attributes:{position:'position'}}],
  draws:[{id:'flowers',draw:{kind:'points',geometry:'flowers'}}]};
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));

test('field ids share the existing defining buffer contract without changing bytes or binary members',()=>{
  for(const name of ['world/fields/flowers.json','world/fields/reeds-2.json'] as const){
    expect(registeredJsonContract(name).schema).toBe(SceneBuffersSchema);
    expect(registeredJsonSchema(name)).toEqual({...namedJsonSchema(SceneBuffersSchema),$comment:'@wildshard/format/sceneBuffers#SceneBuffersSchema'});
    const value=structuredClone(raw),before=encode(value);validateRegisteredJson(name,value);
    expect(nameBlob(name,'json',before,{jsonSchema:registeredJsonSchema(name)}).bytes).toEqual(before);
    expect(value).toEqual(raw);
    expect(registeredJsonContract(name.replace('.json','.bin'))).toBeUndefined();
  }
});

test('field registration retains native references and independent binary extent refusal',()=>{
  const name='world/fields/flowers.json',schema=registeredJsonSchema(name);
  expect(()=>nameBlob(name,'json',encode(raw))).toThrow('defining schema');
  const invalid={...raw,attributes:[{id:'position',buffer:'missing',size:3}]};
  expect(()=>nameBlob(name,'json',encode(invalid),{jsonSchema:schema})).toThrow();
  const value=structuredClone(raw),bytes=new Uint8Array(new Float32Array([0,-0,1]).buffer),before=bytes.slice();
  validateRegisteredJson(name,value);expect(parseSceneBuffers(value).draws[0]?.at).toEqual([0,0,0]);
  expect(()=>admitSceneBuffers(value,new Map([['world/fields/flowers.bin',bytes]]))).not.toThrow();
  expect(bytes).toEqual(before);expect(value).toEqual(raw);
  expect(()=>admitSceneBuffers(value,new Map([['world/fields/flowers.bin',bytes.subarray(0,8)]]))).toThrow('binary length differs');
});

test('field ids stay bounded with no nested alias or traversal contract',()=>{
  for(const name of ['world/fields/.json','world/fields/../flowers.json','world/fields/nested/flowers.json',`world/fields/${'a'.repeat(181)}.json`])
    expect(()=>registeredJsonContract(name)).toThrow('one bounded platform id');
  expect(registeredJsonContract('world/fields2/flowers.json')).toBeUndefined();
});
