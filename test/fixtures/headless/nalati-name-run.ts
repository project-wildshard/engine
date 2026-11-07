// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assertions run in the strict native child.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {openProductSession} from './productSession';
import {nalatiHorseNameTape} from '../../proof/nalati-grasslands/horseNameTape';

const {sim}=await openProductSession('nalati-grasslands','nalati-companions');
try{
  const report=await sim.verbTape(nalatiHorseNameTape());
  const observation=(id:string)=>{const found=report.observations.find(row=>row.id===id);assert.ok(found);return found;};
  const state=(id:string)=>{
    const owner=observation(id).adapters.find(adapter=>adapter.id==='nalati.companions');assert.ok(owner);
    return v.parse(v.object({open:v.nullable(v.string()),draft:v.string(),lastCalled:v.nullable(v.string()),
      names:v.record(v.string(),v.string()),rows:v.array(v.object({id:v.string(),name:v.string(),come:v.number()}))}),JSON.parse(owner.state));
  };
  assert.equal(state('name-out-of-reach').open,null);assert.deepEqual(state('name-out-of-reach').names,{});
  assert.equal(state('unbonded-whistle').lastCalled,null);
  assert.equal(state('unbonded-whistle').rows.every(row=>row.come===0),true);
  assert.notEqual(state('open-cancelled-name').open,null);
  assert.equal(state('cancel-name').open,null);assert.deepEqual(state('cancel-name').names,{});
  const naming=state('open-name').open;assert.ok(naming);
  assert.equal(state('type-name').draft,'Kunes');assert.deepEqual(state('type-name').names,{});
  assert.equal(state('submit-name').rows.find(row=>row.id===naming)?.name,'Kunes');
  assert.ok(Object.values(state('submit-name').names).includes('Kunes'));
  assert.equal(observation('submit-name').effects.filter(effect=>effect.kind==='hint'&&effect.text.includes('Kunes')).length,1);
  assert.equal(state('close-name').open,null);assert.equal(state('renamed-unbonded-whistle').lastCalled,null);
  assert.equal(state('renamed-unbonded-whistle').rows.every(row=>row.come===0),true);
  assert.equal(sim.quarantined,false);
  console.info(JSON.stringify({story:'name-horse',ticks:report.ticks,actor:naming,name:'Kunes'}));
}finally{await sim.dispose();}
