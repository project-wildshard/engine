import {expect,test} from 'vitest';
import {WorldSceneSchema} from '@wildshard/format/clientChannels';
import {SceneBuffersSchema} from '@wildshard/format/sceneBuffers';
import {ForestPageSchema} from '@wildshard/format/forestPage';
import {PosedLibrarySchema} from '@wildshard/format/namedJsonContracts';
import {WorldSceneWeldSchema} from '@wildshard/format/worldSceneWeld';
import {registeredJsonContract,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {nameBlob} from '../src/sharddev/blobs';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {fixtureJsonCheck} from './fixtures/folderFile';

const recipe={scene:{version:1,root:'root',nodes:[{kind:'group',id:'root',children:[]}],materials:[]},imports:[]};
const buffers={version:1,buffers:[{id:'p',storage:'f32',file:'channels/p.bin',byteLength:12}],
  attributes:[{id:'position',buffer:'p',size:3}],geometries:[{id:'g',attributes:{position:'position'}}],
  draws:[{id:'points',draw:{kind:'points',geometry:'g'}}]};
const posed={name:'borrowed-birds',yaw:-0,attributes:['aPose'],channels:[[0,0,0,0]],
  assets:{name:'birds',channels:[{name:'position',source:'position',width:3}],
    ranges:[{kind:0,start:0,count:3,box:[0,0,0,1,1,1]}]},
  tiers:{phone:{geometry:'birds.phone.bin'},desktop:{geometry:'birds.bin'}},models:[]};
const forest={id:'forest',sliceMs:30,graphs:[],wildlife:'wildlife',treeLooks:[],
  water:{object:'pond',look:'water',looks:[],ripples:'ripples',skyline:'skyline',centre:'centre',probe:'probe'},
  streams:{group:'streams',water:'water',spray:'spray'},
  ground:{appearance:'appearance',layout:'layout',sources:[],kinds:[],far:'far',shadow:'shadow',cells:{size:32,pad:2.5,extraFar:2}},
  buildings:{id:'buildings',root:'root',shells:'shells',shared:'shared',shadow:'shadow',sites:'sites',variants:[],
    life:{wheel:0,door:{seconds:1,angle:1},flicker:{depth:0,waves:[]},fire:[0,1],lamp:[0,1],glass:[0,1],swing:{z:[],x:[0,1]}},
    light:{count:0,color:0,intensity:0,distance:0,decay:0},hearth:'hearth',sunParam:'sun',lampsParam:'lamps',shadeParam:'shade',
    nightShade:0,sightSlack:0,material:'material',save:'save',floors:[],firePits:[]},props:[],
  lanterns:{texture:'glow',color:0,size:1,order:0,range:1,day:0,flicker:[0,1,0,1],
    light:{color:0,intensity:0,distance:0,decay:0},rows:[]},landmarks:[]};
const weld={id:'native-weld',root:'root',nodes:[{kind:'group',id:'branch',parent:'root'}],
  resources:[{id:'geometry',kind:'geometry',source:{library:'shared',model:'marker'}}],
  placements:['marker'],sets:[{id:'markers',name:'Markers',file:'markers.json',members:['marker']}],culls:[]};
const roots=[
  {names:['world/forest-page.json'],schema:ForestPageSchema,source:'@wildshard/format/forestPage#ForestPageSchema',
    value:forest,invalid:{...forest,sliceMs:0}},
  {names:['scenes/cascade.json','scenes/cove.json','scenes/hibiscus.json','scenes/logs.json','scenes/moorings.json',
    'scenes/palms.json','scenes/pool.json','scenes/quest-rides.json','scenes/reef.json','scenes/rocks.json',
    'scenes/streams.json','scenes/trail.json','scenes/wreck.json','scenes/zipline.json','world/portals/scene.json'],
    schema:WorldSceneSchema,source:'@wildshard/format/clientChannels#WorldSceneSchema',value:recipe,
    invalid:{...recipe,imports:[{id:'a',kind:'baked',piece:'a'},{id:'a',kind:'baked',piece:'b'}]}},
  {names:['world/cards/capped-halos.json','world/cards/open-halos.json','world/cards/open-streaks.json','world/portals/sparks.json'],
    schema:SceneBuffersSchema,source:'@wildshard/format/sceneBuffers#SceneBuffersSchema',value:buffers,
    invalid:{...buffers,buffers:[{...buffers.buffers[0],storage:'f64'}]}},
  {names:['look/fish-draw.json','look/gull-draw.json','look/wildlife-draw.json'],
    schema:PosedLibrarySchema,source:'@wildshard/format/namedJsonContracts#PosedLibrarySchema',value:posed,
    invalid:{...posed,assets:{...posed.assets,channels:[{name:'position',source:'position',width:5}]}}},
  {names:['world/casts.json','world/fabric.json'],
    schema:WorldSceneWeldSchema,source:'@wildshard/format/worldSceneWeld#WorldSceneWeldSchema',value:weld,
    invalid:{...weld,sets:[{...weld.sets[0],members:['missing-placement']}]}},
] as const;
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));

for(const root of roots){
  test.each(root.names)('%s keeps its exact native root, input and canonical payload',name=>{
    expect(registeredJsonContract(name).schema).toBe(root.schema);
    const schema=registeredJsonSchema(name);
    expect(schema).toEqual({...namedJsonSchema(root.schema),$comment:root.source});
    const value=structuredClone(root.value),bytes=encode(value);
    validateRegisteredJson(name,value);expect(value).toEqual(root.value);expect(encode(value)).toEqual(bytes);
    if('yaw'in value)expect(Object.is(value.yaw,-0)).toBe(true);
    expect(nameBlob(name,'json',bytes,{jsonSchema:schema}).bytes).toEqual(bytes);
    expect(()=>nameBlob(name,'json',bytes)).toThrow('defining schema');
    expect(()=>validateRegisteredJson(name,root.invalid)).toThrow();
  });

  test.each(root.names)(`${root.source}: %s rejects missing/foreign metadata before its resource read`,async(name)=>{
    const schema=registeredJsonSchema(name),bytes=encode(root.value);
    for(const metadata of [undefined,{...schema,$comment:'foreign-contract'}]){
      let reads=0;
      const identity={slug:'native-alias',name:'Alias',author:'Fixture',revision:1,seed:1};
      const product=createShardFolder({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
        files:new Map([[name,{hash:'a'.repeat(64),url:'/same',...(metadata===undefined?{}:{jsonSchema:metadata})}]]),
        read:()=>{reads++;return Promise.resolve(bytes);}});
      await expect(product.json(name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
    }
  });
}

test.each(['world/casts.json','world/fabric.json'])('%s refuses incomplete or extended weld roots',name=>{
  for(const value of [{id:weld.id,root:weld.root},{...weld,nodes:[{kind:'mesh'}]},{...weld,privateField:true}])
    expect(()=>validateRegisteredJson(name,value)).toThrow();
});

test('alias registration does not capture private names or the other withdrawn welds',()=>{
  for(const name of ['scenes/new-private.json','world/cards/capped-streaks.json','look/other-posed.json',
    'scenes/cabins-phone-shadow-false.json','world/casts-extra.json','world/fabric-extra.json'])
    expect(registeredJsonContract(name)).toBeUndefined();
});
