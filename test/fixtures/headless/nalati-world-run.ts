// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assertions run in the strict native child.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {openFolderSession} from './folderSession';
import {nalatiWorldTape} from '../../proof/nalati-grasslands/worldTape';

const {sim}=await openFolderSession('nalati-grasslands','nalati-world');
try{
  const report=await sim.verbTape(nalatiWorldTape());
  const observation=(id:string)=>{const found=report.observations.find(row=>row.id===id);assert.ok(found);return found;};
  const state=(id:string)=>{
    const row=observation(id).adapters.find(adapter=>adapter.id==='nalati.world');assert.ok(row);
    return v.parse(v.object({mode:v.string(),board:v.boolean(),swim:v.boolean(),crouching:v.boolean(),sprinting:v.boolean(),
      velocity:v.tuple([v.number(),v.number(),v.number()]),places:v.array(v.object({id:v.string(),discovered:v.boolean()}))}),JSON.parse(row.state));
  };
  const groundSpeed=(id:string)=>{const [x,,z]=state(id).velocity;return Math.hypot(x,z);};
  assert.ok(groundSpeed('walk')>0);assert.ok(groundSpeed('sprint')>groundSpeed('walk'));
  assert.equal(state('sprint').sprinting,true);assert.equal(state('crouch').crouching,true);
  assert.ok(groundSpeed('crouch')<groundSpeed('walk'));
  assert.ok(state('jump').velocity[1]>0);assert.ok(observation('land').peakY>observation('crouch').position[1]+.5);
  assert.equal(observation('land').grounded,true);
  assert.equal(state('settle').places.find(place=>place.id==='bridge')?.discovered,false);
  assert.equal(state('walk-to-bridge').places.find(place=>place.id==='bridge')?.discovered,true);
  const discoveries=report.observations.flatMap(row=>row.effects).filter(effect=>effect.kind==='hint'&&effect.text==='Discovered · BRIDGE');
  assert.equal(discoveries.length,1,'only actual arrival discovers the bridge, once');
  assert.equal(state('cross-rail').board,true);
  assert.equal(state('wade').mode,'wade');assert.equal(state('wade').swim,false);
  assert.equal(state('swim').swim,true);assert.equal(state('swim').mode,'swim');
  assert.equal(state('hover-on').board,true);assert.equal(state('hover-river').mode,'board');
  assert.ok(observation('hover-river').position[0]>observation('hover-on').position[0]+5);
  assert.equal(state('hover-off').board,false);assert.equal(sim.quarantined,false);
  console.info(JSON.stringify({story:'nalati-world',ticks:report.ticks,modes:report.observations.map(row=>({id:row.id,mode:state(row.id).mode}))}));
}finally{await sim.dispose();}
