import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import * as v from 'valibot';
import {HeadlessJourneyPlanSchema} from '../../src/shared/host/headlessJourney';
import {beginProductSession,type openProductSession} from './headless/productSession';
import {physicsRoutes} from './headless/physicsRoutes';
import {ownedSetup} from './ownedSetup';

// The original browser ruler keeps one world alive for each shard. In Nine,
// the final shaft fall explicitly depends on the safe floor from prior legs.
export function physicsShardCases(include:(slug:string)=>boolean):void {
for(const slug of new Set(physicsRoutes.map(row=>row.slug).filter(candidate=>candidate!=='driftwood-isle'&&include(candidate))))describe(slug,{concurrent:false,shuffle:false},()=>{
  let session:Awaited<ReturnType<typeof openProductSession>>|undefined;
  const setup=ownedSetup(async()=>{
    const start=performance.now(),phase=(name:string):void=>{console.info(JSON.stringify({diagnostic:'native-physics-setup',slug,phase:name,elapsedMs:Math.round(performance.now()-start)}));};
    phase('start');
    const pending=await beginProductSession(slug);phase('product-and-worker-started');
    const ready={sim:await pending.ready(),product:pending.product};phase('worker-ready');
    return ready;
  },async({sim})=>{
    await sim.dispose();
    await expect(sim.step()).rejects.toThrow();
  });
  beforeAll(async()=>{session=await setup.open();});
  afterAll(async()=>{await setup.close();});
  for(const {leg} of physicsRoutes.filter(row=>row.slug===slug))it(`${leg.name}: completes native physics route without a snag`,async()=>{
    if(session===undefined)throw new Error('Missing native physics world');
    const {sim}=session;
    const plan=v.parse(HeadlessJourneyPlanSchema,{ticks:Math.ceil(leg.timeout*60),start:leg.start,once:true,holdActors:true,
      points:[{x:leg.start.x,z:leg.start.z},...leg.waypoints],...(leg.inside===undefined?{}:{inside:leg.inside})});
    const report=await sim.walkLeg(plan),diagnostic=JSON.stringify({slug,leg:leg.name,...report});
    expect(report.stuck,diagnostic).toEqual([]);
    expect(report.out,diagnostic).toBe(0);
    expect(report.complete,diagnostic).toBe(true);
    expect(report.final.position.every(Number.isFinite)).toBe(true);
    expect(sim.quarantined).toBe(false);
  },60_000);
});
}
