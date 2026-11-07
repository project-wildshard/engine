// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the current admitted product and shipped physics bytes.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Behavior assertions run in the bounded native child.
import assert from 'node:assert/strict';
import {beginProductSession} from './productSession';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {createNativeProofResident} from '../headless-native';
import {installWalkRopeBodies} from './ropeBodies';
import {installNativeWalkBounds} from './nativeBounds';
import {prepareHeadlessRuntime} from '../../proof/driftwood-isle/worker';
import {playDriftwood} from '../../proof/driftwood-isle/tape';
import {recordedCheckpoints} from './recordedCheckpoints';

const journey=process.argv[2]??'sealed-ring';
if(journey!=='sealed-ring'&&journey!=='zipline')throw new Error('Unknown native Driftwood story');
const started=performance.now();
const phase=(stage:string):void=>{console.info(JSON.stringify({phase:stage,milliseconds:performance.now()-started}));};
// The independent replay owner may prepare while the real input author walks.
// It still admits its own assets and starts from a fresh native checkpoint.
const session=await beginProductSession('driftwood-isle','driftwood'),{product,assets}=session,source=product.shardfile;
phase('product');
try{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident=await createNativeProofResident({shard:source,assets,rapier,product},prepareHeadlessRuntime);
  const releaseRopes=installWalkRopeBodies(resident.host,product);installNativeWalkBounds(resident.host);
  phase('capture-ready');
  const capture=recordedCheckpoints(async(tick,mark)=>{
    // The same controller authors every real movement/combat/contact input.
    await playDriftwood(resident.host,tick,mark,journey);
    assert.ok(resident.host.flags.has(journey==='sealed-ring'?'quest:driftwood-done':'used:zipline'));
    phase('capture-done');
  },commands=>resident.step(commands),()=>resident.host.flags.all);
  try{
    const replay=await session.ready();
    phase('replay-ready');
    const report=await replay.streamVerbTape([],capture.parts);
    phase('replay-done');
    assert.equal(report.ticks,capture.ticks());
    for(const mark of capture.marks){
      const actual=report.observations.find(row=>row.id===mark.id);assert.ok(actual);
      assert.deepEqual(actual.flags,mark.flags,'fresh current-command replay must retain actual earned transitions');
    }
    if(journey==='sealed-ring'){
      const complete=report.observations.find(row=>row.id==='complete');assert.ok(complete);
      for(const flag of ['talked:castaway','has:flint','lit:beacon','shard:lookout','dead:sailor','key:hold',
        'lever:hold-pump','winch:up','shard:wreck','open:sluice','shard:cave','used:altar','dead:captain','quest:driftwood-done'])assert.ok(complete.flags.includes(flag),flag);
    }else{
      for(const id of ['lookout','zipline-launch','zipline-mid']){
        const before=report.observations.find(row=>row.id===id);assert.ok(before);
        assert.equal(before.flags.includes('used:zipline'),false,'only real cable landing earns the feat');
      }
      const landed=report.observations.find(row=>row.id==='zipline-landed');assert.ok(landed);
      assert.ok(landed.flags.includes('used:zipline'));assert.equal(landed.flags.includes('quest:driftwood-done'),false);
    }
    assert.equal(replay.quarantined,false);
    console.info(JSON.stringify({story:journey,ticks:report.ticks,marks:report.observations.map(row=>({id:row.id,tick:row.tick}))}));
  }finally{await capture.stop();releaseRopes();resident.dispose();}
}finally{await(await session.ready()).dispose();}
const cpu=process.cpuUsage();console.info(JSON.stringify({cpu:{userMs:cpu.user/1000,systemMs:cpu.system/1000},milliseconds:performance.now()-started}));
