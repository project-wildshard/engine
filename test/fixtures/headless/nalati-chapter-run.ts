// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real native input observations in the bounded child.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {openFolderSession} from './folderSession';
import {nalatiCampIntroTape} from '../../proof/nalati-grasslands/verbTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeObservation,HeadlessTapePlan} from '../../../src/shared/host/headlessTape';

const session=await openFolderSession('nalati-grasslands','nalati-verbs');
try{
  const {product,sim}=session;
  const press=(value:number):HeadlessCommand=>({kind:'script',actorId:'nalati.talk',value});
  const intro=nalatiCampIntroTape(product.shardfile.spawn);
  const plan:HeadlessTapePlan={...intro,observe:['nalati.talk','nalati.chapter'],segments:[
    {id:'chapter-offer',ticks:1,commands:[]},...intro.segments,
    {id:'dismiss-finished-intro',ticks:1,commands:[press(-1)]},
    {id:'open-tame-reminder',ticks:1,commands:[press(0)]},
    {id:'finish-tame-reminder',ticks:128,commands:[],frames:Array.from({length:128},(_,tick)=>tick%16===0?[press(0)]:[])},
    {id:'dismiss-reminder',ticks:1,commands:[press(-1)]},
    {id:'open-before-leaving',ticks:1,commands:[press(0)]},
    {id:'walk-away-reading',ticks:2400,commands:[],route:[{x:86.6,z:219.5},{x:91,z:216},
      {x:94,z:210},{x:95,z:204},{x:88,z:204.5},{x:84.8,z:203.8},{x:83,z:206}]},
    {id:'elder-after-leaving',ticks:1,commands:[press(0)]},
  ]};
  const report=await sim.verbTape(plan);
  const at=(id:string):HeadlessTapeObservation=>{
    const row=report.observations.find(value=>value.id===id);assert.ok(row,`Missing actual chapter observation ${id}`);return row;
  };
  const journal=(row:HeadlessTapeObservation)=>{
    const saved=row.adapters.find(value=>value.id==='nalati.chapter');assert.ok(saved);
    return v.parse(v.object({chip:v.object({label:v.string(),count:v.string()}),
      map:v.nullable(v.object({title:v.string(),objective:v.string(),hint:v.string()})),
      feats:v.array(v.tuple([v.string(),v.number()])),chapters:v.array(v.object({id:v.string(),started:v.boolean(),
        complete:v.boolean(),current:v.nullable(v.string()),objective:v.string(),hint:v.string(),markers:v.array(v.unknown())}))}),JSON.parse(saved.state));
  };
  const tulpar=product.shardfile.quests.quests.find(row=>row.id==='tulpar');assert.ok(tulpar?.intro);
  const tame=tulpar.steps.find(row=>row.id==='tame');assert.ok(tame);
  const offered=journal(at('chapter-offer'));assert.ok(offered.map);
  assert.equal(offered.map.objective,tulpar.intro.objective);assert.equal(offered.map.hint,tulpar.intro.hint);
  assert.equal(offered.chip.count,'');assert.equal(offered.chapters.find(row=>row.id==='tulpar')?.started,false);
  for(const id of ['elder-out-of-reach','walk-to-elder','open-elder-reading','cancel-elder-reading']){
    assert.deepEqual(journal(at(id)),offered,'unfinished or unreachable talk cannot advance the offered journal');
  }
  const begun=journal(at('finish-elder-reading'));assert.ok(begun.map);
  assert.equal(begun.map.objective,tame.objective);assert.equal(begun.map.hint,tame.hint);
  assert.equal(begun.chip.count,`1/${tulpar.steps.length}`);
  assert.equal(begun.chapters.find(row=>row.id==='tulpar')?.current,'tame');
  assert.ok(at('finish-elder-reading').flags.includes('talked:elder'));
  for(const id of ['open-tame-reminder','finish-tame-reminder','open-before-leaving','walk-away-reading','elder-after-leaving']){
    const row=at(id);assert.deepEqual(journal(row),begun,'talking again cannot replace the real taming prerequisite');
    for(const flag of ['talked:elder:2','talked:elder:3','tamed:horse','won:kokpar','quest:tulpar','quest:golden-king','quest:father-wind'])
      assert.equal(row.flags.includes(flag),false,flag);
    assert.equal(row.effects.length,0,'unfinished chapters pay no facts or coins');
  }
  assert.notEqual(at('open-before-leaving').adapters.find(row=>row.id==='nalati.talk')?.state,'null');
  for(const id of ['walk-away-reading','elder-after-leaving'])assert.equal(at(id).adapters.find(row=>row.id==='nalati.talk')?.state,'null');
  assert.equal(sim.quarantined,false);
  console.info(JSON.stringify({story:'chapter-talks',ticks:report.ticks,observations:report.observations.length,
    offered:offered.map,started:begun.map,flags:at('elder-after-leaving').flags}));
}finally{await session.sim.dispose();}
