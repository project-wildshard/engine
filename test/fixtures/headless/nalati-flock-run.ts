// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual native outcomes and independent replay.
import assert from 'node:assert/strict';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import {earnNalatiPasture} from './nalati-pasture-session';
import {beginProductSession} from './productSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const {resident,population,flock,sheep,originalWolves,delay,arrivalTick,checkpoint,checkpointTick}=await earnNalatiPasture();
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
try{
  const pending=await beginProductSession('nalati-grasslands','nalati-predators',checkpoint);
  replay=await pending.ready();
  const report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:['nalati.predators'],segments:[{
    id:'ordinary-raid-and-shepherd-defense',ticks:1800,commands:[],
  }]});
  assert.ok(report.observations.some(row=>row.effects.some(effect=>effect.kind==='hint'&&effect.text==='Wolves are raiding the flock — the shepherd rides out')));
  assert.equal(population.raid.raids,1);assert.equal(population.raid.raiding,false);
  assert.equal(population.raid.taken,0);assert.equal(population.raid.drivenOff,1);assert.ok(population.raid.cracks>0);
  assert.equal(flock.alive,sheep,'the actual shepherd preserves the living flock');
  assert.ok(population.raid.shepherd?.alive);assert.equal(leadPlayer(resident.host).health.alive,true);
  const raiders=[...resident.host.entities.values()].filter(actor=>actor.kind==='wolf'&&!originalWolves.includes(actor.entityId));
  assert.ok(raiders.length>0,'only the ordinary raid allocates the real raiders');
  const repeated=await replay.verbTape({version:1,observe:['nalati.predators'],segments:[{
    id:'ordinary-raid-and-shepherd-defense',ticks:1800,commands:[],
  }]});
  assert.deepEqual(repeated,report,'the earned pre-raid checkpoint reproduces real actors, flock, signals and outcome in a fresh worker');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-flock-raid',arrivalTick,checkpointTick,firstRaidSeconds:delay,
    ticks:resident.host.state.tick,sheep:flock.alive,raiders:raiders.length,cracks:population.raid.cracks,drivenOff:population.raid.drivenOff}));
}finally{resident.dispose();await replay?.dispose();}
