import {expect,test} from 'vitest';
import * as v from 'valibot';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import type {ShardContext} from '../src/client/game/plugin/context';
import {SceneDressing} from '../src/client/game/shardfile/sceneDressing';
import {SceneDressingSchema} from '@wildshard/format/sceneDressing';

test.each(['layer','static']as const)('a later inline %s contact refuses before reading any entered owner',async kind=>{
  const contacts={kind:'packed-hulls',data:'eJxj+M/SAAADiQGE',origins:[[0,0,0,12]],surface:'rock'};
  const layer={id:'named',model:'fixture/contact',geometry:'shape',material:'paint',file:'scatter.json',binary:false,far:1,castShadow:false,keepNear:0,
    contacts:{kind:'packed-hulls',file:'contacts.bin',origins:[[0,0,0,12]],surface:'rock'}};
  const input={name:'refused-contact',catalogues:[],packs:{},
    geometry:{shape:{kind:'file',file:'shape.bin',row:{attrs:[],count:0,index:null,indexCount:0,box:false,expand:false}}},
    materials:{paint:{kind:'painterly',rim:.2,bands:.5}},animations:[],
    staticModels:[{model:{id:'fixture/contact',name:'Contact',file:'test/scene-contact-file-only.test.ts',category:'props',pipeline:'code',defaults:{}},geometry:'shape',material:'paint'}],
    layers:[layer,...(kind==='layer'?[{...layer,id:'inline',contacts}]:[])],
    statics:kind==='static'?[{name:'later',tris:0,geometry:{},materials:{},recipe:{version:1,root:'root',materials:[],nodes:[{kind:'group',id:'root',children:[]}]},
      members:[{model:'fixture/contact',draw:'single',placements:[],boxes:[],contacts}]}]:[]};
  expect(()=>v.parse(SceneDressingSchema,input)).not.toThrow();
  let ownerReads=0;
  const ctx=legacyDouble<ShardContext>({get scope():ShardContext['scope']{ownerReads++;throw new Error('Unprepared contact read entered owner');}});
  await expect(SceneDressing.install(ctx,input)).rejects.toThrow('Scene contacts require named files');
  expect(ownerReads).toBe(0);
});
