import {expect,test} from 'vitest';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {scriptScenarioMetrics,scriptScenarioReceipt} from '../scripts/script-scenario-metrics.mjs';
import {netLineReport,platformLineFile,sourceLineDelta} from '../scripts/shard-net-lines.mjs';
import type {DecisionTrace} from '../src/server/engine/script/decision';

test('scenario metrics require matching actual section bytes and script identity',()=>{
 const section=new TextEncoder().encode('[{"id":"boss"}]'),sectionHash=hashImmutableBytes(section);
 const trace:DecisionTrace[]=[{kind:'call',binding:1,tick:1,ok:true,fuel:20,reason:null,before:{},after:{},commands:[]},
  {kind:'call',binding:1,tick:2,ok:false,fuel:30,reason:'fuel',before:{},after:{},commands:[]}];
 const hostHash='1'.repeat(64),receipt=scriptScenarioReceipt({slug:'sample',script:'boss',scenario:'continuation',sectionHash,hostHash,trace});
 expect(receipt).toMatchObject({calls:2,fuel:50,maxFuel:30,refusals:1});
 const index={sections:[{name:'sim/scripts',path:'section',hash:sectionHash}]};
 const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
 const files=new Map([['section',section],['good',encoded(receipt)],['stale',encoded({...receipt,sectionHash:'0'.repeat(64)})],
  ['wrong',encoded({...receipt,script:'other'})],['failed',encoded({...receipt,passed:false})],['empty',encoded({...receipt,calls:0})]]);
 const read=(path:string):Uint8Array=>{const value=files.get(path);if(value===undefined)throw new Error('Missing fixture');return value;};
 const measured=scriptScenarioMetrics('sample',index,read,['stale','wrong','failed','empty','good'],hostHash);
 expect(measured.status).toBe('measured');expect(measured.scenarios).toHaveLength(1);
 expect(measured.scenarios[0]?.receiptHash).toBe(hashImmutableBytes(read('good')));
 expect(scriptScenarioMetrics('sample',index,read,['stale'],hostHash).status).toBe('unknown');
 expect(scriptScenarioMetrics('sample',index,read,['good'],'2'.repeat(64)).status).toBe('unknown');
 expect(scriptScenarioMetrics('sample',{sections:[]},read,[],hostHash).status).toBe('not-applicable');
 files.set('section',encoded([{id:'changed'}]));
 expect(()=>scriptScenarioMetrics('sample',index,read,['good'],hostHash)).toThrow('hash mismatch');
});

test('net lines subtract platform growth once and retain increases and missing evidence',()=>{
 const baseline=[{wave:'test',revision:'base',record:'source M0',customLines:{one:100,two:50},platformLines:{engine:100,game:50,format:10,sdk:20}}];
 const platform={engine:130,game:40,format:15,sdk:20};
 const result=netLineReport({one:{customLines:120,basis:'output'},two:{customLines:10,basis:'source'}},baseline,platform)[0];
 expect(result).toMatchObject({customCut:20,platformGrowth:25,netCut:-5,layers:{format:{before:10,after:15,growth:5}},shards:{one:{cut:-20},two:{cut:40,basis:'source'}}});
 expect(netLineReport({one:{customLines:10,basis:'output'}},baseline,platform)[0]?.netCut).toBeNull();
 expect(platformLineFile('src/sharddev/project.ts')).toBe(true);
 expect(platformLineFile('src/format/questStory.ts')).toBe(true);
 expect(platformLineFile('src/format/types.d.ts')).toBe(false);
 expect(platformLineFile('src/engine/look.glsl')).toBe(true);
 expect(platformLineFile('src/game/tests/example.ts')).toBe(false);
 expect(platformLineFile('src/game/example.test.ts')).toBe(false);
 expect(platformLineFile('src/game/types.d.ts')).toBe(false);
});


test('since-noon source cuts retain growth and refuse mixed-unit or absent credit',()=>{
 const baseline={since:'2026-10-16T12:00:00Z',revision:'sealed',basis:'source',customLines:{one:100,two:50}} as const;
 expect(sourceLineDelta({one:{customLines:90,basis:'source'},two:{customLines:55,basis:'source'}},baseline)).toMatchObject({
  basis:'source',totalRemoved:5,shards:{one:{before:100,after:90,removed:10},two:{before:50,after:55,removed:-5}}});
 expect(sourceLineDelta({one:{customLines:10,basis:'output'}},baseline)).toMatchObject({totalRemoved:null,
  shards:{one:{before:100,after:null,removed:null},two:{before:50,after:null,removed:null}}});
});
