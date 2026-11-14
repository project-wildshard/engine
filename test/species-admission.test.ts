import { expect,test } from 'vitest';
import { registeredJsonSchema } from '@wildshard/engine/host/formatJsonSchema';
import { fixtureJsonCheck } from './fixtures/folderFile';
import { nameBlob } from '@wildshard/sharddev/blobs';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { admittedSheepFolder } from './fake/admittedSheep';

const encode=(value:unknown):Uint8Array=>new TextEncoder().encode(JSON.stringify(value));

test('species named-file admission precedes native catalogue allocation',async()=>{
  const file=admittedSheepFolder().metadata,schema=registeredJsonSchema('actors/sheep.json');
  const blob=nameBlob('actors/sheep.json','json',encode(file),{jsonSchema:schema});
  const identity={slug:'species-admission',name:'Species admission',author:'Wildshard',revision:1,seed:1};
  const product=(payload:unknown)=>createShardFolder({slug:identity.slug,revision:1,jsonCheck:fixtureJsonCheck,shardfile:emptyShardfile(identity),sections:new Map(),
    files:new Map([['actors/sheep.json',{...blob.file,url:'https://example.test/species'}]]),read:()=>Promise.resolve(encode(payload))});
  expect(await product(file).json('actors/sheep.json')).toEqual(file);
  expect(encode(await product(file).json('actors/sheep.json'))).toEqual(encode(file));
  const draw=file.draws[0];if(draw===undefined||!('file' in draw)||draw.baked===undefined)throw new Error('Missing original draw');
  for(const payload of [
    {...file,unexpected:true},
    {...file,row:{}},
    {...file,draws:[{...draw,unexpected:true}]},
    {...file,draws:[{...draw,baked:{...draw.baked,count:-1}}]},
    {...file,draws:[{...draw,baked:{...draw.baked,attrs:[['position','f64',3,false]]}}]},
    {...file,draws:[]},
    {...file,draws:[draw,draw]},
    {...file,pivots:Array.from({length:33},()=>[0,0,0])},
    {...file,parts:Array.from({length:33},()=> 'joint')},
    {...file,radius:'wide'},
  ]){
    expect(()=>nameBlob('actors/sheep.json','json',encode(payload),{jsonSchema:schema})).toThrow();
    await expect(product(payload).json('actors/sheep.json')).rejects.toThrow('refuses its schema');
  }
  const view=file.species,first=view.lookBook.rows[0];if(first===undefined)throw new Error('Missing real species row');
  for(const species of [
    {...view,packedBodies:{...view.packedBodies,attrs:[['position','f64',3,false]]}},
    {...view,lookBook:{...view.lookBook,rows:Array.from({length:257},()=>first)}},
    {...view,lookBook:{...view.lookBook,rows:[{...first,material:{rim:'bright',bands:.8}}]}},
    {...view,lookBook:{...view.lookBook,rows:[{...first,control:{kind:'callback',initialize:{flag:'ready',defaults:[]}}}]}},
    {...view,lookBook:{...view.lookBook,rows:[{...first,control:{kind:'arena-room',initialize:{flag:'ready',defaults:[{field:'height',source:'height',value:2}]}}}]}},
    {...view,lookBook:{...view.lookBook,rows:[{...first,control:{kind:'arena-room',initialize:{flag:'ready',defaults:[{field:'height',source:'value',value:'high'}]}}}]}},
  ]){
    expect(()=>nameBlob('actors/sheep.json','json',encode({...file,species}),{jsonSchema:schema})).toThrow();
    await expect(product({...file,species}).json('actors/sheep.json')).rejects.toThrow('refuses its schema');
  }
});
