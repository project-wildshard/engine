// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {openProductSession} from './productSession.ts';
import {driftwoodQuestIntroTape} from '../../proof/driftwood-isle/verbTape.ts';
import {skyKeeperTape} from '../../proof/far-reach/verbTape.ts';
import {nalatiCampTalkTape} from '../../proof/nalati-grasslands/verbTape.ts';
const slug=process.argv[2];
if(slug!=='driftwood-isle'&&slug!=='far-reach'&&slug!=='nalati-grasslands')throw new Error('Unknown native quest tape');
const {sim,product}=await openProductSession(slug,slug==='nalati-grasslands'?'nalati-verbs':undefined);
try {
  const report=await sim.verbTape(slug==='driftwood-isle'?driftwoodQuestIntroTape():slug==='far-reach'?skyKeeperTape():nalatiCampTalkTape(product.shardfile.spawn));
  const at=id=>{const row=report.observations.find(row=>row.id===id);assert.ok(row,`Missing actual observation ${id}`);return row;};
  if(slug==='driftwood-isle'){
    assert.equal(at('chest-out-of-reach').flags.includes('has:flint'),false);
    assert.equal(at('chest-out-of-reach').quests.find(row=>row.id==='sealed-ring')?.started,false);
    assert.equal(at('talk-to-castaway').flags.includes('talked:castaway'),true);
    assert.equal(at('talk-to-castaway').quests.find(row=>row.id==='sealed-ring')?.started,true);
    assert.equal(at('open-chest').flags.includes('open:castaway-chest'),true);
    assert.equal(at('open-chest').flags.includes('has:flint'),true);
    assert.equal(at('walk-to-lookout').flags.includes('lit:beacon'),false);
    assert.equal(at('light-beacon').flags.includes('lit:beacon'),true);
    assert.equal(at('walk-to-lookout-shard').flags.includes('shard:lookout'),false);
    assert.equal(at('take-lookout-shard').flags.includes('shard:lookout'),true);
    assert.equal(at('take-lookout-shard-again').effects.length,0,'repeated use cannot mint another reward');
    assert.equal(at('take-lookout-shard').quests.find(row=>row.id==='sealed-ring')?.complete,false,'the other two real shards are still required');
    assert.deepEqual(at('open-chest-again').flags,at('open-chest').flags,'a second use cannot repeat the chest transition');
  }else if(slug==='far-reach'){
    assert.equal(at('keeper-out-of-reach').flags.includes('far.notes'),false);
    assert.equal(at('talk-to-keeper').flags.includes('far.notes'),true);
    assert.equal(at('talk-to-keeper').quests.find(row=>row.id==='far.quest')?.currentId,'roost');
    assert.equal(at('talk-to-keeper-again').quests.find(row=>row.id==='far.quest')?.currentId,'roost');
    for(const flag of ['far.roost','far.vanes','far.bridge'])assert.equal(at('unearned-winch').flags.includes(flag),false);
  }else{
    for(const id of ['elder-out-of-reach','walk-to-elder','open-elder-reading','cancel-elder-reading']){
      assert.equal(at(id).flags.includes('talked:elder'),false,'only a completed reading may grant the introduction');
      assert.equal(at(id).quests.find(row=>row.id==='tulpar')?.started,false);
    }
    const reading=at('open-elder-reading').adapters.find(row=>row.id==='nalati.talk');
    assert.ok(reading);const opened=v.parse(v.object({dialogue:v.object({npc:v.string(),clock:v.object({open:v.boolean()})})}),JSON.parse(reading.state));
    assert.equal(opened.dialogue.npc,'elder');assert.equal(opened.dialogue.clock.open,true);
    assert.equal(at('cancel-elder-reading').adapters.find(row=>row.id==='nalati.talk')?.state,'null');
    const finished=at('finish-elder-reading');
    assert.equal(finished.flags.includes('talked:elder'),true);assert.equal(finished.quests.find(row=>row.id==='tulpar')?.currentId,'tame');
    for(const flag of ['tamed:horse','won:kokpar','quest:tulpar','quest:golden-king','quest:father-wind'])assert.equal(finished.flags.includes(flag),false);
    assert.equal(finished.effects.length,0,'an introduction cannot mint a completion fact or coins');
    for(const [id,npc] of [['herderRail','herder-rail'],['herderGate','herder-gate'],['cook','cook'],['child','child']]){
      const snapshot=at(`open-${id}`).adapters.find(row=>row.id==='nalati.talk');assert.ok(snapshot);
      const reading=v.parse(v.object({kind:v.string(),reading:v.object({dialogue:v.object({npc:v.string(),clock:v.object({open:v.boolean()})})})}),JSON.parse(snapshot.state));
      assert.equal(reading.kind,id);assert.equal(reading.reading.dialogue.npc,npc);assert.equal(reading.reading.dialogue.clock.open,true);
      assert.equal(at(`dismiss-${id}`).adapters.find(row=>row.id==='nalati.talk')?.state,'null');
      for(const flag of ['tamed:horse','won:kokpar','quest:tulpar','quest:golden-king','quest:father-wind'])assert.equal(at(`dismiss-${id}`).flags.includes(flag),false);
      assert.equal(at(`dismiss-${id}`).effects.length,0);
    }
  }
  assert.equal(sim.quarantined,false);
  console.log(JSON.stringify({slug,ticks:report.ticks,observations:report.observations.map(({id,tick,position,flags,quests})=>({id,tick,position,flags,quests}))}));
}finally{await sim.dispose();}
