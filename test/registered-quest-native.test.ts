import {expect,test} from 'vitest';
import {QuestStepRowsSchema,QuestHintRowsSchema,parseQuestStepRows,parseQuestHintRows} from '@wildshard/format/questSteps';
import {ChapterWakeSchema,parseChapterWake} from '@wildshard/format/chapterDirector';
import {REGISTERED_JSON,validateRegisteredJson} from '@wildshard/format/registeredJson';
import {registeredJsonSchema,namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {encodeCanonicalJson} from '../src/shared/host/immutable';
import {nameBlob} from '../src/sharddev/blobs';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {fixtureJsonCheck} from './fixtures/folderFile';

// Detached, unplayed roots exercise the original native laws; no game state is lent.
const steps={version:1,steps:[{id:'wait',kind:'wait',seconds:-0,effects:[{kind:'notice',text:'Ready'}]}],guards:[{id:'gate',actor:'guard',message:'Wait'}]};
const hints={hostile:['guard'],scanEvery:.2,maxScan:16,windupRadius:10,hints:[{control:'dodge',when:[{kind:'windup',seconds:2.5}]}],system:{id:'hints',after:[],before:[]}};
const wake={version:1,quest:'quest',spawn:'spawn',director:'quests/chapter-director.json',
 encounter:{id:'boss.guardian',level:'native-fixture',name:'Guardian',step:'quest',kind:'guardian',arena:{radius:10},wakeFlag:'wake',deadFlag:'dead',
  phases:[{at:1}],fields:{awake:'awake',rise:'rise',phase:'phase',poolX:'x',poolZ:'z',arena:'arena'},presentation:{riseAbove:.5,cuts:[]},events:{restore:'restore',wake:'wake'}},
 cues:[{id:'restore',operation:'restore',effects:[]}],systems:{encounter:'encounter',director:'director',before:[]}};
const roots=[{name:'quests/steps.json',schema:QuestStepRowsSchema,parse:parseQuestStepRows,value:steps},
 {name:'quests/hints.json',schema:QuestHintRowsSchema,parse:parseQuestHintRows,value:hints},
 {name:'quests/wake-boss.json',schema:ChapterWakeSchema,parse:parseChapterWake,value:wake}]as const;
const encode=(value:unknown)=>new TextEncoder().encode(encodeCanonicalJson(value));
for(const root of roots){
 test(`${root.name} keeps the defining native root, input and original wire bytes`,()=>{
  const input=structuredClone(root.value),before=structuredClone(input),bytes=encode(input),source=REGISTERED_JSON[root.name].source;
  expect(REGISTERED_JSON[root.name].schema).toBe(root.schema);expect(registeredJsonSchema(root.name)).toEqual({...namedJsonSchema(root.schema),$comment:source});
  expect(root.parse(input)).toEqual(before);validateRegisteredJson(root.name,input);expect(input).toEqual(before);
  expect(nameBlob(root.name,'json',bytes,{jsonSchema:registeredJsonSchema(root.name)}).bytes).toEqual(bytes);expect(encode(input)).toEqual(bytes);
  expect(()=>nameBlob(root.name,'json',bytes)).toThrow('defining schema');expect(()=>validateRegisteredJson(root.name,{...input,foreign:true})).toThrow();
 });
 test(`${root.name} keeps all semantic identity and reference refusals`,()=>{
  const invalid=root.name==='quests/steps.json'?[{...steps,steps:[...steps.steps,...steps.steps]},{...steps,guards:[...steps.guards,...steps.guards]}]
   :root.name==='quests/hints.json'?[{...hints,hints:[...hints.hints,...hints.hints]}]
   :[{...wake,cues:[...wake.cues,...wake.cues]},{...wake,systems:{...wake.systems,encounter:wake.systems.director}},
    {...wake,encounter:{...wake.encounter,events:{restore:'same',wake:'same'}}}];
  for(const input of invalid){expect(()=>root.parse(input)).toThrow();expect(()=>validateRegisteredJson(root.name,input)).toThrow();}
 });
 test(`${root.name} refuses missing and foreign defining metadata before a read`,async()=>{
  const identity={slug:'native-quest',name:'Quest',author:'Test',revision:1,seed:1};
  for(const jsonSchema of[undefined,{},{$comment:'foreign'}]){
   let reads=0;const product=createShardFolder({...identity,shardfile:emptyShardfile(identity),sections:new Map(),jsonCheck:fixtureJsonCheck,
    files:new Map([[root.name,{hash:'a'.repeat(64),url:'/quest',...(jsonSchema===undefined?{}:{jsonSchema})}]]),
    read:()=>{reads++;return Promise.resolve(encode(root.value));}});
   await expect(product.json(root.name)).rejects.toThrow('unregistered named JSON is retired');expect(reads).toBe(0);
  }
 });
}
test('quest roots retain negative zero before the unchanged original JSON encoder',()=>{
 const row=parseQuestStepRows(steps).steps[0];expect(Object.is(row?.kind==='wait'?row.seconds:undefined,-0)).toBe(true);
});
